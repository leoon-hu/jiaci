import { randomUUID } from "node:crypto";
import { Prisma, type AiRequestStatus } from "@prisma/client";
import { prisma } from "../db";
import { getConfig, getConfigInt } from "../config";
import { getOrCreateKnownWord } from "../dict-db";
import { registerTexts, targetsOfWord } from "../tts/batch";
import {
  ApiCallError, PROMPT_VERSION, PROVIDER_API, SYSTEM_PROMPT, buildUserMessage, chatJson, extractJson, isTransientApiError, validateFill,
  type AiRowData, type FillWordInput,
} from "./fill";
import {
  BAN_COUNTED, GENERATE_MINUTE_MS, GENERATE_WINDOW_MS, bannedMessage, generateEnabled, generateStatus, refusalResponse, refuseReason, remainingAfter, shouldBan,
  type GenerateLimits, type GenerateStatus, type RefuseReason,
} from "./generate-rules";
import { generateJobs, initialGenerateProvider, isGenerateConfigured } from "./generate-state";
import { aiRelationOf, type AiProvider } from "./providers";
import { getResponsesConfig, responsesJson } from "./responses";

/**
 * 登录用户可用已配置的来源首次生成 AI 资料，也可重新解析已有资料。
 * 资料按厂商写库并全站共用，例句与释义登记到 audio_text 供按需合成。
 * 接口立刻返回、生成在本进程后台跑（一个词半分钟到一分钟，不能让请求挂着等——nginx 与 Cloudflare 都有代理超时），页面轮询 generateStatusOf。
 * 限次与封禁按 word_ai_request 表数（每人 24 小时 / 每分钟、每个 IP 24 小时；被拒太多次封账号与 IP），规则在 lib/ai/generate-rules.ts。
 */
const ACCEPTED: AiRequestStatus[] = ["pending", "ok", "failed"];
type Row = Omit<Prisma.WordAiDeepseekUncheckedCreateInput, "wordId">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let admission = Promise.resolve();

export async function generateLimits(): Promise<GenerateLimits> {
  const [dailyPerUser, perMinute, dailyPerIp, concurrency, banAfter, banHours] = await Promise.all([
    getConfigInt("ai.generate_daily_per_user", 0), getConfigInt("ai.generate_per_minute"), getConfigInt("ai.generate_daily_per_ip"),
    getConfigInt("ai.generate_concurrency"), getConfigInt("ai.generate_ban_after", 0), getConfigInt("ai.generate_ban_hours"),
  ]);
  return { dailyPerUser, perMinute, dailyPerIp, concurrency, banAfter, banHours };
}

export type GenerateResult =
  | { ok: true; /** false = 复用在跑的任务，这次不计次 */ started: boolean; remaining: number; requestId: string }
  | { ok: false; status: number; code: RefuseReason | "banned" | "unavailable"; message: string; retryAfter?: number };

export async function requestGenerate(user: { id: string }, ip: string, spelling: string, regenerate?: AiProvider): Promise<GenerateResult> {
  const provider = regenerate ?? initialGenerateProvider();
  const unavailable: GenerateResult = { ok: false, status: 503, code: "unavailable", message: "生成功能暂时没有开放" };
  if (!isGenerateConfigured(provider)) return unavailable;
  const limits = await generateLimits();
  if (!generateEnabled(limits, true)) return unavailable;
  const request = admission.then(async (): Promise<GenerateResult> => {
    const now = Date.now();
    // 封禁中的请求直接拒、不记日志：封禁期内再怎么发也不再累计，到期自然恢复
    const ban = await prisma.wordAiBan.findFirst({ where: { until: { gt: new Date(now) }, OR: [{ userId: user.id }, { ip }] }, orderBy: { until: "desc" }, select: { until: true } });
    if (ban) return { ok: false, status: 403, code: "banned", message: bannedMessage(ban.until, now) };
    const job = generateJobs.get(spelling);
    const word = await prisma.word.findUnique({ where: { spelling }, include: { aiDeepseek: { select: { wordId: true } }, aiOpenai: { select: { wordId: true } } } });
    if (regenerate && !word?.[aiRelationOf(regenerate)]) return refuse(user.id, ip, spelling, "missing", limits, now);
    if (!regenerate && (word?.aiDeepseek || word?.aiOpenai)) return refuse(user.id, ip, spelling, "exists", limits, now);
    const since = (ms: number) => ({ gt: new Date(now - ms) });
    const [userDay, userMinute, ipDay] = await Promise.all([
      prisma.wordAiRequest.count({ where: { userId: user.id, status: { in: ACCEPTED }, createdAt: since(GENERATE_WINDOW_MS) } }),
      prisma.wordAiRequest.count({ where: { userId: user.id, status: { in: ACCEPTED }, createdAt: since(GENERATE_MINUTE_MS) } }),
      prisma.wordAiRequest.count({ where: { ip, status: { in: ACCEPTED }, createdAt: since(GENERATE_WINDOW_MS) } }),
    ]);
    if (job?.provider === provider) return { ok: true, started: false, remaining: Math.max(0, limits.dailyPerUser - userDay), requestId: job.requestId };
    const reason = generateJobs.has(spelling) ? "busy" : refuseReason({ userDay, userMinute, ipDay, running: generateJobs.size }, limits);
    if (reason) return refuse(user.id, ip, spelling, reason, limits, now);
    // 次数都过了才建词条行（词典里有的才建，与备注 / 反馈同一条规则），免得被拒的请求也往全局词表灌行
    const target = word ?? await getOrCreateKnownWord(spelling);
    if (!target) return refuse(user.id, ip, spelling, "unknown", limits, now);
    const requestId = randomUUID();
    generateJobs.set(spelling, { requestId, provider });
    try {
      await prisma.wordAiRequest.create({ data: { id: requestId, userId: user.id, ip, spelling, status: "pending" } });
    } catch (error) {
      generateJobs.delete(spelling);
      throw error;
    }
    void run(requestId, target, provider);
    return { ok: true, started: true, remaining: remainingAfter(userDay, limits), requestId };
  });
  admission = request.then(() => undefined, () => undefined);
  return request;
}

/** 记一条被拒，并看要不要封：账号 24 小时内被拒够多就封账号 + 当前 IP；只是这个 IP 够多（多个账号轮着来）就只封 IP */
async function refuse(userId: string, ip: string, spelling: string, reason: RefuseReason, limits: GenerateLimits, now: number): Promise<GenerateResult> {
  await prisma.wordAiRequest.create({ data: { userId, ip, spelling, status: "refused", reason } });
  if (BAN_COUNTED.includes(reason) && limits.banAfter > 0) {
    const where = { status: "refused" as const, reason: { in: [...BAN_COUNTED] }, createdAt: { gt: new Date(now - GENERATE_WINDOW_MS) } };
    const [byUser, byIp] = await Promise.all([prisma.wordAiRequest.count({ where: { ...where, userId } }), prisma.wordAiRequest.count({ where: { ...where, ip } })]);
    const banUser = shouldBan(byUser, limits), banIp = banUser || shouldBan(byIp, limits);
    if (banIp) {
      const until = new Date(now + limits.banHours * 3_600_000);
      const why = `24 小时内被拒 ${Math.max(byUser, byIp)} 次（账号 ${byUser} / IP ${byIp}），自动封 ${limits.banHours} 小时`;
      await prisma.wordAiBan.createMany({ data: [...(banUser ? [{ userId, until, reason: why }] : []), { ip, until, reason: why }] });
      console.warn(`[ai-generate] 封禁${banUser ? ` 账号 ${userId} 与` : ""} IP ${ip}：${why}`);
      return { ok: false, status: 403, code: "banned", message: bannedMessage(until, now) };
    }
  }
  return { ok: false, code: reason, ...refusalResponse(reason, limits) };
}

/** 后台跑一个词：调模型 → 写表 → 登记音频文本 → 记录改 ok / failed；成功与否都从在跑清单里去掉 */
async function run(requestId: string, w: FillWordInput & { id: string }, provider: AiProvider) {
  const t0 = Date.now();
  try {
    const { row, warnings } = await fillWord(w, provider);
    const texts = targetsOfWord(w.spelling, [{ examples: row.examples, core: row.core }]);
    await prisma.$transaction(async (tx) => {
      const write = { where: { wordId: w.id }, create: { wordId: w.id, ...row }, update: row };
      if (provider === "deepseek") await tx.wordAiDeepseek.upsert(write);
      else await tx.wordAiOpenai.upsert(write);
      await registerTexts(tx, texts);
      await tx.wordAiRequest.update({ where: { id: requestId }, data: { status: "ok", durationMs: Date.now() - t0 } });
    });
    console.log(`[ai-generate] ✓ ${w.spelling} ${((Date.now() - t0) / 1000).toFixed(1)}s${warnings.length ? "，降级：" + warnings.join("；") : ""}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(`[ai-generate] ✗ ${w.spelling}：${msg}`);
    await prisma.wordAiRequest.update({ where: { id: requestId }, data: { status: "failed", durationMs: Date.now() - t0, reason: msg.slice(0, 500) } }).catch(() => { /* 记不上就算了 */ });
  } finally {
    generateJobs.delete(w.spelling);
  }
}

/**
 * 调模型并整理成可写表的一行——与 scripts/ai-fill.ts 的 one() 同一套步骤：
 * 输出被截断把预算提一半重来一次；JSON 坏了 / 字段不合格带着错误再要一次；接口暂时性出错（限流、超时）歇 3 秒再试一次；第二次还不行就失败
 */
async function fillWord(w: FillWordInput, provider: AiProvider): Promise<{ row: Row; warnings: string[] }> {
  const [cfgProvider, cfgModel, cfgMaxTokens] = await Promise.all([getConfig("ai.provider"), getConfig("ai.model"), getConfigInt("ai.max_tokens")]);
  const responses = getResponsesConfig(provider);
  const model = responses?.model ?? (cfgProvider === provider && cfgModel ? cfgModel : PROVIDER_API[provider].defaultModel);
  let budget = cfgMaxTokens, feedback: string | undefined;
  for (let attempt = 1; ; attempt++) {
    let text: string;
    try {
      const userMessage = buildUserMessage(w, feedback);
      const result = responses
        ? await responsesJson(responses, SYSTEM_PROMPT, userMessage, budget)
        : await chatJson(provider, model, SYSTEM_PROMPT, userMessage, { maxTokens: budget });
      text = result.text;
    } catch (e) {
      if (attempt >= 2) throw e;
      if (e instanceof ApiCallError && e.truncated) { budget = Math.ceil(budget * 1.5); continue; }
      if (isTransientApiError(e)) { await sleep(3000); continue; }
      throw e;
    }
    let raw: unknown;
    try { raw = extractJson(text); } catch (e) {
      feedback = `JSON 解析失败：${(e as Error).message}`;
      if (attempt >= 2) throw new Error("模型两次都没有返回合格的内容（" + feedback + "）");
      continue;
    }
    const v = validateFill(raw, w);
    if (!v.ok) {
      feedback = v.error;
      if (attempt >= 2) throw new Error("模型两次都没有返回合格的内容（" + v.error + "）");
      continue;
    }
    const warnings = [...v.warnings];
    await pruneUnknownDerived(v.data, warnings);
    return { row: toRow(v.data, model, warnings), warnings };
  }
}

/** 事实性校验（同脚本）：词族 / 同根词必须在词表或词典里，模型经常造出不存在的派生词 */
async function pruneUnknownDerived(d: AiRowData, warnings: string[]) {
  const lists = { family: d.family as Array<{ w: string }>, cognates: d.cognates as Array<{ w: string }> };
  const derived = [...lists.family, ...lists.cognates].map((x) => x.w.toLowerCase());
  if (!derived.length) return;
  const [inWord, inDict] = await Promise.all([
    prisma.word.findMany({ where: { spelling: { in: derived } }, select: { spelling: true } }),
    prisma.dictEntry.findMany({ where: { spelling: { in: derived } }, select: { spelling: true } }),
  ]);
  const known = new Set([...inWord, ...inDict].map((x) => x.spelling));
  const keep = (list: Array<{ w: string }>, label: string) => list.filter((x) => {
    const ok = known.has(x.w.toLowerCase());
    if (!ok) warnings.push(`${label}不在词典里，已去掉：${x.w}`);
    return ok;
  });
  d.family = keep(lists.family, "词族");
  d.cognates = keep(lists.cognates, "同根词");
}

function toRow(d: AiRowData, model: string, warnings: string[]): Row {
  const j = (x: unknown) => x as Prisma.InputJsonValue;
  const source = `${model}@${PROMPT_VERSION}`;
  return {
    phoneticUs: d.phoneticUs, phoneticUk: d.phoneticUk, core: d.core, corePos: d.corePos, meanings: j(d.meanings), examples: j(d.examples),
    collocations: j(d.collocations), phrases: j(d.phrases), patterns: j(d.patterns), usage: d.usage, synonyms: j(d.synonyms), antonyms: j(d.antonyms),
    confusables: j(d.confusables), mistakes: j(d.mistakes), family: j(d.family), cognates: j(d.cognates), mnemonic: d.mnemonic,
    // 有降级（字段被置空 / 例句被删）的行 source 带 +warn，脚本的 --warned 能一起复查
    etymology: d.etymology == null ? Prisma.DbNull : j(d.etymology), source: warnings.length ? `${source}+warn` : source, generatedAt: new Date(),
  };
}

/** 轮询：这个词现在是在跑、已经有资料、刚失败，还是什么都没有 */
export async function generateStatusOf(spelling: string, requestId?: string): Promise<{ status: GenerateStatus; error?: string; justDone?: boolean }> {
  const job = generateJobs.get(spelling);
  if (job && (!requestId || job.requestId === requestId)) return { status: "running" };
  const [word, latest] = await Promise.all([
    requestId ? null : prisma.word.findUnique({ where: { spelling }, select: { aiDeepseek: { select: { wordId: true } }, aiOpenai: { select: { wordId: true } } } }),
    prisma.wordAiRequest.findFirst({ where: { spelling, id: requestId, status: { in: ACCEPTED } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, reason: true, createdAt: true } }),
  ]);
  const active = generateJobs.get(spelling);
  const running = !!active && (!requestId || active.requestId === requestId);
  const done = requestId ? latest?.status === "ok" : !!(word?.aiDeepseek || word?.aiOpenai);
  const r = generateStatus(running, done, latest);
  // 服务重启把在跑的任务丢了：记录还是 pending、内存里却没有——补记成失败，免得这个词永远「生成中」
  if (r.status === "failed" && latest?.status === "pending") {
    await prisma.wordAiRequest.updateMany({ where: { id: latest.id, status: "pending" }, data: { status: "failed", reason: "服务重启，生成被打断" } }).catch(() => { /* 忽略 */ });
  }
  return r;
}

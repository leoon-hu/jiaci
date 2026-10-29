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
import { GENERATE_PROVIDER, generateJobs, hasGenerateKey } from "./generate-state";

/**
 * 用户点「生成 AI 资料」（需求 3.4 I8）：对没有任何厂商资料的词，登录用户可以让服务器现场调 DeepSeek 填一次，
 * 写进 word_ai_deepseek（与运营脚本 scripts/ai-fill.ts 同一套提示词、校验与写法，全站共用），再把例句与释义登记到 audio_text 供按需合成。
 * 接口立刻返回、生成在本进程后台跑（一个词半分钟到一分钟，不能让请求挂着等——nginx 与 Cloudflare 都有代理超时），页面轮询 generateStatusOf。
 * 限次与封禁按 word_ai_request 表数（每人 24 小时 / 每分钟、每个 IP 24 小时；被拒太多次封账号与 IP），规则在 lib/ai/generate-rules.ts。
 */
const ACCEPTED: AiRequestStatus[] = ["pending", "ok", "failed"];
type Row = Omit<Prisma.WordAiDeepseekUncheckedCreateInput, "wordId">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateLimits(): Promise<GenerateLimits> {
  const [dailyPerUser, perMinute, dailyPerIp, concurrency, banAfter, banHours] = await Promise.all([
    getConfigInt("ai.generate_daily_per_user", 0), getConfigInt("ai.generate_per_minute"), getConfigInt("ai.generate_daily_per_ip"),
    getConfigInt("ai.generate_concurrency"), getConfigInt("ai.generate_ban_after", 0), getConfigInt("ai.generate_ban_hours"),
  ]);
  return { dailyPerUser, perMinute, dailyPerIp, concurrency, banAfter, banHours };
}

export type GenerateResult =
  | { ok: true; /** false = 别人已经在生成这个词，这次没另起任务、也不计次 */ started: boolean; remaining: number }
  | { ok: false; status: number; code: RefuseReason | "banned" | "unavailable"; message: string; retryAfter?: number };

/** 发起生成：查封禁 → 已有资料 → 次数 → 建词条行 → 记 pending 并在后台跑 */
export async function requestGenerate(user: { id: string }, ip: string, spelling: string): Promise<GenerateResult> {
  const unavailable: GenerateResult = { ok: false, status: 503, code: "unavailable", message: "生成功能暂时没有开放" };
  if (!hasGenerateKey()) return unavailable;
  const limits = await generateLimits();
  if (!generateEnabled(limits, true)) return unavailable;
  const now = Date.now();
  // 封禁中的请求直接拒、不记日志：封禁期内再怎么发也不再累计，到期自然恢复
  const ban = await prisma.wordAiBan.findFirst({ where: { until: { gt: new Date(now) }, OR: [{ userId: user.id }, { ip }] }, orderBy: { until: "desc" }, select: { until: true } });
  if (ban) return { ok: false, status: 403, code: "banned", message: bannedMessage(ban.until, now) };
  const word = await prisma.word.findUnique({ where: { spelling }, select: { id: true, aiDeepseek: { select: { wordId: true } }, aiOpenai: { select: { wordId: true } } } });
  // 任一厂商有资料就不生成（页面上也没有这个按钮）
  if (word?.aiDeepseek || word?.aiOpenai) return refuse(user.id, ip, spelling, "exists", limits, now);
  const since = (ms: number) => ({ gt: new Date(now - ms) });
  const [userDay, userMinute, ipDay] = await Promise.all([
    prisma.wordAiRequest.count({ where: { userId: user.id, status: { in: ACCEPTED }, createdAt: since(GENERATE_WINDOW_MS) } }),
    prisma.wordAiRequest.count({ where: { userId: user.id, status: { in: ACCEPTED }, createdAt: since(GENERATE_MINUTE_MS) } }),
    prisma.wordAiRequest.count({ where: { ip, status: { in: ACCEPTED }, createdAt: since(GENERATE_WINDOW_MS) } }),
  ]);
  // 别人刚点过、还在跑：不另起任务也不计这个人的次数，页面照样轮询等结果
  if (generateJobs.has(spelling)) return { ok: true, started: false, remaining: Math.max(0, limits.dailyPerUser - userDay) };
  const reason = refuseReason({ userDay, userMinute, ipDay, running: generateJobs.size }, limits);
  if (reason) return refuse(user.id, ip, spelling, reason, limits, now);
  // 次数都过了才建词条行（词典里有的才建，与备注 / 反馈同一条规则），免得被拒的请求也往全局词表灌行
  const w = word ? await prisma.word.findUniqueOrThrow({ where: { id: word.id } }) : await getOrCreateKnownWord(spelling);
  if (!w) return refuse(user.id, ip, spelling, "unknown", limits, now);
  const req = await prisma.wordAiRequest.create({ data: { userId: user.id, ip, spelling, status: "pending" }, select: { id: true } });
  generateJobs.set(spelling, { requestId: req.id, userId: user.id, startedAt: now });
  void run(req.id, w);
  return { ok: true, started: true, remaining: remainingAfter(userDay, limits) };
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
async function run(requestId: string, w: FillWordInput & { id: string }) {
  const t0 = Date.now();
  try {
    const { row, warnings } = await fillWord(w);
    await prisma.wordAiDeepseek.upsert({ where: { wordId: w.id }, create: { wordId: w.id, ...row }, update: row });
    // 例句（含译文）与核心义登记后，详情页与跑步模式播放它们时按需合成接口才放行（防止被当免费 TTS）
    await registerTexts(prisma, targetsOfWord(w.spelling, [{ examples: row.examples, core: row.core }]));
    await prisma.wordAiRequest.update({ where: { id: requestId }, data: { status: "ok", durationMs: Date.now() - t0 } });
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
async function fillWord(w: FillWordInput): Promise<{ row: Row; warnings: string[] }> {
  const [cfgProvider, cfgModel, cfgMaxTokens] = await Promise.all([getConfig("ai.provider"), getConfig("ai.model"), getConfigInt("ai.max_tokens")]);
  const model = cfgProvider === GENERATE_PROVIDER && cfgModel ? cfgModel : PROVIDER_API[GENERATE_PROVIDER].defaultModel;
  let budget = cfgMaxTokens, feedback: string | undefined;
  for (let attempt = 1; ; attempt++) {
    let text: string;
    try {
      text = (await chatJson(GENERATE_PROVIDER, model, SYSTEM_PROMPT, buildUserMessage(w, feedback), { maxTokens: budget })).text;
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
export async function generateStatusOf(spelling: string): Promise<{ status: GenerateStatus; error?: string; justDone?: boolean }> {
  const running = generateJobs.has(spelling);
  const [word, latest] = await Promise.all([
    prisma.word.findUnique({ where: { spelling }, select: { aiDeepseek: { select: { wordId: true } }, aiOpenai: { select: { wordId: true } } } }),
    prisma.wordAiRequest.findFirst({ where: { spelling, status: { in: ACCEPTED } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, reason: true, createdAt: true } }),
  ]);
  const r = generateStatus(running, !!(word?.aiDeepseek || word?.aiOpenai), latest);
  // 服务重启把在跑的任务丢了：记录还是 pending、内存里却没有——补记成失败，免得这个词永远「生成中」
  if (r.status === "failed" && latest?.status === "pending") {
    await prisma.wordAiRequest.update({ where: { id: latest.id }, data: { status: "failed", reason: "服务重启，生成被打断" } }).catch(() => { /* 忽略 */ });
  }
  return r;
}

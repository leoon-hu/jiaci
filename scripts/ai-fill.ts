/**
 * 运营脚本：用模型填充词条 AI 字段，写入对应厂商的 word_ai_* 表。
 * 应用运行时不调用这里；密钥只从环境变量读（DEEPSEEK_API_KEY / OPENROUTER_API_KEY——OpenAI 的模型经 openrouter.ai 调用，模型名带 openai/ 前缀）。
 *
 * 用法（项目根目录）：
 *   npm run ai:fill -- --provider deepseek --words abandon,reluctant,"give up"   # 指定词
 *   npm run ai:fill -- --provider deepseek --missing --limit 20                 # 内置词库里该厂商还没填的词，按词频从常用到生僻
 *   npm run ai:fill -- --provider deepseek --missing --limit 100 --wordbook 雅思词汇  # 指定词库，按该词库的添加顺序取前 N 个还没填的
 *   npm run ai:fill -- --provider deepseek --missing --stale deepseek-chat@1 --regenerate --limit 50  # 只重生成 source 不是该前缀的旧行
 *   npm run ai:fill -- --provider deepseek --missing --warned --regenerate --limit 20   # 复查写入时有降级（source 带 +warn）的行
 *   选项：--model 模型名（默认按厂商）  --regenerate 已有行也重写  --stale <source 前缀> 只挑旧版本的行  --warned 只挑有降级的行  --concurrency 2  --dry-run 只打印提示词不调接口  --print 打印返回的 JSON
 *   长跑护栏：--max-cost 12（累计估算费用达到这个美元数就停）  --max-fail-rate 0.2（失败率上限，默认 0.2，满 50 词后才判）
 *   --missing 默认只挑内置词库里的词；加 --all 则不限词库，把 word 表里所有还没填的词都算上
 *   写完一词的 AI 行后会登记例句并用 Edge-TTS（免费）顺带合成单词四种声音与例句默认声音的音频；--no-audio 关闭
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { AI_PROVIDERS, type AiProvider } from "../src/lib/ai/providers";
import { ApiCallError, PROMPT_VERSION, PROVIDER_API, SYSTEM_PROMPT, buildUserMessage, chatJson, deepseekPeak, estimateCost, extractJson, isDbError, isFatalApiError, isTransientApiError, validateFill, type AiRowData, type FillWordInput, type Usage } from "../src/lib/ai/fill";
import { normalizeWord } from "../src/lib/words";
import { getConfig, getConfigInt } from "../src/lib/config";
import { ttsConfig, type TtsConfig } from "../src/lib/tts";
import { closeEdge } from "../src/lib/tts/edge";
import { generateClips, jobsOf, registerTexts, targetsOfWord } from "../src/lib/tts/batch";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const arg = (n: string, d = "") => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 模型输出本身的问题（JSON 坏了、字段不合格）：只算这个词失败，不计入「连续失败」熔断 */
class ContentError extends Error {}
/** 失败的原始输出存到 storage/ai-fail/ 便于排查（目录已 gitignore） */
function dumpFailure(provider: string, spelling: string, attempt: number, reason: string, text: string) {
  try {
    mkdirSync("storage/ai-fail", { recursive: true });
    writeFileSync(`storage/ai-fail/${provider}-${spelling.replace(/\s+/g, "_")}-${attempt}.txt`, `# ${reason}\n${text}`);
  } catch { /* 忽略 */ }
}

// ---- 保护：数据库一断，所有 worker 停止调接口，已花钱拿到的结果留在内存里等数据库恢复再写；密钥 / 余额出问题或连续失败过多则整体停止 ----
const DB_WAIT_MAX_MS = 15 * 60_000;
let dbDown: Promise<void> | null = null;
let aborted: string | null = null;
async function waitDbBack(): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < DB_WAIT_MAX_MS) {
    await sleep(10_000);
    try { await prisma.$queryRaw`SELECT 1`; console.log("▶ 数据库已恢复，继续"); return; } catch { /* 继续等 */ }
  }
  throw new Error("数据库 15 分钟内没有恢复");
}
/** 写库：连不上时不丢结果、不再调接口，等恢复后重写；其它 worker 在下一次调接口前也会等 */
async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try { return await fn(); } catch (e) {
      if (!isDbError(e)) throw e;
      if (!dbDown) {
        const first = (e as Error).message.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("Invalid")) ?? "";
        console.log(`\n⏸ 数据库连不上（${first}），暂停调接口，每 10 秒探测一次，最多等 15 分钟…`);
        dbDown = waitDbBack().finally(() => { dbDown = null; });
      }
      await dbDown;
    }
  }
}

async function main() {
  // 默认厂商 / 模型 / max_tokens 取自 system_config 的 ai.*（需求 3.6），命令行参数优先（审计 F137）
  const [cfgProvider, cfgModel, cfgMaxTokens] = await Promise.all([getConfig("ai.provider"), getConfig("ai.model"), getConfigInt("ai.max_tokens")]);
  const provider = arg("provider", process.env.AI_FILL_PROVIDER ?? cfgProvider) as AiProvider;
  if (!AI_PROVIDERS.includes(provider)) throw new Error(`--provider 只能是 ${AI_PROVIDERS.join(" / ")}（当前默认来自 system_config 的 ai.provider = ${cfgProvider}）`);
  // 配置里的模型名只在厂商也用配置默认值时生效，否则用该厂商自己的默认模型
  const model = arg("model", provider === cfgProvider && cfgModel ? cfgModel : PROVIDER_API[provider].defaultModel);
  const limit = Number(arg("limit", "5")) || 5;
  const concurrency = Math.max(1, Number(arg("concurrency", "2")) || 2);
  const maxTokens = Number(arg("max-tokens", String(cfgMaxTokens))) || cfgMaxTokens;
  const dry = has("dry-run"), print = has("print"), regenerate = has("regenerate"), audio = !has("no-audio");
  /**
   * 长跑（几千词一批）用的两道闸，防止「一直失败还一直付费」：
   * --max-cost 累计估算费用（美元）超过就停；--max-fail-rate 失败率超过就停（默认 20%，至少处理 50 词后才判，避免开头抖动误停）。
   * 连续失败 / 连续输出不合格已有 8 次熔断，这两道管的是「失败与成功交错、连续计数永远到不了 8」的情况。
   */
  const maxCost = Number(arg("max-cost", "0")) || 0;
  const maxFailRate = Number(arg("max-fail-rate", "0.2")) || 0.2;
  const FAIL_RATE_MIN_SAMPLE = 50;
  const source = `${model}@${PROMPT_VERSION}`;
  // 两张厂商表结构相同，但 Prisma 的委托类型不同，只能按厂商各写一句。
  // 用 switch 而不是「不是 deepseek 就当 openai」：新增厂商时这里会抛错，不会把结果静默写进 openai 表（审计 F094）
  type Row = Omit<Prisma.WordAiDeepseekUncheckedCreateInput, "wordId">;
  const noTable = (p: string) => new Error(`厂商 ${p} 还没有对应的表：新增厂商要在 prisma schema、src/lib/ai/providers.ts 与本脚本一起登记`);
  const findDone = (ids: string[]) => {
    const where = { wordId: { in: ids } }, select = { wordId: true };
    switch (provider) {
      case "deepseek": return prisma.wordAiDeepseek.findMany({ where, select });
      case "openai": return prisma.wordAiOpenai.findMany({ where, select });
      default: throw noTable(provider);
    }
  };
  const upsertRow = (wordId: string, row: Row) => {
    switch (provider) {
      case "deepseek": return prisma.wordAiDeepseek.upsert({ where: { wordId }, create: { wordId, ...row }, update: row });
      case "openai": return prisma.wordAiOpenai.upsert({ where: { wordId }, create: { wordId, ...row }, update: row });
      default: throw noTable(provider);
    }
  };

  // 目标词：--words 指定，或该厂商还没填的词（内置词库 / 指定词库），按词频从常用到生僻
  let words: Array<FillWordInput & { id: string }> = [];
  if (arg("words")) {
    const list = arg("words").split(",").map((s) => normalizeWord(s)).filter(Boolean);
    const rows = await prisma.word.findMany({ where: { spelling: { in: list } } });
    const found = new Set(rows.map((r) => r.spelling));
    const missing = list.filter((s) => !found.has(s));
    if (missing.length) console.log(`词表里没有这些词，跳过：${missing.join(", ")}`);
    // 按用户给的顺序取，找不到的直接过滤掉（上面已提示过），不要用 ! 掩盖 undefined（审计 F162）
    const bySpelling = new Map(rows.map((r) => [r.spelling, r]));
    words = list.map((s) => bySpelling.get(s)).filter((w): w is (typeof rows)[number] => Boolean(w));
  } else if (has("missing")) {
    const bookName = arg("wordbook");
    // --all：不限内置词库，把 word 表里所有还没填的词都算上。
    // 默认只挑内置词库里的词（那是用户实际会学到的）；词典筛进来但不属于任何词库的词，
    // 用户搜索或点词时也看得到，要给它们填资料就得加这个开关，否则 --missing 永远选不到它们。
    const allWords = has("all");
    const books = allWords && !bookName ? [] : await prisma.wordbook.findMany({ where: bookName ? { type: "builtin", name: bookName } : { type: "builtin" }, select: { id: true } });
    if (!books.length && !allWords) throw new Error(bookName ? `没有名为「${bookName}」的内置词库` : "没有内置词库");
    if (bookName && allWords) throw new Error("--all 与 --wordbook 不能同时用：前者是全表，后者限定一本词库");
    // --stale <前缀>：只挑 source 不是该前缀的行（换模型 / 换提示词版本后重生成），需要配合 --regenerate 覆盖写入
    const stale = arg("stale");
    const cond = has("warned") ? { is: { source: { endsWith: "+warn" } } }
      : stale ? { is: { source: { not: { startsWith: stale } } } }
      : regenerate ? undefined : { is: null };
    const rel = provider === "deepseek" ? { aiDeepseek: cond } : { aiOpenai: cond };
    if (bookName) {
      // 指定词库：按该词库的添加顺序（sort_order）取前 N 个还没填的
      const rows = await prisma.wordbookWord.findMany({ where: { wordbookId: books[0].id, word: rel }, orderBy: { sortOrder: "asc" }, take: limit, include: { word: true } });
      words = rows.map((r) => r.word);
    } else {
      words = await prisma.word.findMany({
        where: { ...rel, ...(allWords ? {} : { wordbooks: { some: { wordbookId: { in: books.map((b) => b.id) } } } }) },
        orderBy: [{ frq: { sort: "asc", nulls: "last" } }, { bnc: { sort: "asc", nulls: "last" } }, { spelling: "asc" }],
        take: limit,
      });
    }
  } else { console.error("请指定 --words a,b,c 或 --missing [--limit N]"); process.exit(1); }
  if (!regenerate && arg("words")) {
    const done = new Set((await findDone(words.map((w) => w.id))).map((r) => r.wordId));
    const skip = words.filter((w) => done.has(w.id));
    if (skip.length) console.log(`已有 ${provider} 数据，跳过（加 --regenerate 重写）：${skip.map((w) => w.spelling).join(", ")}`);
    words = words.filter((w) => !done.has(w.id));
  }
  console.log(`厂商 ${provider}，模型 ${model}，来源标记 ${source}，待处理 ${words.length} 词${dry ? "（试运行，不调接口）" : ""}`);
  if (!words.length) return;
  if (dry) {
    console.log("\n===== 系统提示词 =====\n" + SYSTEM_PROMPT + "\n\n===== 用户消息（第一个词） =====\n" + buildUserMessage(words[0]));
    return;
  }

  const tts: TtsConfig | null = audio ? await ttsConfig() : null;
  const total: Usage = { input: 0, cachedInput: 0, output: 0 };
  const clips = { created: 0, skipped: 0, failed: 0 };
  let ok = 0, failed = 0, i = 0, consecutiveFail = 0, consecutiveBad = 0;
  /** 用量累加：成功与失败（截断 / 空返回）都要算，那些调用同样计费（审计 F097） */
  const countUsage = (u: Usage) => {
    total.input += u.input; total.cachedInput += u.cachedInput; total.output += u.output;
    if (u.cost !== undefined) total.cost = (total.cost ?? 0) + u.cost;
    if (maxCost && !aborted && estimateCost(provider, total) >= maxCost) {
      aborted = `累计费用已达上限 $${maxCost}（--max-cost）`;
      console.log(`\n⛔ ${aborted}，停止本次运行`);
    }
  };
  const one = async (w: FillWordInput & { id: string }) => {
    const t0 = Date.now();
    let feedback: string | undefined;
    let budget = maxTokens;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (dbDown) await dbDown;   // 数据库没恢复前不花钱
        if (aborted) return;
        const r = await chatJson(provider, model, SYSTEM_PROMPT, buildUserMessage(w, feedback), { maxTokens: budget });
        countUsage(r.usage);
        let raw: unknown;
        try { raw = extractJson(r.text); } catch (e) { feedback = `JSON 解析失败：${(e as Error).message}`; dumpFailure(provider, w.spelling, attempt, feedback, r.text); if (attempt === 2) throw new ContentError(feedback); continue; }
        const v = validateFill(raw, w);
        if (!v.ok) { feedback = v.error; dumpFailure(provider, w.spelling, attempt, v.error, r.text); if (print) console.log(`  [${w.spelling} 第 ${attempt} 次输出不合格：${v.error}]\n` + JSON.stringify(raw, null, 1).slice(0, 4000)); if (attempt === 2) throw new ContentError(v.error); continue; }
        const d: AiRowData = v.data;
        // 事实性校验：词族 / 同根词必须在词表或词典里，模型经常造出不存在的派生词（审计 F101）
        const warnings = [...v.warnings];
        const derived = [...(d.family as Array<{ w: string }>), ...(d.cognates as Array<{ w: string }>)].map((x) => x.w.toLowerCase());
        if (derived.length) {
          const known = new Set([
            ...(await prisma.word.findMany({ where: { spelling: { in: derived } }, select: { spelling: true } })).map((x) => x.spelling),
            ...(await prisma.dictEntry.findMany({ where: { spelling: { in: derived } }, select: { spelling: true } })).map((x) => x.spelling),
          ]);
          const keep = <T extends { w: string }>(list: T[], label: string) => list.filter((x) => {
            const ok = known.has(x.w.toLowerCase());
            if (!ok) warnings.push(`${label}不在词典里，已去掉：${x.w}`);
            return ok;
          });
          d.family = keep(d.family as Array<{ w: string }>, "词族");
          d.cognates = keep(d.cognates as Array<{ w: string }>, "同根词");
        }
        const j = (x: unknown) => x as Prisma.InputJsonValue;
        const row: Row = {
          phoneticUs: d.phoneticUs, phoneticUk: d.phoneticUk, core: d.core, corePos: d.corePos, meanings: j(d.meanings), examples: j(d.examples),
          collocations: j(d.collocations), phrases: j(d.phrases), patterns: j(d.patterns), usage: d.usage, synonyms: j(d.synonyms), antonyms: j(d.antonyms),
          confusables: j(d.confusables), mistakes: j(d.mistakes), family: j(d.family), cognates: j(d.cognates), mnemonic: d.mnemonic,
          // 有降级（字段被置空 / 例句被删）的行在 source 上留个后缀，之后可以用 --warned 复查（审计 F100）
          etymology: d.etymology == null ? Prisma.DbNull : j(d.etymology), source: warnings.length ? `${source}+warn` : source, generatedAt: new Date(),
        };
        await withDb(() => upsertRow(w.id, row));
        ok++; consecutiveFail = 0; consecutiveBad = 0;
        let audioNote = "";
        if (tts) {
          // 登记本词、例句与中文释义，顺带合成音频（已有文件跳过）
          const targets = targetsOfWord(w.spelling, [{ examples: d.examples, core: d.core }]);
          await withDb(() => registerTexts(prisma, targets));
          const st = await generateClips(tts, jobsOf(tts, targets), prisma);
          clips.created += st.created; clips.skipped += st.skipped; clips.failed += st.failed;
          audioNote = `，音频 +${st.created}${st.failed ? `（失败 ${st.failed}）` : ""}`;
        }
        console.log(`✓ ${w.spelling.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(1)}s  输入 ${r.usage.input + r.usage.cachedInput}（缓存 ${r.usage.cachedInput}）/ 输出 ${r.usage.output} token${r.usage.cost !== undefined ? `，计费 $${r.usage.cost.toFixed(4)}` : ""}${audioNote}${attempt === 2 ? "（重试后通过）" : ""}${warnings.length ? "\n    ⚠ " + warnings.join("\n    ⚠ ") : ""}`);
        if (print) console.log(JSON.stringify(raw, null, 1));
        return;
      } catch (e) {
        const msg = (e as Error).message;
        if (e instanceof ApiCallError) {
          countUsage(e.usage);
          // 原样重发几乎必然再被截断，重试时把预算提一半（审计 F098）
          if (e.truncated && attempt === 1) { budget = Math.ceil(budget * 1.5); console.log(`  ${w.spelling}: ${msg}，把 max_tokens 提到 ${budget} 重试`); continue; }
        }
        // 致命：密钥 / 余额 / 数据库长时间不恢复——停止整个运行，已入库的不受影响，重跑 --missing 从缺的词继续
        if (isFatalApiError(e) || /没有恢复/.test(msg) || isDbError(e)) { aborted = msg; console.log(`\n⛔ ${msg}\n停止本次运行；已处理的词已入库，重跑 --missing 会从缺的词继续`); return; }
        // 接口错误（超时、限流、模型输出不合格等）：第一次再试一次，第二次记失败
        if (attempt === 2) {
          failed++;
          if (e instanceof ContentError) consecutiveBad++; else { consecutiveFail++; consecutiveBad = 0; }
          console.log(`✗ ${w.spelling}: ${msg}`);
          if (consecutiveFail >= 8) { aborted = `连续 ${consecutiveFail} 个词失败，多半是接口或网络出了问题`; console.log(`\n⛔ ${aborted}，停止本次运行`); }
          // 模型系统性输出坏 JSON 时也要停：否则会一直付费跑完整批（审计 F099）
          else if (consecutiveBad >= 8) { aborted = `连续 ${consecutiveBad} 个词的输出都不合格，多半是提示词或模型有问题`; console.log(`\n⛔ ${aborted}，停止本次运行`); }
          // 失败与成功交错时上面两个连续计数永远到不了 8，用整体失败率兜底
          else if (ok + failed >= FAIL_RATE_MIN_SAMPLE && failed / (ok + failed) > maxFailRate) {
            aborted = `失败率 ${(100 * failed / (ok + failed)).toFixed(0)}% 超过上限 ${(100 * maxFailRate).toFixed(0)}%（已处理 ${ok + failed} 词）`;
            console.log(`\n⛔ ${aborted}，停止本次运行`);
          }
          return;
        }
        console.log(`  ${w.spelling}: ${msg}，重试一次`);
        if (isTransientApiError(e)) await sleep(3000);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, words.length) }, async () => { while (i < words.length && !aborted) await one(words[i++]); }));
  if (aborted) { console.log(`\n本次因「${aborted}」提前停止：完成 ${ok}，失败 ${failed}，未处理 ${words.length - ok - failed}`); process.exitCode = 1; }
  const cost = estimateCost(provider, total);
  const tariff = provider === "deepseek" ? (deepseekPeak() ? "，按高峰时段价；北京时间 12–14 点、18 点到次日 9 点及周末为离峰半价" : "，按离峰半价") : "";
  console.log(`\n完成：成功 ${ok}，失败 ${failed}；token 输入 ${total.input + total.cachedInput}（缓存命中 ${total.cachedInput}）/ 输出 ${total.output}，${total.cost !== undefined ? "实际计费" : "估算费用约"} $${cost.toFixed(4)} ≈ ¥${(cost * 7.2).toFixed(2)}（每词约 $${(cost / Math.max(1, ok + failed)).toFixed(4)}${tariff}；以账单为准）`);
  if (tts) console.log(`音频：新生成 ${clips.created} 段，已有 ${clips.skipped} 段，失败 ${clips.failed} 段（引擎 ${tts.provider}，目录 storage/audio 或 AUDIO_DIR）`);
  console.log(`查看效果：设置里「词条资料来源」选「自动」或「${provider}」，打开 http://localhost:3000/word/<单词>`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { closeEdge(); return prisma.$disconnect(); });

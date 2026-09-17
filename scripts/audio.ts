/**
 * 运营脚本：发音音频。合成用 Edge-TTS（免费、无 Key），文件写到 AUDIO_DIR（默认 storage/audio）。
 *   npm run audio:generate -- --missing                        # 有 AI 资料的词：单词四种声音 + 例句默认声音（tts.batch_voices）+ 中文释义（tts.voice_zh）
 *   npm run audio:generate -- --missing --wordbook 雅思词汇     # 某内置词库的全部词（没有 AI 资料的只生成单词音频）
 *   npm run audio:generate -- --words abandon,"give up"        # 指定词
 *   选项：--voices us_female,uk_male（例句也生成这些声音） --translations 例句的中文译文也生成（跑步模式「英文 + 中文」用；量大，默认只登记不生成）
 *         --register-only 只把文本登记到 audio_text 不合成（登记过的才允许按需合成） --words-only 只生成单词 --limit N --concurrency 3 --dry-run 只统计不合成
 *   npm run audio:stats                                         # 登记数、各音色生成数、失败数、磁盘占用
 *   npm run audio:prune -- --voice en-US-AriaNeural             # 删掉某音色的全部文件与记录（换音色后清理）
 *   npm run audio:prune -- --orphans                            # 删掉已不在用的例句与释义及其文件（ai:fill --regenerate 之后清理）
 *   npm run audio:prune -- --failed                             # 删掉 failed 记录，让下次重试
 *   npm run audio:prune -- --tmp                                # 清掉一小时前残留的 .tmp 半成品（进程被打断时留下的）
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { audioDir, ttsConfig } from "../src/lib/tts";
import { closeEdge } from "../src/lib/tts/edge";
import { generateClips, jobsOf, registerTexts, targetsOfWord, type AudioJob, type AudioTarget } from "../src/lib/tts/batch";
import { isVoiceKey, normalizeText, textHash } from "../src/lib/tts/text";
import { normalizeWord } from "../src/lib/words";

const prisma = new PrismaClient();
const argv = process.argv.slice(3);
const cmd = process.argv[2];
const has = (f: string) => argv.includes(`--${f}`);
const arg = (n: string, d = "") => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const kb = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const label = (j: AudioJob) => j.kind === "word" ? j.text : `「${j.text.slice(0, 40)}${j.text.length > 40 ? "…" : ""}」`;

const SEL = { spelling: true, translation: true, aiOpenai: { select: { examples: true, core: true } }, aiDeepseek: { select: { examples: true, core: true } } } as const;

async function generate() {
  const cfg = await ttsConfig();
  const limit = Number(arg("limit", "0")) || 0;
  const concurrency = Math.max(1, Number(arg("concurrency", String(cfg.concurrency))) || cfg.concurrency);
  const only = arg("voices") ? arg("voices").split(",").map((s) => s.trim()).filter(isVoiceKey) : undefined;
  const wordsOnly = has("words-only"), dry = has("dry-run"), translations = has("translations"), registerOnly = has("register-only");
  let words: Array<{ spelling: string; translation: string | null; aiOpenai: { examples: unknown; core: string | null } | null; aiDeepseek: { examples: unknown; core: string | null } | null }>;
  if (arg("words")) {
    const list = arg("words").split(",").map((s) => normalizeWord(s)).filter(Boolean);
    words = await prisma.word.findMany({ where: { spelling: { in: list } }, select: SEL });
    const found = new Set(words.map((w) => w.spelling));
    const miss = list.filter((s) => !found.has(s));
    if (miss.length) console.log(`词表里没有这些词，跳过：${miss.join(", ")}`);
  } else if (has("missing")) {
    const bookName = arg("wordbook");
    if (bookName) {
      const book = await prisma.wordbook.findFirst({ where: { type: "builtin", name: bookName }, select: { id: true } });
      if (!book) throw new Error(`没有名为「${bookName}」的内置词库`);
      const rows = await prisma.wordbookWord.findMany({ where: { wordbookId: book.id }, orderBy: { sortOrder: "asc" }, select: { word: { select: SEL } } });
      words = rows.map((r) => r.word);
    } else {
      words = await prisma.word.findMany({
        where: { OR: [{ aiOpenai: { isNot: null } }, { aiDeepseek: { isNot: null } }] },
        orderBy: [{ frq: { sort: "asc", nulls: "last" } }, { spelling: "asc" }],
        select: SEL,
      });
    }
  } else { console.error("请指定 --words a,b 或 --missing [--wordbook 名称]"); process.exit(1); }
  if (limit) words = words.slice(0, limit);

  // 文本去重（同一句可能出现在多个词下）
  const seen = new Set<string>();
  const targets: AudioTarget[] = [];
  for (const w of words) for (const t of targetsOfWord(w.spelling, [w.aiOpenai, w.aiDeepseek], w)) { const k = `${t.kind}:${t.text}`; if (!seen.has(k)) { seen.add(k); targets.push(t); } }
  await registerTexts(prisma, targets);
  let jobs = jobsOf(cfg, targets, only, translations);
  if (wordsOnly) jobs = jobs.filter((j) => j.kind === "word");
  const sentences = targets.filter((t) => t.kind === "sentence").length;
  const trans = targets.filter((t) => t.translation).length;
  const defs = targets.filter((t) => t.kind === "definition").length - trans;
  console.log(`引擎 ${cfg.provider}，词 ${words.length}，文本 ${targets.length}（例句 ${sentences}，译文 ${trans}${translations ? "" : "（只登记）"}，释义 ${defs}），音频 ${jobs.length} 段（已有文件会跳过），并发 ${concurrency}，目录 ${audioDir()}${dry ? "；试运行，不合成" : registerOnly ? "；只登记，不合成" : ""}`);
  if (dry || registerOnly || !jobs.length) return;
  const t0 = Date.now();
  let n = 0;
  const st = await generateClips(cfg, jobs, prisma, concurrency, (j, r) => {
    n++;
    if (r instanceof Error) console.log(`✗ ${j.voice} ${label(j)}：${r.message}`);
    else if (n % 50 === 0 || n === jobs.length) console.log(`  ${n}/${jobs.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });
  console.log(`完成：新生成 ${st.created} 段（${kb(st.bytes)}），已有跳过 ${st.skipped}，失败 ${st.failed}，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  if (st.errors.length) console.log("失败明细：\n  " + st.errors.slice(0, 30).join("\n  "));
}

async function walk(dir: string): Promise<{ files: number; bytes: number }> {
  const out = { files: 0, bytes: 0 };
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = await walk(p); out.files += r.files; out.bytes += r.bytes; }
    else if (e.name.endsWith(".mp3")) { out.files++; out.bytes += (await fs.stat(p)).size; }
  }
  return out;
}

async function stats() {
  const texts = await prisma.audioText.groupBy({ by: ["kind"], _count: { _all: true } });
  const clips = await prisma.audioClip.groupBy({ by: ["voice", "status"], _count: { _all: true }, _sum: { bytes: true } });
  const KIND_LABEL: Record<string, string> = { word: "单词", sentence: "例句", definition: "释义" };
  console.log("登记文本：" + (texts.map((t) => `${KIND_LABEL[t.kind] ?? t.kind} ${t._count._all}`).join("，") || "0"));
  console.log("音频记录：");
  for (const c of clips.sort((a, b) => a.voice.localeCompare(b.voice))) console.log(`  ${c.voice.padEnd(20)} ${c.status.padEnd(7)} ${String(c._count._all).padStart(6)} 段  ${kb(c._sum.bytes ?? 0)}`);
  const disk = await walk(audioDir());
  const okRows = clips.filter((c) => c.status === "ok").reduce((s, c) => s + c._count._all, 0);
  console.log(`磁盘：${disk.files} 个文件，${kb(disk.bytes)}（${audioDir()}）${disk.files === okRows ? "，与记录一致" : `，记录 ok ${okRows} 段，不一致`}`);
}

async function removeClips(where: { voice?: string; status?: "failed"; textHash?: { in: string[] } }) {
  const rows = await prisma.audioClip.findMany({ where, select: { textHash: true, voice: true, path: true } });
  let removed = 0;
  for (const r of rows) { await fs.unlink(path.join(audioDir(), r.path)).then(() => removed++).catch(() => {}); }
  await prisma.audioClip.deleteMany({ where });
  return { rows: rows.length, removed };
}

async function prune() {
  if (arg("voice")) {
    const r = await removeClips({ voice: arg("voice") });
    console.log(`音色 ${arg("voice")}：删除记录 ${r.rows} 条，文件 ${r.removed} 个`);
  } else if (has("failed")) {
    const r = await removeClips({ status: "failed" });
    console.log(`删除 failed 记录 ${r.rows} 条`);
  } else if (has("orphans")) {
    // 现在还在用的例句与释义的哈希集合；不在其中的登记连同文件一起删。
    // 按 word 表遍历而不是只查两张 AI 表：没有 AI 资料的词，释义是词典 translation 兜底出来的，
    // 只看 AI 表会把这些释义音频全当成孤儿删掉。
    const live = new Set<string>();
    const words = await prisma.word.findMany({ select: SEL });
    for (const w of words) for (const t of targetsOfWord(w.spelling, [w.aiOpenai, w.aiDeepseek], w)) if (t.kind !== "word") live.add(textHash(normalizeText(t.text)));
    const all = await prisma.audioText.findMany({ where: { kind: { in: ["sentence", "definition"] } }, select: { textHash: true, kind: true } });
    const deadRows = all.filter((t) => !live.has(t.textHash));
    const dead = deadRows.map((t) => t.textHash);
    const r = dead.length ? await removeClips({ textHash: { in: dead } }) : { rows: 0, removed: 0 };
    if (dead.length) await prisma.audioText.deleteMany({ where: { textHash: { in: dead } } });
    const ds = deadRows.filter((t) => t.kind === "sentence").length;
    console.log(`孤儿文本 ${dead.length} 条（例句 ${ds}，释义 ${dead.length - ds}）：删除音频记录 ${r.rows} 条，文件 ${r.removed} 个`);
  } else if (has("tmp")) {
    // 进程被 restart / OOM 打断时留下的 .tmp 半成品，表里没有、stats 也看不见（审计 NO05）
    const cutoff = Date.now() - 3600_000;
    let removed = 0, bytes = 0;
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(full); continue; }
        if (!e.name.endsWith(".tmp")) continue;
        const st = await fs.stat(full).catch(() => null);
        if (!st || st.mtimeMs > cutoff) continue;
        bytes += st.size;
        await fs.rm(full, { force: true }).catch(() => {});
        removed++;
      }
    };
    await walk(audioDir());
    console.log(`清理一小时前的 .tmp 半成品：${removed} 个，${(bytes / 1024).toFixed(1)} KB`);
  } else { console.error("请指定 --voice 音色名 | --orphans | --failed | --tmp"); process.exit(1); }
}

const run = { generate, stats, prune }[cmd ?? ""];
if (!run) { console.error("用法：tsx scripts/audio.ts generate|stats|prune …"); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); }).finally(() => { closeEdge(); return prisma.$disconnect(); });

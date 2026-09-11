/**
 * 运营脚本：外部词典数据（ECDICT，MIT 协议）→ dict_entry → word 表。不调用任何 AI / 付费接口。
 *
 * 用法（在项目根目录）：
 *   npm run dict:load  [-- --file data/ecdict/ecdict.csv]
 *       ecdict.csv 全量写入 dict_entry（先清空再写，约 77 万行，1–3 分钟）。
 *       文件下载：https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
 *   npm run dict:sync  [-- --max-rank 30000] [--forms] [--only words|phrases] [--limit N] [--dry-run] [--prune]
 *       按规则把 dict_entry 筛入 word 表：有考试标签 / 牛津 3000 / 柯林斯星级的词与短语直接收；
 *       当代语料词频排名 frq ≤ max-rank 的词也收（BNC 排名不单独作数），但纯变形（went / abandoned 这类）不收，除非 --forms。
 *       新词新建（kind 按是否含空格），已有词只更新词典字段，不动 ai_* 字段。可重复执行。
 *       --prune：把之前由本脚本写入、按现在的规则不再入选、且没有用户数据（自建 / 导入词库、进度、备注、记录、AI 资料）的词从 word 表删掉；
 *               内置词库里的引用会级联删除，之后重跑 npm run wordbooks:build 即可。
 *   npm run dict:stats
 *       两张表的数量统计（按标签 / 类型）。
 */
import "dotenv/config";
import { createReadStream, existsSync } from "fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { mergeDictRows, selectReason, wordCreateData, type DictFields, type DictRow } from "../src/lib/dict";
import { isValidWord, wordKind } from "../src/lib/words";
import { CsvParser } from "../src/lib/csv";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f: string) => argv.includes(`--${f}`);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const usage = () => { console.error("用法：npx tsx scripts/dict.ts load [--file 路径] | sync [--max-rank 30000] [--forms] [--only words|phrases] [--limit N] [--dry-run] | stats"); process.exit(1); };

/** 流式解析 CSV：状态机在 src/lib/csv.ts（那里有单测） */
async function* csvRows(file: string): AsyncGenerator<string[]> {
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  const parser = new CsvParser();
  for await (const chunk of stream as AsyncIterable<string>) for (const row of parser.push(chunk)) yield row;
  for (const row of parser.end()) yield row;
}

const HEADER = ["word", "phonetic", "definition", "translation", "pos", "collins", "oxford", "tag", "bnc", "frq", "exchange", "detail", "audio"];
/** ECDICT 用字面量 \n 表示换行；空字符串存为 null，0 词频 / 0 星级存为 null */
const text = (s: string) => { const v = s.replace(/\\n/g, "\n").replace(/\\r/g, "").trim(); return v || null; };
const int = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 ? n : null; };

async function load() {
  const file = arg("file", "data/ecdict/ecdict.csv");
  if (!existsSync(file)) { console.error(`找不到 ${file}，请先下载：curl -L -o ${file} https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`); process.exit(1); }
  const t0 = Date.now();
  // 先读一行校验表头再清空：反过来的话表头不符就留下一张空表，期间新建的词条永久没有词典字段（审计 F086）
  const rows = csvRows(file);
  const first = await rows.next();
  if (first.done || first.value.join(",") !== HEADER.join(",")) { console.error(`表头不符：${first.done ? "文件为空" : first.value.join(",")}`); process.exit(1); }
  const removed = await prisma.dictEntry.deleteMany();
  console.log(`清空 dict_entry：${removed.count} 行`);
  let batch: Prisma.DictEntryCreateManyInput[] = [], total = 0, bad = 0;
  const flush = async () => { if (!batch.length) return; await prisma.dictEntry.createMany({ data: batch, skipDuplicates: true }); total += batch.length; batch = []; process.stdout.write(`写入 ${total} 行\r`); };
  for await (const r of rows) {
    if (r.length !== HEADER.length || !r[0].trim()) { bad++; continue; }
    const word = r[0].trim();
    batch.push({
      word, spelling: word.toLowerCase().replace(/\s+/g, " "),
      phonetic: text(r[1]), definition: text(r[2]), translation: text(r[3]), pos: text(r[4]),
      collins: int(r[5]), oxford: r[6].trim() === "1", tag: text(r[7]), bnc: int(r[8]), frq: int(r[9]),
      exchange: text(r[10]), detail: text(r[11]), audio: text(r[12]),
    });
    if (batch.length >= 2000) await flush();
  }
  await flush();
  console.log(`\n完成：写入 ${total} 行，跳过异常行 ${bad}，用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
}

async function sync() {
  const maxRank = Number(arg("max-rank", "30000"));
  const includeForms = has("forms");
  const only = arg("only", "all");
  const limit = Number(arg("limit", "0"));
  const dry = has("dry-run");
  const prune = has("prune");
  const opts = { maxRank, includeForms };
  console.log(`规则：max-rank=${maxRank} forms=${includeForms} only=${only}${limit ? ` limit=${limit}` : ""}${dry ? "（试运行，不写库）" : ""}`);

  // 1. 用 SQL 先粗筛出可能入选的行，再在内存里按规则精筛
  const where: Prisma.DictEntryWhereInput = { OR: [{ tag: { not: null } }, { oxford: true }, { collins: { gt: 0 } }, ...(maxRank > 0 ? [{ frq: { gt: 0, lte: maxRank } }, { bnc: { gt: 0, lte: maxRank } }] : [])] };
  const cands = await prisma.dictEntry.findMany({ where, select: { word: true, spelling: true, translation: true, tag: true, oxford: true, collins: true, bnc: true, frq: true, exchange: true }, orderBy: { word: "asc" } });
  const reasons = new Map<string, string>();
  const skipped = { invalid: 0, kind: 0, rule: 0 };
  for (const r of cands) {
    if (!isValidWord(r.spelling)) { skipped.invalid++; continue; }
    const kind = wordKind(r.spelling);
    if ((only === "words" && kind === "phrase") || (only === "phrases" && kind === "word")) { skipped.kind++; continue; }
    const reason = selectReason(r, opts);
    if (!reason) { skipped.rule++; continue; }
    if (!reasons.has(r.spelling)) reasons.set(r.spelling, reason);
  }
  let spellings = [...reasons.keys()].sort();
  if (limit > 0) spellings = spellings.slice(0, limit);
  const byKind = { word: 0, phrase: 0 };
  for (const s of spellings) byKind[wordKind(s)]++;
  const byReason: Record<string, number> = {};
  for (const s of spellings) byReason[reasons.get(s)!] = (byReason[reasons.get(s)!] ?? 0) + 1;
  console.log(`候选 ${cands.length} 行 → 入选 ${spellings.length} 条（单词 ${byKind.word}，短语 ${byKind.phrase}）；理由 ${JSON.stringify(byReason)}；跳过：拼写不合法 ${skipped.invalid}，类型过滤 ${skipped.kind}，纯变形 / 词频超限 ${skipped.rule}`);

  // 2. 取整组（含大小写变体）合并成词典字段，写入 word 表
  let created = 0, updated = 0;
  const samples: string[] = [];
  for (let i = 0; i < spellings.length; i += 1000) {
    const chunk = spellings.slice(i, i + 1000);
    const rows = await prisma.dictEntry.findMany({ where: { spelling: { in: chunk } }, select: { word: true, spelling: true, phonetic: true, definition: true, translation: true, collins: true, oxford: true, tag: true, bnc: true, frq: true, exchange: true } });
    const groups = new Map<string, DictRow[]>();
    for (const r of rows) (groups.get(r.spelling) ?? groups.set(r.spelling, []).get(r.spelling)!).push(r);
    const fields = new Map<string, DictFields>();
    for (const [s, g] of groups) fields.set(s, mergeDictRows(g));
    if (samples.length < 30) for (const s of chunk.slice(0, 30 - samples.length)) samples.push(`${s} [${reasons.get(s)}] ${(fields.get(s)?.translation ?? "").split("\n")[0].slice(0, 40)}`);
    if (dry) continue;
    const existing = new Set((await prisma.word.findMany({ where: { spelling: { in: chunk } }, select: { spelling: true } })).map((w) => w.spelling));
    const fresh = chunk.filter((s) => !existing.has(s) && fields.has(s));
    if (fresh.length) { await prisma.word.createMany({ data: fresh.map((s) => wordCreateData(s, fields.get(s))), skipDuplicates: true }); created += fresh.length; }
    const old = chunk.filter((s) => existing.has(s) && fields.has(s));
    for (let j = 0; j < old.length; j += 200) {
      const part = old.slice(j, j + 200);
      await prisma.$transaction(part.map((s) => prisma.word.update({ where: { spelling: s }, data: { ...fields.get(s)!, dictSource: "ecdict", dictUpdatedAt: new Date() } })));
      updated += part.length;
    }
    process.stdout.write(`写入 ${Math.min(i + 1000, spellings.length)} / ${spellings.length}\r`);
  }
  console.log(`\n样例：\n  ${samples.join("\n  ")}`);
  if (!dry) console.log(`完成：新建 ${created}，更新词典字段 ${updated}`);

  // 3. --prune：清掉不再入选、又没有任何用户数据的词典来源词条
  if (prune) {
    // 删除基准是「本次入选的集合」，被 --limit / --only 截断过就会把没参与比较的词全删掉（审计 F081）
    if (limit > 0 || only !== "all") throw new Error("--prune 不能与 --limit / --only 同用：删除基准会被截断的入选集合带偏，请单独执行 npm run dict:sync -- --prune");
    const selected = new Set(spellings);
    const mine = await prisma.word.findMany({
      // feedback 也算用户数据：漏掉它会把用户提过问题的词连同反馈一起级联删掉（审计 F087）
      where: { dictSource: "ecdict", aiOpenai: { is: null }, aiDeepseek: { is: null }, progress: { none: {} }, notes: { none: {} }, logs: { none: {} }, feedback: { none: {} }, wordbooks: { none: { wordbook: { type: { not: "builtin" } } } } },
      select: { id: true, spelling: true },
    });
    const gone = mine.filter((w) => !selected.has(w.spelling));
    console.log(`prune：${gone.length} 条不再入选且无用户数据${gone.length ? "，如：" + gone.slice(0, 12).map((w) => w.spelling).join(", ") : ""}`);
    if (!dry && gone.length) {
      for (let i = 0; i < gone.length; i += 1000) await prisma.word.deleteMany({ where: { id: { in: gone.slice(i, i + 1000).map((w) => w.id) } } });
      console.log(`prune：已删除 ${gone.length} 条；内置词库请重跑 npm run wordbooks:build`);
    }
  }
}

async function stats() {
  const n = (v: unknown) => Number(v);
  const [d] = await prisma.$queryRaw<Array<{ total: bigint; tagged: bigint; oxford: bigint; collins: bigint; phrases: bigint }>>`
    SELECT count(*) total, count(*) FILTER (WHERE tag IS NOT NULL) tagged, count(*) FILTER (WHERE oxford) oxford,
           count(*) FILTER (WHERE collins > 0) collins, count(*) FILTER (WHERE spelling LIKE '% %') phrases FROM dict_entry`;
  console.log(`dict_entry：共 ${n(d.total)} 行，带考试标签 ${n(d.tagged)}，牛津 3000 ${n(d.oxford)}，柯林斯星级 ${n(d.collins)}，短语 ${n(d.phrases)}`);
  const w = await prisma.$queryRaw<Array<{ kind: string; total: bigint; with_dict: bigint; with_openai: bigint; with_deepseek: bigint }>>`
    SELECT w.kind::text, count(*) total, count(w.dict_source) with_dict, count(o.word_id) with_openai, count(d.word_id) with_deepseek
    FROM word w LEFT JOIN word_ai_openai o ON o.word_id = w.id LEFT JOIN word_ai_deepseek d ON d.word_id = w.id GROUP BY w.kind ORDER BY w.kind`;
  for (const r of w) console.log(`word（${r.kind}）：共 ${n(r.total)}，有词典字段 ${n(r.with_dict)}，AI 字段 OpenAI ${n(r.with_openai)} / DeepSeek ${n(r.with_deepseek)}`);
  const t = await prisma.$queryRaw<Array<{ tag: string; c: bigint }>>`SELECT unnest(tags) tag, count(*) c FROM word GROUP BY 1 ORDER BY 2 DESC`;
  console.log(`word 标签：${t.map((r) => `${r.tag} ${n(r.c)}`).join("，") || "无"}`);
  const b = await prisma.wordbook.findMany({ where: { type: "builtin" }, select: { name: true, wordCount: true } });
  console.log(`内置词库：${b.map((x) => `${x.name}（${x.wordCount}）`).join("，") || "无"}`);
}

(async () => {
  if (cmd === "load") await load();
  else if (cmd === "sync") await sync();
  else if (cmd === "stats") await stats();
  else usage();
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

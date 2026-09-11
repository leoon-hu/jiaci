/**
 * 运营脚本：按定义生成 / 刷新内置词库。数据来自 word 表的词典字段（标签、词频、星级）和 lists/ 下的词表文件，不调用 AI。
 *
 * 用法（在项目根目录）：
 *   npm run wordbooks:build                   # 建立或刷新 BOOKS 定义的全部内置词库
 *   npm run wordbooks:build -- --dry-run      # 只打印每本的词数、开头几个词和词表里缺的词，不写库
 *   npm run wordbooks:build -- --only 四级词汇
 *   npm run wordbooks:build -- --drop-unknown # 顺带删掉不在 BOOKS 里的内置词库（改名后清理旧的）
 *
 * 词表文件 lists/*.txt：一行一条（单词或短语），# 后是注释。构建前会把词表里还不在 word 表的词从 dict_entry 补进来；
 * ECDICT 没有的词可以写在 lists/补充词典.tsv（拼写、音标、释义）里，仍然找不到的会列出来跳过。
 *
 * 规则（细节见 src/lib/wordbook-rules.ts）：
 *   - 所有词库剔除功能词（src/lib/stopwords.ts）、单字母、无词性的短缩写、带 sb / sth 占位的短语；单词库不含短语。
 *   - 高频系列：当代语料词频 ≤ 7000，或牛津标记且排名 ≤ 15000，或柯林斯 ≥ 3 星且排名 ≤ 10000，或带标签且 BNC 排名 ≤ 6000；
 *     按排名切成核心 / 进阶 / 拓展。
 *   - 考试词库：ECDICT 标签 ∪ lists/考试-*.txt（公开大纲整理）∪ 常用国名地名 lists/地名-常用.txt（GRE 除外），按词频排序，无排名的排最后；
 *     雅思、托福另并入学术词表 AWL / NAWL 与通用核心词表 NGSL；
 *     雅思再加话题词、参考词表补充词（lists/考试-雅思补充.txt），并在单词之后附上雅思常见短语（lists/考试-雅思短语.txt）；
 *     雅思核心是雅思词汇里的单词按排名筛出的常用部分（排名 ≤ 8500，或牛津标记，或柯林斯 ≥ 3 星），约 6000 词，不含短语。
 *   - 所有单词库去掉专名（只有大写词头且释义是单行短专名，星期月份节日语言除外）、lists/排除.txt 里的词（高频系列另加 lists/高频-排除.txt），
 *     以及「原形已在同一本里」且词典没给独立词频的变形（teams / tickets / feet）；原形不在本里的这类变形换成原形（beginners → beginner）；
 *     有自己词频或星级的 learning / means / terms 保留，lists/保留变形.txt 里的 refreshments / arms 也保留。
 *   - 学术词汇：AWL 570 词族（按 sublist 顺序）+ 派生词，再加 NAWL。
 *   - 英美拼写：同一本里只留美式（src/lib/spelling-variants.ts，对照表之外的 -ise / -isation 按后缀换）。
 *   - 常用短语：lists/短语-常用动词短语.txt 在前，再加牛津标记或柯林斯 ≥ 2 星的短语；其余带词典信号或场景词表里的短语进「常用词组」；
 *     专名短语（英国机构名等）不收；只出现在考试短语表里的短语不进这两本。
 *   - 生活场景：lists/场景-*.txt 按文件顺序。
 *   - 可重复执行：按名称找到已有内置词库后整表刷新成员与顺序；用户学习进度按词保存，不受影响。
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { isStopword } from "../src/lib/stopwords";
import { EXAM_TAGS, TAG_LABEL, inflectionOf, looksLikeName, parseExchange, wordCreateData } from "../src/lib/dict";
import { lookupDictFields } from "../src/lib/dict-db";
import { isValidWord, normalizeWord, wordKind } from "../src/lib/words";
import { dropInflections, isJunkShort, isPlaceholderPhrase, isProperNounLike, parseListFile, parseSupplement, preferAmerican } from "../src/lib/wordbook-rules";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const dry = argv.includes("--dry-run");
const dropUnknown = argv.includes("--drop-unknown");
/** 与 --drop-unknown 搭配：连仍被用户当作当前词库的旧本一起删（审计 F117） */
const force = argv.includes("--force");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx > -1 ? argv[onlyIdx + 1] : null;
const LISTS = path.join(process.cwd(), "lists");

type Cand = {
  id: string; spelling: string; kind: "word" | "phrase"; tags: string[]; frq: number | null; bnc: number | null; rank: number | null;
  collins: number | null; oxford: boolean; translation: string | null; display: string | null; hasSignal: boolean; base: string | null; form: string | null;
};
type Ctx = { all: Cand[]; bySpelling: Map<string, Cand>; list: (name: string) => Cand[] };
type Book = { name: string; note: string; pick: (ctx: Ctx) => Cand[] };

const byRank = (a: Cand, b: Cand) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.spelling.localeCompare(b.spelling);
/** 短语没有词频，用组成词里最生僻那个的排名近似：ice cream 排在 affirmative action 前面 */
const phraseRank = (c: Cand, by: Map<string, Cand>) => { let r = 0; for (const t of c.spelling.split(" ")) { if (isStopword(t)) continue; const wr = by.get(t)?.rank ?? 1e5; if (wr > r) r = wr; } return r || 1e5; };
const byPhrase = (by: Map<string, Cand>) => (a: Cand, b: Cand) => Number(b.oxford) - Number(a.oxford) || (b.collins ?? 0) - (a.collins ?? 0) || phraseRank(a, by) - phraseRank(b, by) || a.spelling.localeCompare(b.spelling);
const union = (...lists: Cand[][]) => { const seen = new Set<string>(); const out: Cand[] = []; for (const l of lists) for (const c of l) if (!seen.has(c.spelling)) { seen.add(c.spelling); out.push(c); } return out; };
const readText = (name: string) => (existsSync(path.join(LISTS, name)) ? readFileSync(path.join(LISTS, name), "utf8") : "");
const readList = (name: string) => parseListFile(readText(name), normalizeWord, isValidWord);
/** 所有单词库都排除的词：月份缩写、Dr、专名规则漏掉的国名地名等；高频系列另外排除和原形并存的 better / best / left */
const EXCLUDE = new Set(readList("排除.txt"));
const HF_EXCLUDE = new Set(readList("高频-排除.txt"));
/** 变形去重时一律保留的形式：skiing、refreshments 这类有独立词义、但词典没给星级的 */
const INFLECTION_KEEP = new Set(readList("保留变形.txt"));
/** 常用国名地名（lists/地名-常用.txt）：考试词库里作为专名规则的例外收进来 */
const PLACES = new Set(readList("地名-常用.txt"));
/** 单词库通用剔除：单字母 / 无词性短缩写、专名、人名地名、排除表；places 为真时放行常用地名表里的词 */
const wordOk = (c: Cand, places = false) => c.kind === "word" && !isJunkShort(c) && ((places && PLACES.has(c.spelling)) || (!isProperNounLike(c) && !looksLikeName(c.translation) && !EXCLUDE.has(c.spelling)));
/** 变形去重（原形不在本里的换成原形） */
const dedupeForms = (list: Cand[], ctx: Ctx) => dropInflections(list, { available: ctx.bySpelling, keep: INFLECTION_KEEP });
/** 专名短语里仍值得学的几个 */
const PHRASE_KEEP = new Set(["id card", "new year", "christmas tree", "christmas eve", "christmas card", "santa claus", "ice age", "milky way", "cd player", "third world", "native american", "american football"]);

let hfCache: Cand[] | null = null;
/** 高频系列的池子：按规则筛选并排好序，三本各切一段 */
function hfPool(ctx: Ctx): Cand[] {
  if (hfCache) return hfCache;
  const pool = ctx.all.filter((c) =>
    wordOk(c) && !HF_EXCLUDE.has(c.spelling) && (
      (c.frq != null && c.frq <= 7000) ||
      (c.oxford && c.rank != null && c.rank <= 15000) ||
      ((c.collins ?? 0) >= 3 && c.rank != null && c.rank <= 10000) ||
      (c.frq == null && c.bnc != null && c.bnc <= 6000 && c.hasSignal)));
  hfCache = preferAmerican(dedupeForms(pool, ctx).sort(byRank), ctx.bySpelling);
  return hfCache;
}
const examName = (tag: string) => (/^[A-Za-z]/.test(TAG_LABEL[tag]) ? `${TAG_LABEL[tag]} 词汇` : `${TAG_LABEL[tag]}词汇`);
const ACADEMIC = ["词表-AWL.txt", "词表-NAWL.txt", "词表-NGSL.txt"];
const PLACES_LIST = "地名-常用.txt";
const EXAM_LISTS: Record<string, string[]> = { zk: ["考试-中考.txt", PLACES_LIST], gk: ["考试-高考.txt", PLACES_LIST], cet4: ["考试-四级.txt", PLACES_LIST], cet6: ["考试-六级新增.txt", PLACES_LIST], ky: ["考试-考研.txt", PLACES_LIST], toefl: ["考试-托福.txt", ...ACADEMIC, PLACES_LIST], ielts: [...ACADEMIC, "考试-雅思话题.txt", "考试-雅思补充.txt", PLACES_LIST], gre: ["考试-GRE.txt"] };
/** 考试词库里附在单词之后的短语词表 */
const EXAM_PHRASES: Record<string, string> = { ielts: "考试-雅思短语.txt" };
const examBook = (tag: string): Book => ({
  name: examName(tag), note: `ECDICT 标签 ${tag}${EXAM_LISTS[tag]?.length ? ` ∪ ${EXAM_LISTS[tag].join(" / ")}` : ""}，按词频排序${EXAM_PHRASES[tag] ? `，末尾附 ${EXAM_PHRASES[tag]}` : ""}`,
  pick: (ctx) => {
    const ws = preferAmerican(dedupeForms(union(ctx.all.filter((c) => c.tags.includes(tag)), ...(EXAM_LISTS[tag] ?? []).map((f) => ctx.list(f))).filter((c) => wordOk(c, true)), ctx).sort(byRank), ctx.bySpelling);
    const ps = EXAM_PHRASES[tag] ? ctx.list(EXAM_PHRASES[tag]).filter(phraseOk).sort(byPhrase(ctx.bySpelling)) : [];
    return union(ws, ps);
  },
});
const phraseOk = (c: Cand) => c.kind === "phrase" && !isPlaceholderPhrase(c.spelling) && (!c.display || PHRASE_KEEP.has(c.spelling));
/** 雅思核心的排名上限：雅思词汇的单词按这个排名切下来约 5900 词，再加上牛津 / 柯林斯 ≥ 3 星的低频基础词（timetable、fridge、tidy）约 6000 */
const IELTS_CORE_RANK = 8500;
const ieltsCore: Book = {
  name: "雅思核心", note: `雅思词汇里的单词：排名 ≤ ${IELTS_CORE_RANK}，或牛津标记，或柯林斯 ≥ 3 星；顺序同雅思词汇，不含短语`,
  pick: (ctx) => BOOKS.find((b) => b.name === "雅思词汇")!.pick(ctx).filter((c) => c.kind === "word" && ((c.rank != null && c.rank <= IELTS_CORE_RANK) || c.oxford || (c.collins ?? 0) >= 3)),
};
const scenario = (title: string, file: string): Book => ({ name: `海外生活 · ${title}`, note: `lists/${file} 按文件顺序`, pick: (ctx) => ctx.list(file) });
const SCENARIOS: [string, string][] = [["租房与家居", "场景-租房与家居.txt"], ["看病与药房", "场景-看病与药房.txt"], ["银行税务办事", "场景-银行税务办事.txt"], ["职场与邮件", "场景-职场与邮件.txt"], ["孩子上学", "场景-孩子上学.txt"], ["数字生活", "场景-数字生活.txt"]];

/** 内置词库定义 */
export const BOOKS: Book[] = [
  { name: "高频核心", note: "词频池前 1000", pick: (ctx) => hfPool(ctx).slice(0, 1000) },
  { name: "高频进阶", note: "词频池第 1001–3000", pick: (ctx) => hfPool(ctx).slice(1000, 3000) },
  { name: "高频拓展", note: "词频池第 3001 起（含牛津 / 柯林斯核心词）", pick: (ctx) => hfPool(ctx).slice(3000) },
  // 雅思核心排在雅思词汇前面：先学核心再学全本，与高频核心 → 进阶 → 拓展的顺序一致
  ...EXAM_TAGS.flatMap((tag) => (tag === "ielts" ? [ieltsCore, examBook(tag)] : [examBook(tag)])),
  { name: "学术词汇", note: "AWL 570 词族按 sublist 顺序 + 派生词，再加 NAWL（留学 / 学术写作）", pick: (ctx) => dedupeForms(union(ctx.list("词表-AWL.txt"), ctx.list("词表-NAWL.txt")).filter((c) => wordOk(c)), ctx) },
  {
    name: "常用短语", note: "lists/短语-常用动词短语.txt 在前，再加牛津标记或柯林斯 ≥ 2 星的短语",
    pick: (ctx) => union(ctx.list("短语-常用动词短语.txt").filter((c) => c.kind === "phrase"), ctx.all.filter((c) => phraseOk(c) && (c.oxford || (c.collins ?? 0) >= 2)).sort(byPhrase(ctx.bySpelling))).filter((c) => !isPlaceholderPhrase(c.spelling)),
  },
  {
    name: "常用词组", note: "其余带词典信号（标签 / 牛津 / 柯林斯）或场景词表里的短语（多为柯林斯 1 星复合名词），不含专名短语",
    pick: (ctx) => {
      const core = new Set(BOOKS.find((b) => b.name === "常用短语")!.pick(ctx).map((c) => c.spelling));
      const listed = new Set(SCENARIOS.flatMap(([, file]) => readList(file)));
      return ctx.all.filter((c) => phraseOk(c) && !core.has(c.spelling) && (c.hasSignal || listed.has(c.spelling))).sort(byPhrase(ctx.bySpelling));
    },
  },
  ...SCENARIOS.map(([title, file]) => scenario(title, file)),
];

/** 词表里还不在 word 表的词：从 dict_entry 补，其次用补充词典，都没有就报出来 */
async function ensureListWords(): Promise<string[]> {
  const files = readdirSync(LISTS).filter((f) => f.endsWith(".txt") && !f.includes("排除"));
  const wanted = new Set<string>();
  for (const f of files) for (const w of readList(f)) wanted.add(w);
  const all = [...wanted];
  const existing = new Set<string>();
  for (let i = 0; i < all.length; i += 2000) for (const w of await prisma.word.findMany({ where: { spelling: { in: all.slice(i, i + 2000) } }, select: { spelling: true } })) existing.add(w.spelling);
  const missing = all.filter((w) => !existing.has(w));
  const supplement = parseSupplement(readText("补充词典.tsv"), normalizeWord);
  let fromDict = 0, fromSupplement = 0;
  const notFound: string[] = [];
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const dict = await lookupDictFields(chunk, prisma);
    const data = [];
    for (const s of chunk) {
      const f = dict.get(s);
      const sup = supplement.get(s);
      if (f) { data.push(wordCreateData(s, f)); fromDict++; }
      else if (sup) { data.push({ spelling: s, kind: wordKind(s), phonetic: sup.phonetic, translation: sup.translation, dictSource: "manual", dictUpdatedAt: new Date() }); fromSupplement++; }
      else notFound.push(s);
    }
    if (data.length && !dry) await prisma.word.createMany({ data, skipDuplicates: true });
  }
  console.log(`词表共 ${wanted.size} 条：已在 word 表 ${existing.size}，从 dict_entry 补 ${fromDict}，从补充词典补 ${fromSupplement}，找不到 ${notFound.length}${dry ? "（试运行未写入）" : ""}`);
  if (notFound.length) console.log(`  找不到的词（跳过）：${notFound.join(", ")}`);
  return notFound;
}

async function main() {
  const notFound = await ensureListWords();
  const rows = await prisma.word.findMany({ select: { id: true, spelling: true, kind: true, tags: true, frq: true, bnc: true, collins: true, oxford: true, translation: true, display: true, exchange: true } });
  const all: Cand[] = rows
    .map((r) => ({ id: r.id, spelling: r.spelling, kind: r.kind, tags: r.tags, frq: r.frq, bnc: r.bnc, rank: r.frq ?? r.bnc ?? null, collins: r.collins, oxford: r.oxford, translation: r.translation, display: r.display, hasSignal: r.tags.length > 0 || r.oxford || (r.collins ?? 0) > 0, base: inflectionOf({ word: r.spelling, exchange: r.exchange }), form: parseExchange(r.exchange)["1"] ?? null }))
    .filter((c) => !isStopword(c.spelling) && !(c.spelling.length <= 3 && c.spelling.includes("'")));
  const bySpelling = new Map(all.map((c) => [c.spelling, c]));
  const listCache = new Map<string, Cand[]>();
  const ctx: Ctx = { all, bySpelling, list: (name) => { if (!listCache.has(name)) listCache.set(name, readList(name).map((w) => bySpelling.get(w)).filter((c): c is Cand => !!c && !isStopword(c.spelling))); return listCache.get(name)!; } };
  console.log(`候选词条 ${all.length}（word 表 ${rows.length}）${dry ? "，试运行不写库" : ""}`);
  const summary: string[] = [];
  for (const def of BOOKS) {
    if (only && def.name !== only) continue;
    const picked = def.pick(ctx);
    const head = picked.slice(0, 8).map((w) => w.spelling).join(", ");
    if (dry) { summary.push(`${def.name.padEnd(12, "　")} ${String(picked.length).padStart(5)} 词  ${def.note}；开头：${head}`); continue; }
    // sort_order 用 BOOKS 的下标，界面按它排；建库时间是乱的（审计 NU04）
    const bookOrder = BOOKS.indexOf(def);
    let book = await prisma.wordbook.findFirst({ where: { type: "builtin", name: def.name } });
    if (!book) book = await prisma.wordbook.create({ data: { name: def.name, type: "builtin", sortOrder: bookOrder } });
    else if (book.sortOrder !== bookOrder) await prisma.wordbook.update({ where: { id: book.id }, data: { sortOrder: bookOrder } });
    const existing = await prisma.wordbookWord.findMany({ where: { wordbookId: book.id }, select: { wordId: true, sortOrder: true } });
    const order = new Map(picked.map((w, i) => [w.id, i]));
    const removeIds = existing.filter((e) => !order.has(e.wordId)).map((e) => e.wordId);
    const had = new Map(existing.map((e) => [e.wordId, e.sortOrder]));
    const fresh = picked.filter((w) => !had.has(w.id)).map((w) => ({ wordbookId: book!.id, wordId: w.id, sortOrder: order.get(w.id)! }));
    const moved = picked.filter((w) => had.has(w.id) && had.get(w.id) !== order.get(w.id));
    // 删旧 / 加新 / 调序 / 回填词数放进一个事务：中途失败会留下成员、顺序与 word_count 对不上的半状态（审计 F092）
    const bookId = book.id;
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < removeIds.length; i += 1000) await tx.wordbookWord.deleteMany({ where: { wordbookId: bookId, wordId: { in: removeIds.slice(i, i + 1000) } } });
      for (let i = 0; i < fresh.length; i += 1000) await tx.wordbookWord.createMany({ data: fresh.slice(i, i + 1000), skipDuplicates: true });
      for (const w of moved) await tx.wordbookWord.update({ where: { wordbookId_wordId: { wordbookId: bookId, wordId: w.id } }, data: { sortOrder: order.get(w.id)! } });
      await tx.wordbook.update({ where: { id: bookId }, data: { wordCount: picked.length } });
    }, { timeout: 300_000, maxWait: 30_000 });
    summary.push(`${def.name.padEnd(12, "　")} ${String(picked.length).padStart(5)} 词  新增 ${fresh.length}，移除 ${removeIds.length}，调序 ${moved.length}；开头：${head}`);
  }
  console.log(summary.join("\n"));
  if (dropUnknown && !dry) {
    const names = BOOKS.map((b) => b.name);
    const stale = await prisma.wordbook.findMany({ where: { type: "builtin", name: { notIn: names } }, select: { id: true, name: true } });
    if (stale.length) {
      // 删词库会级联清掉 user_current_wordbook：正被人当作当前词库的本不能默默删（改名就是删旧建新，审计 F117）
      const inUse = await prisma.userCurrentWordbook.groupBy({ by: ["wordbookId"], where: { wordbookId: { in: stale.map((s) => s.id) } }, _count: { userId: true } });
      const used = new Map(inUse.map((u) => [u.wordbookId, u._count.userId]));
      const blocked = stale.filter((s) => used.has(s.id));
      const free = stale.filter((s) => !used.has(s.id));
      if (blocked.length && !force) {
        console.log(`跳过删除（仍是用户的当前词库，加 --force 才删）：${blocked.map((s) => `${s.name}（${used.get(s.id)} 人）`).join("，")}`);
      }
      const toDrop = force ? stale : free;
      if (toDrop.length) { await prisma.wordbook.deleteMany({ where: { id: { in: toDrop.map((s) => s.id) } } }); console.log(`已删除不在定义里的内置词库：${toDrop.map((s) => s.name).join("，")}`); }
    }
  }
  if (notFound.length) console.log(`提醒：${notFound.length} 个词表里的词找不到释义，可加到 lists/补充词典.tsv`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * 运营脚本：按 lists/同类词.tsv 建立 / 刷新同类词类别（需求 3.4 I7）。不调用 AI，也不碰 word 表。
 *
 * 用法（在项目根目录）：
 *   npm run categories:build                  # 建立或刷新全部类别
 *   npm run categories:build -- --dry-run     # 只打印每个类别的词数、开头几个词和 word 表里找不到的词，不写库
 *
 * 词表一行一个类别：「类别名<TAB>词, 词=释义, 词」，# 后是注释，类别与词的先后就是展示顺序；「词=释义」给多义词指定在这个类别里显示的义项（解析规则见 src/lib/categories.ts）。
 * 只收 word 表里有的词：找不到的列出来跳过，不往 word 表补词（同类词是给已收录的词互相关联用的）。
 * 按类别名整表刷新成员与顺序，文件里没有的类别删掉；这两张表上没有任何用户数据，可随时重跑。
 */
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { CATEGORY_MIN_WORDS, parseCategoryList } from "../src/lib/categories";

const prisma = new PrismaClient();
const dry = process.argv.includes("--dry-run");
const FILE = path.join(process.cwd(), "lists", "同类词.tsv");

async function main() {
  const { categories, problems } = parseCategoryList(readFileSync(FILE, "utf8"));
  for (const p of problems) console.warn(`! ${p}`);
  const wanted = Array.from(new Set(categories.flatMap((c) => c.entries.map((e) => e.w))));
  const idOf = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += 2000) for (const w of await prisma.word.findMany({ where: { spelling: { in: wanted.slice(i, i + 2000) } }, select: { id: true, spelling: true } })) idOf.set(w.spelling, w.id);
  const missing = wanted.filter((w) => !idOf.has(w));
  console.log(`词表 ${categories.length} 个类别、${wanted.length} 个不同的词：word 表里有 ${idOf.size}，找不到 ${missing.length}${dry ? "（试运行不写库）" : ""}`);
  if (missing.length) console.log(`  找不到的词（跳过）：${missing.join(", ")}`);

  const summary: string[] = [];
  const kept: string[] = [];
  let memberTotal = 0;
  for (const [order, def] of categories.entries()) {
    const present = def.entries.filter((e) => idOf.has(e.w));
    if (present.length < CATEGORY_MIN_WORDS) { console.warn(`! 「${def.name}」word 表里只有 ${present.length} 个词，跳过`); continue; }
    kept.push(def.name);
    memberTotal += present.length;
    const head = present.slice(0, 6).map((e) => e.w).join(", ");
    if (dry) { summary.push(`${def.name.padEnd(8, "　")} ${String(present.length).padStart(3)} 词  ${head}…`); continue; }
    // 每个成员要写的顺序与释义；比对已有的行，只改有变化的
    const want = new Map(present.map((e, i) => [idOf.get(e.w)!, { sortOrder: i, gloss: e.gloss }]));
    await prisma.$transaction(async (tx) => {
      const cat = await tx.wordCategory.upsert({ where: { name: def.name }, create: { name: def.name, sortOrder: order }, update: { sortOrder: order }, select: { id: true } });
      const existing = await tx.wordCategoryMember.findMany({ where: { categoryId: cat.id }, select: { wordId: true, sortOrder: true, gloss: true } });
      const had = new Map(existing.map((e) => [e.wordId, e]));
      const gone = existing.filter((e) => !want.has(e.wordId)).map((e) => e.wordId);
      const fresh = [...want].filter(([id]) => !had.has(id)).map(([id, v]) => ({ categoryId: cat.id, wordId: id, ...v }));
      const changed = [...want].filter(([id, v]) => had.has(id) && (had.get(id)!.sortOrder !== v.sortOrder || had.get(id)!.gloss !== v.gloss));
      if (gone.length) await tx.wordCategoryMember.deleteMany({ where: { categoryId: cat.id, wordId: { in: gone } } });
      if (fresh.length) await tx.wordCategoryMember.createMany({ data: fresh, skipDuplicates: true });
      for (const [id, v] of changed) await tx.wordCategoryMember.update({ where: { categoryId_wordId: { categoryId: cat.id, wordId: id } }, data: v });
      summary.push(`${def.name.padEnd(8, "　")} ${String(present.length).padStart(3)} 词  新增 ${fresh.length}，移除 ${gone.length}，改动 ${changed.length}`);
    });
  }
  console.log(summary.join("\n"));
  if (!dry) {
    const stale = await prisma.wordCategory.findMany({ where: { name: { notIn: kept } }, select: { name: true } });
    if (stale.length) { await prisma.wordCategory.deleteMany({ where: { name: { in: stale.map((s) => s.name) } } }); console.log(`已删除词表里没有的类别：${stale.map((s) => s.name).join("、")}`); }
  }
  console.log(`共 ${kept.length} 个类别、${memberTotal} 条成员`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

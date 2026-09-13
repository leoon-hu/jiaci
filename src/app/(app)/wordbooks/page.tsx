import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getCurrentWordbookId, ownProgressBooks, wordbookProgressMany } from "@/lib/study";
import WordbooksClient from "./wordbooks-client";

/** 词库列表：与 /api/wordbooks 同一套查询，服务端直接查好渲染进 HTML（性能优化 P1-1） */
export default async function WordbooksPage() {
  const user = await requireUser();
  const [books, currentId] = await Promise.all([
    prisma.wordbook.findMany({ where: { OR: [{ type: "builtin" }, { ownerId: user.id }] }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    getCurrentWordbookId(user.id),
  ]);
  const [progress, own] = await Promise.all([wordbookProgressMany(user.id, books.map((b) => b.id)), ownProgressBooks(user.id)]);
  const initial = books.map((b) => {
    const p = progress.get(b.id) ?? { learned: 0, mastered: 0, removed: 0 };
    // createdAt 交给客户端排序用，序列化成字符串与接口保持一致
    return { id: b.id, name: b.name, type: b.type, wordCount: b.wordCount, createdAt: b.createdAt.toISOString(), learned: p.learned, mastered: p.mastered, removed: p.removed, isCurrent: b.id === currentId, ownProgress: own.has(b.id) };
  });
  return <WordbooksClient initial={initial} />;
}

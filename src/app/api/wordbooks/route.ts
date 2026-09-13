import { z } from "zod";
import { withUser, ok, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getCurrentWordbookId, ownProgressBooks, wordbookProgressMany } from "@/lib/study";

/**
 * 词库列表。`?scope=current` 只返回当前学习的那一本（首页用）：
 * 进度统计的代价随词库本数增长（线上实测一本约 6 ms、22 本 17–25 ms），
 * 首页只显示当前词库，没必要把每一本都算一遍再丢掉（性能优化 P1-6）。
 */
export const GET = withUser(async (req, _ctx, user) => {
  const currentOnly = new URL(req.url).searchParams.get("scope") === "current";
  const [all, currentId] = await Promise.all([
    prisma.wordbook.findMany({ where: { OR: [{ type: "builtin" }, { ownerId: user.id }] }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    getCurrentWordbookId(user.id),
  ]);
  const books = currentOnly ? all.filter((b) => b.id === currentId) : all;
  const [progress, own] = await Promise.all([wordbookProgressMany(user.id, books.map((b) => b.id)), ownProgressBooks(user.id)]);
  const withProgress = books.map((b) => {
    const p = progress.get(b.id) ?? { learned: 0, mastered: 0, removed: 0 };
    return { id: b.id, name: b.name, type: b.type, wordCount: b.wordCount, createdAt: b.createdAt, learned: p.learned, mastered: p.mastered, removed: p.removed, isCurrent: b.id === currentId, ownProgress: own.has(b.id) };
  });
  return ok({ wordbooks: withProgress, currentId });
});

export const POST = withUser(async (req, _ctx, user) => {
  const { name } = z.object({ name: z.string().trim().min(1, "请输入词库名称").max(30, "最多 30 个字符") }).parse(await readJson(req));
  const book = await prisma.wordbook.create({ data: { name, type: "custom", ownerId: user.id } });
  return ok({ id: book.id, name: book.name, type: book.type }, { status: 201 });
});

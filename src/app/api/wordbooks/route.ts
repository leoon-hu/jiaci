import { z } from "zod";
import { withUser, ok, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getConfigInt } from "@/lib/config";
import { createOwnWordbook, getCurrentWordbookId, ownProgressBooks, wordbookProgressMany } from "@/lib/study";

/**
 * 词库列表。`?scope=current` 只返回当前学习的那一本（首页用）：
 * 进度统计的代价随词库本数增长（线上实测一本约 6 ms、22 本 17–25 ms），
 * 首页只显示当前词库，没必要把每一本都算一遍再丢掉（性能优化 P1-6）。
 * `quota` = 自己的词库（导入 + 自建）有几本、最多几本（3.3.1），新建 / 导入页与选择框据此提前说「满了」。
 */
export const GET = withUser(async (req, _ctx, user) => {
  const currentOnly = new URL(req.url).searchParams.get("scope") === "current";
  const [all, currentId, max] = await Promise.all([
    prisma.wordbook.findMany({ where: { OR: [{ type: "builtin" }, { ownerId: user.id }] }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    getCurrentWordbookId(user.id),
    getConfigInt("wordbook.max_per_user"),
  ]);
  const books = currentOnly ? all.filter((b) => b.id === currentId) : all;
  const [progress, own] = await Promise.all([wordbookProgressMany(user.id, books.map((b) => b.id)), ownProgressBooks(user.id)]);
  const withProgress = books.map((b) => {
    const p = progress.get(b.id) ?? { learned: 0, mastered: 0, removed: 0 };
    return { id: b.id, name: b.name, type: b.type, wordCount: b.wordCount, createdAt: b.createdAt, learned: p.learned, mastered: p.mastered, removed: p.removed, isCurrent: b.id === currentId, ownProgress: own.has(b.id) };
  });
  return ok({ wordbooks: withProgress, currentId, quota: { used: all.filter((b) => b.ownerId === user.id).length, max } });
});

export const POST = withUser(async (req, _ctx, user) => {
  const { name } = z.object({ name: z.string().trim().min(1, "请输入词库名称").max(30, "最多 30 个字符") }).parse(await readJson(req));
  const book = await prisma.$transaction((tx) => createOwnWordbook(tx, user.id, { name, type: "custom" }));
  return ok({ id: book.id, name: book.name, type: book.type }, { status: 201 });
});

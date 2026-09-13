import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getBookmark, getCurrentWordbookId, ownProgressOf, wordbookProgress } from "@/lib/study";
import WordbookClient from "./wordbook-client";

/**
 * 词库详情：词库信息与书签在服务端查好直接渲染（性能优化 P1-1），与 /api/wordbooks/[id] 同一套查询。
 * 单词列表仍由客户端取——它要按「后退还原的浏览状态 / 书签位置」决定从第几行开始加载。
 */
export default async function WordbookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const book = await prisma.wordbook.findFirst({ where: { id, OR: [{ type: "builtin" }, { ownerId: user.id }] } });
  if (!book) return <WordbookClient initialBook={null} initialBookmark={null} initialError="词库不存在" />;
  const [p, currentId, bookmark, ownProgress] = await Promise.all([
    wordbookProgress(user.id, id),
    getCurrentWordbookId(user.id),
    getBookmark(user.id, id),
    ownProgressOf(user.id, id),
  ]);
  return (
    <WordbookClient
      initialBook={{ id: book.id, name: book.name, type: book.type, wordCount: book.wordCount, learned: p.learned, mastered: p.mastered, isCurrent: currentId === id, ownProgress }}
      initialBookmark={bookmark}
    />
  );
}

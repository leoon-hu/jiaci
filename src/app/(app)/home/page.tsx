import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { buildTodayQueue, getCurrentWordbookId, ownProgressOf, totals, wordbookProgressMany } from "@/lib/study";
import { DATE_COOKIE, resolveToday } from "@/lib/dates";
import HomeClient from "./home-client";

/**
 * 学习首页的数据在服务端算好直接渲染进 HTML（性能优化 P1-1）：
 * 原来页面是纯客户端组件，首屏只有「加载中…」，要等 JS 下载解析完再发两个接口，
 * 海外用户白等一轮跨洋往返。这里直接调 lib/study 的函数，不经过 HTTP。
 * 队列本身（items）首页用不到，statsOnly 只算统计数字、不把词取回来——原来那个接口不但把整条队列
 * 算了出来，还整条发给了首页。
 */
export default async function HomePage() {
  const user = await requireUser();
  // 「今天」按客户端写在 Cookie 里的本地日期算（resolveToday 校验：相差 ≤ 1 天才采用，审计 F035）
  const today = resolveToday((await cookies()).get(DATE_COOKIE)?.value);
  const [q, t, currentId] = await Promise.all([
    buildTodayQueue(user.id, today, { statsOnly: true }),
    totals(user.id),
    getCurrentWordbookId(user.id),
  ]);
  const book = currentId ? await prisma.wordbook.findUnique({ where: { id: currentId }, select: { id: true, name: true, wordCount: true } }) : null;
  const [learned, ownProgress] = book
    ? await Promise.all([wordbookProgressMany(user.id, [book.id]).then((m) => m.get(book.id)?.learned ?? 0), ownProgressOf(user.id, book.id)])
    : [0, false];
  return (
    <HomeClient
      initial={{ today, hasBook: q.hasBook, stats: q.stats, totals: t }}
      initialBook={book ? { ...book, learned, isCurrent: true, ownProgress } : null}
    />
  );
}

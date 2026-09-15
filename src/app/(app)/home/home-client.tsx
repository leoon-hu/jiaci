"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import InstallTip from "@/components/InstallTip";
import { coverText } from "@/lib/client/format";
import { api, localToday } from "@/lib/client/api";
import "./home.css";

type Today = {
  today: string; hasBook: boolean;
  stats: { newCount: number; reviewCount: number; doneToday: number; reviewDeferred: number; newRemaining: number };
  totals: { learned: number; mastered: number };
};
type Book = { id: string; name: string; wordCount: number; learned: number; isCurrent: boolean; ownProgress: boolean };

/**
 * 学习首页（需求 3.2.1）。数据由 page.tsx 在服务端算好传进来，首屏直接有内容，不必等
 * 「下 JS → 发接口 → 再渲染」这一轮往返（性能优化 P1-1）。
 * 服务端按 Cookie 里的客户端本地日期算「今天」；拿不到 Cookie（第一次访问）时用的是服务器日期，
 * 与本地日期不一致就在这里补一次请求纠正。
 */
export default function HomeClient({ initial, initialBook }: { initial: Today; initialBook: Book | null }) {
  const [data, setData] = useState<Today>(initial);
  const [book, setBook] = useState<Book | null>(initialBook);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (localToday() === initial.today) return;
    // 首页只用当前词库那一行：scope=current 让服务端不必把每一本词库的进度都统计一遍
    Promise.all([api<Today>(`/api/study/today?date=${localToday()}`), api<{ wordbooks: Book[] }>("/api/wordbooks?scope=current")])
      .then(([t, b]) => { setData(t); setBook(b.wordbooks.find((x) => x.isCurrent) ?? null); })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 日期在挂载后再算：服务端按 UTC 渲染、客户端按本地时区渲染，两边不一致会让整棵树 hydration 失败重建（审计 F040）
  const [dateLine, setDateLine] = useState("");
  useEffect(() => {
    const d = new Date();
    setDateLine(`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`);
  }, []);
  const pending = data.stats.newCount + data.stats.reviewCount;
  const done = pending === 0 && data.stats.doneToday > 0;

  return (
    <AppShell nav="study">
      <main className="page narrow">
        <div className="page-head" style={{ marginBottom: 8 }}><div><h1 className="page-title">今日学习</h1><p className="page-sub">{dateLine || "\u00a0"}</p></div></div>
        {/* 安装引导（需求 4.1）：没装成应用时第一次打开就在最上面，不等选词库 */}
        <InstallTip />
        {err && <div className="err-msg">{err}</div>}
        {!data.hasBook || !book ? (
          <div className="empty-book">
            <div className="icon">📚</div>
            <h3 style={{ margin: "8px 0 4px" }}>还没有选择词库</h3>
            <p className="muted">从内置词库中选一本，或导入你自己的单词本，就可以开始学习了。</p>
            <Link className="btn btn-primary btn-lg mt-12" href="/wordbooks">去选择词库</Link>
          </div>
        ) : (
          <>
            <div className="section">
              <div className="book-pick">
                <div className="cover">{coverText(book.name)}</div>
                <div className="grow"><div className="small muted">当前词库{book.ownProgress && <span className="tag tag-own" style={{ marginLeft: 8 }} title="这本词库用自己的一套进度">独立进度</span>}</div><div style={{ fontWeight: 700, fontSize: 17 }}>{book.name}</div></div>
                <Link className="btn btn-secondary btn-sm" href="/wordbooks">切换</Link>
              </div>
              <div className="progress thin mt-12"><i style={{ width: `${book.wordCount ? (book.learned / book.wordCount) * 100 : 0}%` }} /></div>
              <div className="small muted mt-8">已学 {book.learned} / {book.wordCount} 词</div>
            </div>
            <div className="section no-line">
              <div className="section-title" style={{ marginTop: 0 }}>今日任务</div>
              <div className="stats today">
                <div className="stat hi"><b>{data.stats.newCount}</b><span>待学新词</span></div>
                <div className="stat"><b>{data.stats.reviewCount}</b><span>待复习</span></div>
                <div className="stat ok"><b>{data.stats.doneToday}</b><span>今日已完成</span></div>
              </div>
              {!done && pending > 0 && (
                <>
                  <Link className="btn btn-primary btn-lg btn-block mt-12" href="/study">开始学习</Link>
                  {data.stats.reviewDeferred > 0 && <p className="small muted center mt-12" style={{ marginBottom: 0 }}>{data.stats.reviewDeferred} 个复习词已顺延</p>}
                </>
              )}
              {pending === 0 && (
                <>
                  <div className="done-banner mt-12"><span>✅</span> {data.stats.doneToday > 0 ? "今日任务已完成，做得好！" : "今天没有待学的词"}</div>
                  {data.stats.newRemaining > 0 && <Link className="btn btn-secondary btn-lg btn-block mt-12" href="/study?extra=1">再学一组（额外新词）</Link>}
                </>
              )}
              {/* 跑步模式（需求 3.2.6）：有词库就显示；今天没有待学也没有已完成的词时进去是空态 */}
              <Link className="btn btn-secondary btn-lg btn-block mt-12" href="/run" prefetch={false}>🎧 跑步模式</Link>
              <div className="totals"><span>累计已学 <b>{data.totals.learned}</b></span><span>已掌握 <b>{data.totals.mastered}</b></span></div>
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

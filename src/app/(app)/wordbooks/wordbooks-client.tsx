"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import SwipeTabs from "@/components/SwipeTabs";
import { coverText } from "@/lib/client/format";
import Modal from "@/components/Modal";
import { IconChevron, IconTrash } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/useMe";
import { STATUS_LABEL, type WordStatus } from "@/lib/status";
import "./wordbooks.css";

type Book = { id: string; name: string; type: "builtin" | "import" | "custom"; wordCount: number; learned: number; mastered: number; removed: number; isCurrent: boolean; createdAt: string; ownProgress: boolean };
/** 行里四色数量的顺序，与单词列表的筛选 chips 一致 */
const STATUS_ORDER: WordStatus[] = ["new", "learning", "mastered", "none"];
/**
 * 一本词库按四色状态的数量（与单词列表页 counts 的口径一致，见 lib/status.ts 的 deriveStatus）：
 * 状态跟着单词走，不看这本是不是当前词库——没学过的词是「未开始」，移出学习的词是「未加入」。
 */
function statusCounts(b: Book): Record<WordStatus, number> {
  return { new: Math.max(0, b.wordCount - b.learned - b.removed), learning: b.learned - b.mastered, mastered: b.mastered, none: b.removed };
}
const TYPE_TAG: Record<Book["type"], [string, string]> = { builtin: ["tag-builtin", "内置"], import: ["tag-import", "导入"], custom: ["tag-custom", "自建"] };
const COVER: Record<Book["type"], string> = { builtin: "linear-gradient(135deg,#4f6df5,#7c5cff)", import: "linear-gradient(135deg,#d97706,#f59e0b)", custom: "linear-gradient(135deg,#1f9d64,#10b981)" };
/** 记住上次停留的 Tab（本机，按用户区分，换账号不串） */
const tabKey = (userId: string) => `aiword.wordbooks.tab.${userId}`;

/**
 * 词库列表（需求 3.3.1）：三个 Tab——正在学习 / 我的词库（导入 + 自建）/ 内置词库，点击或左右滑动切换。
 * 列表由 page.tsx 在服务端查好传进来，首屏直接有内容（性能优化 P1-1）；之后的切换、删除仍走接口刷新。
 */
export default function WordbooksClient({ initial }: { initial: Book[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const { me } = useMe();
  const [books, setBooks] = useState<Book[] | null>(initial);
  const [del, setDel] = useState<Book | null>(null);
  const [tab, setTabState] = useState(0);
  const picked = useRef(false);
  const load = useCallback(() => api<{ wordbooks: Book[] }>("/api/wordbooks").then((r) => setBooks(r.wordbooks)).catch((e) => toast((e as Error).message)), [toast]);

  const current = books?.find((b) => b.isCurrent) ?? null;
  const mine = (books ?? []).filter((b) => b.type !== "builtin").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const builtin = (books ?? []).filter((b) => b.type === "builtin");

  // 首次进入：按上次停留的 Tab；没有记录时，有当前词库停在「正在学习」，否则有自己的词库停在「我的词库」，再否则「内置词库」
  useEffect(() => {
    if (!books || !me || picked.current) return;
    picked.current = true;
    let saved: number | null = null;
    try { const v = localStorage.getItem(tabKey(me.id)); if (v !== null && /^[0-2]$/.test(v)) saved = Number(v); } catch { /* 隐私模式等 */ }
    setTabState(saved ?? (books.some((b) => b.isCurrent) ? 0 : books.some((b) => b.type !== "builtin") ? 1 : 2));
  }, [books, me]);
  const setTab = (i: number) => { setTabState(i); if (me) { try { localStorage.setItem(tabKey(me.id), String(i)); } catch { /* ignore */ } } };

  // 失败要给提示，不能让弹窗卡着或静默什么都不发生（审计 F063）
  async function setCurrent(b: Book) {
    try { await api("/api/wordbooks/current", { method: "PUT", json: { wordbookId: b.id } }); toast(`已切换到「${b.name}」`); load(); }
    catch (e) { toast((e as Error).message); }
  }
  async function confirmDelete() {
    if (!del) return;
    try { await api(`/api/wordbooks/${del.id}`, { method: "DELETE" }); toast("词库已删除"); load(); }
    catch (e) { toast((e as Error).message); }
    finally { setDel(null); }
  }
  /** 一行词库；showType：是否显示「内置 / 导入 / 自建」标签（内置词库 Tab 里不重复显示） */
  const renderRow = (b: Book, showType: boolean) => {
    const pct = b.wordCount ? (b.learned / b.wordCount) * 100 : 0, mp = b.wordCount ? (b.mastered / b.wordCount) * 100 : 0;
    const counts = statusCounts(b);
    return (
      <div className={"row book-row" + (b.isCurrent ? " current" : "")} key={b.id} onClick={() => router.push(`/wordbooks/${b.id}`)}>
        <div className="cover" style={{ background: COVER[b.type] }}>{coverText(b.name)}</div>
        <div className="main">
          <div className="flex wrap" style={{ gap: 8 }}><span className="title">{b.name}</span><span className="count">{b.wordCount} 词</span>{b.isCurrent && <span className="tag tag-current">学习中</span>}{b.ownProgress && <span className="tag tag-own" title="这本词库用自己的一套进度">独立进度</span>}{showType && <span className={`tag ${TYPE_TAG[b.type][0]}`}>{TYPE_TAG[b.type][1]}</span>}</div>
          <div className="book-stats">{STATUS_ORDER.map((s) => <span key={s} className={`st st-${s}`} title={STATUS_LABEL[s]} aria-label={`${STATUS_LABEL[s]} ${counts[s]}`}><i />{counts[s]}</span>)}</div>
          <div className="progress thin stacked mt-8"><i className="ok" style={{ width: `${mp}%`, zIndex: 1 }} /><i className="learn" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="ops" onClick={(e) => e.stopPropagation()}>
          {b.isCurrent ? <button className="btn btn-soft btn-sm" disabled>当前学习中</button> : <button className="btn btn-primary btn-sm" onClick={() => setCurrent(b)}>设为当前学习</button>}
          {b.type !== "builtin" && <button className="btn btn-icon sm btn-ghost del" title="删除词库" onClick={() => setDel(b)}><IconTrash /></button>}
          {b.type === "builtin" && <span className="chev"><IconChevron /></span>}
        </div>
      </div>
    );
  };
  const labels = ["正在学习", mine.length ? `我的词库 ${mine.length}` : "我的词库", builtin.length ? `内置词库 ${builtin.length}` : "内置词库"];
  return (
    <AppShell nav="books">
      <main className="page medium">
        <div className="page-head">
          <div><h1 className="page-title">词库</h1><p className="page-sub">同一时间只能学习一个词库，切换后进度仍会保留</p></div>
          <div className="btn-row"><Link className="btn btn-secondary" href="/import">导入单词本</Link><Link className="btn btn-primary" href="/wordbooks/new">+ 新建词库</Link></div>
        </div>
        {!books ? <p className="muted">加载中…</p> : (
          <div className="books-tabs">
            <SwipeTabs tabs={labels} index={tab} onChange={setTab}>
              <div className="books-panel">
                {current ? (
                  <>
                    <div className="list edge">{renderRow(current, true)}</div>
                    <p className="small faint mt-8">要换一本，到「我的词库」或「内置词库」里点「设为当前学习」。</p>
                  </>
                ) : (
                  <div className="books-empty">
                    <p>还没有正在学习的词库</p>
                    <div className="btn-row"><button className="btn btn-primary btn-sm" type="button" onClick={() => setTab(2)}>去选内置词库</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setTab(1)}>看我的词库</button></div>
                  </div>
                )}
              </div>
              <div className="books-panel">
                {mine.length ? <div className="list edge">{mine.map((b) => renderRow(b, true))}</div> : <div className="books-empty"><p>还没有导入或创建的词库</p><p className="small faint">用上面的「导入单词本」或「+ 新建词库」添加</p></div>}
              </div>
              <div className="books-panel">
                {builtin.length ? <div className="list edge">{builtin.map((b) => renderRow(b, false))}</div> : <div className="books-empty"><p className="faint">运营方尚未添加内置词库</p></div>}
              </div>
            </SwipeTabs>
          </div>
        )}
        <p className="small faint mt-12">点击词库查看单词列表。内置词库不可删除；删除自己导入 / 创建的词库会一并删除其学习记录。</p>
      </main>
      <Modal open={!!del} onClose={() => setDel(null)}>
        <h3>删除词库「{del?.name}」？</h3>
        <p>该词库及其中的学习记录将一并删除，且无法恢复。内置词库中的同名单词不受影响。</p>
        <div className="actions"><button className="btn btn-secondary" onClick={() => setDel(null)}>取消</button><button className="btn btn-danger" onClick={confirmDelete}>确认删除</button></div>
      </Modal>
    </AppShell>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { emitWordChanged } from "@/lib/client/word-events";
import { quotaFull, quotaFullMessage, type BookQuota } from "@/lib/wordbook-quota";
import Modal from "./Modal";
import { IconCheck } from "./Icons";
import { useToast } from "./Toast";

type Book = { id: string; name: string; wordCount: number; has: boolean };
/**
 * 给哪些词开选择框：
 * - `spelling`：单词详情操作区 / 点词小框里的一个词，按拼写加（词表里还没有的按词典新建），每本标出有没有这个词；
 * - `wordIds`：单词列表多选的一批词，按列表顺序加，已经在目标词库里的自动跳过；`exclude` = 正在看的这本，不列出
 */
export type CollectTarget = { spelling: string } | { wordIds: string[]; exclude?: string };
/** 按 id 批量加词一次最多几个（接口上限），多了切片 */
const BATCH_MAX = 500;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * 「加入我的词库」选择框（需求 3.3.4 / 3.3.5）：单词详情操作区、点词小框、单词列表多选共用。
 * 列出自建词库，点「加入」立即加进去、框不关，可以接着加到别的词库；
 * 下面一行当场新建一本并把词加进去——从学习页的点词小框跳去「新建词库」页会打断这一轮学习；
 * 「我的词库」满了（导入 + 自建合计，3.3.1）就不显示这一行，只说一句为什么。
 * `target` 为 null 时不显示；`onClose(added)` 告诉调用方这次有没有加进去过，要是稳定的引用（加载失败时也会调用）
 */
export default function CollectModal({ target, onClose }: { target: CollectTarget | null; onClose: (added: boolean) => void }) {
  const { toast } = useToast();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [quota, setQuota] = useState<BookQuota | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const addedAny = useRef(false);
  const close = () => onClose(addedAny.current);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    addedAny.current = false;
    setBooks(null); setQuota(null); setName("");
    const load = "spelling" in target
      ? api<{ wordbooks: Book[]; quota: BookQuota }>(`/api/words/${encodeURIComponent(target.spelling)}/collect`)
      // 一批词不标「已加入」（多半是有的在、有的不在），只列出正在看的这本以外的自建词库，新建的在前
      : api<{ wordbooks: Array<{ id: string; name: string; type: string; wordCount: number; createdAt: string }>; quota: BookQuota }>("/api/wordbooks").then((r) => ({
        quota: r.quota,
        wordbooks: r.wordbooks
          .filter((b) => b.type === "custom" && b.id !== target.exclude)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((b) => ({ id: b.id, name: b.name, wordCount: b.wordCount, has: false })),
      }));
    load.then((r) => { if (alive) { setBooks(r.wordbooks); setQuota(r.quota); } })
      .catch((e) => { if (alive) { onClose(false); toast((e as Error).message); } });
    return () => { alive = false; };
  }, [target, onClose, toast]);

  /** 加进一本词库并把那一行标成已加入；失败抛给调用方提示 */
  async function addTo(book: { id: string; name: string }) {
    if (!target) return;
    let added: number;
    if ("spelling" in target) {
      const r = await api<{ added: boolean; name: string }>(`/api/words/${encodeURIComponent(target.spelling)}/collect`, { method: "POST", json: { wordbookId: book.id } });
      added = r.added ? 1 : 0;
      toast(r.added ? `已加入「${r.name}」` : `「${r.name}」中已有该词`);
      // 从某本词库的列表点进详情再加词：列表一直挂在浮层底下，得推一把让它刷新
      if (r.added) emitWordChanged(target.spelling);
    } else {
      let existed = 0;
      added = 0;
      for (const ids of chunk(target.wordIds, BATCH_MAX)) {
        const r = await api<{ added: string[]; existed: string[] }>(`/api/wordbooks/${book.id}/words`, { method: "POST", json: { wordIds: ids } });
        added += r.added.length; existed += r.existed.length;
      }
      toast(!added ? `选中的词「${book.name}」里都有了` : existed ? `已加入「${book.name}」${added} 个，另外 ${existed} 个本来就有` : `已加入「${book.name}」${added} 个`);
    }
    addedAny.current = true;
    setBooks((bs) => bs && bs.map((b) => (b.id === book.id ? { ...b, has: true, wordCount: b.wordCount + added } : b)));
  }
  async function join(book: Book) {
    if (busy) return;
    setBusy(true);
    try { await addTo(book); } catch (e) { toast(`没有加入成功：${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function create() {
    const v = name.trim();
    if (!target || !v || busy) return;
    setBusy(true);
    try {
      const b = await api<{ id: string; name: string }>("/api/wordbooks", { method: "POST", json: { name: v } });
      // 新建的排最前（按创建时间倒序），先放进列表再加词，加词失败也能看到它、再点「加入」
      setBooks((bs) => [{ id: b.id, name: b.name, wordCount: 0, has: false }, ...(bs ?? [])]);
      setQuota((q) => q && { ...q, used: q.used + 1 });
      setName("");
      await addTo(b);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  const n = target && "wordIds" in target ? target.wordIds.length : 0;
  const full = quotaFull(quota);
  return (
    <Modal open={!!target} onClose={close}>
      <h3>加入我的词库</h3>
      <p>{target && "spelling" in target ? `把「${target.spelling}」加到你创建的词库里，可以加到好几本。` : `把选中的 ${n} 个词加到你创建的词库里，已经在里面的不会重复加。`}</p>
      {!books ? <p className="muted small">加载中…</p> : (
        <>
          {books.length > 0 ? (
            <div className="list collect-list">{books.map((b) => (
              <div className="row" key={b.id}>
                <span className="main"><span className="title">{b.name}</span><span className="sub">{b.wordCount} 词</span></span>
                {b.has ? <span className="collect-in"><IconCheck />已加入</span>
                  : <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => join(b)}>加入</button>}
              </div>
            ))}</div>
          ) : <p className="muted small">{n ? "你还没有别的自建词库" : "你还没有自建词库"}{full ? "。" : `，起个名字新建一本，${n ? "选中的词" : "这个词"}就放进去。`}</p>}
          {full && quota ? <p className="muted small collect-full">{quotaFullMessage(quota.max)}。</p> : (
            <div className="collect-new">
              <input className="input" placeholder={books.length ? "或者新建一本词库" : "词库名称，例如：我的生词"} maxLength={30} value={name}
                onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} aria-label="新词库名称" />
              <button type="button" className="btn btn-secondary" disabled={!name.trim() || busy} onClick={create}>新建并加入</button>
            </div>
          )}
        </>
      )}
      <div className="actions"><button type="button" className="btn btn-secondary" onClick={close}>完成</button></div>
    </Modal>
  );
}

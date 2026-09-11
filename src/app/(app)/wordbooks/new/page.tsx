"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/client/api";
import "./new.css";

type Row = { id: string; spelling: string; def: string };

/** 新建词库 + 手动添加（需求 3.3.4） */
export default function NewWordbookPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [book, setBook] = useState<{ id: string; name: string } | null>(null);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const wordRef = useRef<HTMLInputElement>(null);

  async function create() {
    const v = name.trim();
    if (!v) { toast("请输入词库名称"); return; }
    setBusy(true);
    try { const b = await api<{ id: string; name: string }>("/api/wordbooks", { method: "POST", json: { name: v } }); setBook(b); toast("词库已创建"); setTimeout(() => wordRef.current?.focus(), 50); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  // 默认一页 100 行，粘贴上百个词后列表与计数都会少（审计 F058）：取满一页上限，并用服务端 total 显示词数
  const reload = async (id: string) => {
    const r = await api<{ rows: Row[]; total: number }>(`/api/wordbooks/${id}/words?sort=order&limit=1000`);
    setRows(r.rows.slice().reverse()); setTotal(r.total);
  };
  async function add() {
    if (!book || !input.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ added: string[]; existed: string[]; bad: string[] }>(`/api/wordbooks/${book.id}/words`, { method: "POST", json: { input } });
      if (r.bad.length) toast(`已跳过非英文内容：${r.bad.slice(0, 3).join("、")}`);
      else if (r.existed.length && !r.added.length) toast("这些单词已在词库中");
      else toast(`已添加 ${r.added.length} 个`);
      setInput(""); await reload(book.id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <AppShell nav="books">
      <main className="page narrow">
        <Link className="back" href="/wordbooks">‹ 词库</Link>
        {!book ? (
          <>
            <div className="page-head mt-12"><div><h1 className="page-title">新建词库</h1><p className="page-sub">创建后可逐个添加单词，或从内置词库收藏单词进来</p></div></div>
            <div className="field"><label>词库名称</label><input className="input" placeholder="例如：我的雅思生词" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} /><div className="hint">最多 30 个字符</div></div>
            <button className="btn btn-primary btn-lg btn-block" onClick={create} disabled={busy}>创建词库</button>
            <p className="small muted center mt-16">已有单词文件？<Link href="/import">去导入单词本</Link></p>
          </>
        ) : (
          <>
            <div className="page-head mt-12"><div><h1 className="page-title">{book.name}</h1><p className="page-sub">已创建。添加的单词自动带上词典的音标和释义</p></div><span className="tag tag-custom">自建</span></div>
            <div className="field" style={{ marginBottom: 10 }}><label>添加单词</label>
              <div className="input-group"><input ref={wordRef} className="input" placeholder="输入单词或短语，回车添加" autoCapitalize="off" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="btn btn-primary" onClick={add} disabled={busy}>添加</button></div>
            </div>
            <div className="bulk">小技巧：可以一次粘贴多个，用逗号或换行分隔；短语直接用空格连接，如 give up。</div>
            <div className="section-title">已添加 {total || rows.length} 词{total > rows.length && <span className="muted small">（下面列出最近 {rows.length} 个）</span>}</div>
            <div className="list edge added">{rows.length ? rows.map((r) => (
              <div className="row" key={r.id}><div className="main"><div className="title">{r.spelling}</div><div className="sub">{r.def}</div></div>
              </div>
            )) : <div className="empty"><div className="icon">✍️</div>还没有单词，先添加一个吧</div>}</div>
            <div className="btn-row mt-24"><Link className="btn btn-secondary" href="/wordbooks">完成</Link><button className="btn btn-primary" onClick={async () => { await api("/api/wordbooks/current", { method: "PUT", json: { wordbookId: book.id } }); toast("已设为当前学习词库"); router.push("/home"); }}>设为当前学习</button></div>
          </>
        )}
      </main>
    </AppShell>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/client/api";
import { parseImportText, type ImportRow } from "@/lib/words";
import "./import.css";

const LABEL: Record<ImportRow["status"], React.ReactNode> = { ok: <span className="tag tag-learning">可导入</span>, dup: <span className="tag tag-danger">重复</span>, empty: <span className="tag tag-new">空行</span>, bad: <span className="tag tag-danger">非英文</span> };

/** 导入单词本（需求 3.3.3）：仅 txt，浏览器本地解析，只提交单词数组 */
export default function ImportPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof parseImportText> | null>(null);
  const [name, setName] = useState("");
  const [max, setMax] = useState(5000);
  const [book, setBook] = useState<{ id: string; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api<{ importMaxWords: number }>("/api/config/public").then((c) => setMax(c.importMaxWords)).catch(() => {}); }, []);

  /** 选文件后解析预览；词库名取文件名，上限 30 字要先截断，否则提交时才报参数错误（审计 F059） */
  function handleFile(f: File) {
    if (f.size > 2 * 1024 * 1024) { toast("文件超过 2 MB"); return; }
    if (!/\.txt$/i.test(f.name)) { toast("仅支持 .txt 文件，每行一个单词或短语"); return; }
    const rd = new FileReader();
    rd.onload = () => { setParsed(parseImportText(String(rd.result))); setFileName(f.name); setName(f.name.replace(/\.[^.]+$/, "").slice(0, 30)); setStep(2); };
    rd.readAsText(f, "utf-8");
  }
  async function start() {
    if (!parsed) return;
    setBusy(true);
    try {
      const r = await api<{ wordbookId: string; imported: number }>("/api/import", { method: "POST", json: { name: name.trim() || "导入的单词本", words: parsed.words } });
      setBook({ id: r.wordbookId, total: r.imported });
      setStep(3);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  const over = !!parsed && parsed.ok > max;
  return (
    <AppShell nav="books">
      <main className="page narrow">
        <Link className="back" href="/wordbooks">‹ 词库</Link>
        <div className="page-head mt-8"><div><h1 className="page-title">导入单词本</h1><p className="page-sub">仅支持 .txt 文本文件，每行一个单词或短语；文件在浏览器本地解析，只上传词条列表</p></div></div>
        <div className="steps"><span className={step === 1 ? "on" : "done"}>1 选择文件</span><span className={step === 2 ? "on" : step > 2 ? "done" : ""}>2 预览确认</span><span className={step === 3 ? "on" : ""}>3 完成</span></div>
        {step === 1 && (
          <>
            <div className="drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("over")} onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
              <div className="icon">📄</div><b>点击选择 .txt 文件，或拖拽到此处</b><p>每行一个单词或短语 · 文件 ≤ 2 MB · 最多 {max} 词</p>
              <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </div>
            <ul className="rules"><li>仅支持 <b>.txt</b>（UTF-8），每行一个英文单词或短语（短语用空格连接），行尾的中文释义会被忽略。</li><li>自动去除重复、空行及含非英文字符的行，导入后反馈「成功 N 条 / 跳过 M 条」。</li><li>导入的单词自动带上词典的音标与释义；更完整的 AI 资料由运营方统一填充。</li></ul>
            <div className="sample">{"resilient\nubiquitous\npragmatic\nscrutiny\n…"}</div>
          </>
        )}
        {step === 2 && parsed && (
          <>
            <div className="flex between wrap"><span className="file-chip">📄 {fileName}</span><a href="#" className="small" onClick={(e) => { e.preventDefault(); setStep(1); }}>重新选择</a></div>
            <div className="stats mt-16" style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "4px 0" }}>
              <div className="stat ok"><b>{parsed.ok}</b><span>可导入</span></div><div className="stat"><b>{parsed.skipped}</b><span>跳过（重复 / 空行 / 非英文）</span></div>
            </div>
            {over && <div className="err-msg mt-12">超过单次 {max} 词上限，请拆分文件后再导入。</div>}
            <div className="field mt-16"><label>词库名称</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="flex between">预览 <span className="faint" style={{ fontWeight: 400 }}>{parsed.rows.length > 10 ? `仅显示前 10 行，共 ${parsed.rows.length} 行` : `共 ${parsed.rows.length} 行`}</span></label>
              <div style={{ overflowX: "auto" }}><table className="preview-table"><thead><tr><th>#</th><th>单词</th><th>处理</th></tr></thead><tbody>{parsed.rows.slice(0, 10).map((r) => (<tr key={r.n}><td className="n">{r.n}</td><td className={r.status === "ok" ? "" : "skip"}>{r.raw || "（空行）"}</td><td>{LABEL[r.status]}</td></tr>))}</tbody></table></div>
            </div>
            <div className="btn-row mt-16"><button className="btn btn-secondary" onClick={() => setStep(1)}>上一步</button><button className="btn btn-primary" disabled={busy || over || !parsed.ok} onClick={start}>{busy ? "导入中…" : `确认导入 ${parsed.ok} 词`}</button></div>
          </>
        )}
        {step === 3 && book && (
            <div className="center" style={{ padding: "24px 0" }}>
              <div style={{ fontSize: 40 }}>🎉</div><h3 style={{ margin: "8px 0 4px" }}>导入完成</h3>
              <p className="muted">成功 <b style={{ color: "var(--ok)" }}>{book.total}</b> 条 / 跳过 <b>{parsed?.skipped ?? 0}</b> 条 · 词条已带上词典的音标与释义</p>
              <div className="btn-row mt-16"><Link className="btn btn-secondary" href={`/wordbooks/${book.id}`}>查看词库</Link><button className="btn btn-primary" onClick={async () => { await api("/api/wordbooks/current", { method: "PUT", json: { wordbookId: book.id } }); toast("已设为当前学习词库"); router.push("/home"); }}>设为当前学习并开始</button></div>
            </div>
        )}
      </main>
    </AppShell>
  );
}

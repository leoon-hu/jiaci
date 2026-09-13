"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { speakSentence, speakWord, voiceKeyOf } from "@/lib/client/speech";
import { STATUS_LABEL, type WordStatus } from "@/lib/status";
import type { WordDetail as Detail } from "@/lib/study";
import type { UserSettings } from "@/lib/settings";
import type { RateResult } from "@/lib/scheduler";
import type { WordView } from "@/lib/word-view";
import { AI_PROVIDER_LABEL } from "@/lib/ai/providers";
import WordTokens, { PickCtx } from "./WordTokens";
import WordPeek from "./WordPeek";
import SwipeTabs from "./SwipeTabs";
import WordFreqPanel from "./WordFreqPanel";
import { wordKind } from "@/lib/words";
import Modal from "./Modal";
import Link from "next/link";
import { IconBookmark, IconChevron, IconEdit, IconSpeaker, IconFlag } from "./Icons";
import { useToast } from "./Toast";

const RESULT: Record<RateResult, [string, string]> = { know: ["tag-result-know", "认识"], fuzzy: ["tag-review", "模糊"], master: ["tag-result-master", "已掌握"], reset: ["tag-result-reset", "重新记"], remove: ["tag-none", "移出"] };
const tagCls = (s: WordStatus) => `tag tag-${s === "new" ? "new" : s === "none" ? "none" : s}`;
function nextText(h: { r: RateResult; i: number }) {
  if (h.r === "master") return "不再出现"; if (h.r === "reset") return "按新词重背"; if (h.r === "remove") return "已移出学习";
  return h.i === 0 ? "今日再背" : `下次 ${h.i} 天后`;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LEVEL: Record<number, string> = { 1: "基础", 2: "自然", 3: "场景" };
const TABS = ["释义", "关联词", "记忆", "词频"];
/** 首屏默认折叠的块 */
type FoldKey = "meanings" | "collocations" | "phrases" | "patterns" | "family";

export type Wordbook = { id: string; name: string; type: string; wordCount: number };

const AI = () => <span className="ai">AI</span>;
/** 折叠块的一行摘要：前几条 + 条数 */
const summarize = (items: string[], n: number, max = 3) => items.slice(0, max).join(" · ") + (n > max ? ` · …（${n} 条）` : `（${n} 条）`);
const meaningsSummary = (v: WordView) => v.meanings.map((m) => `${m.pos ? m.pos + " " : ""}${m.senses.slice(0, 3).map((s) => s.zh.split(/[，,（(；;]/)[0]).join("；")}`).join(" · ");

/** 首屏折叠块：标题行显示摘要与箭头，点击展开 / 收起 */
function Fold({ title, ai = true, summary, open, onToggle, children }: { title: string; ai?: boolean; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={"entry-section fold" + (open ? " open" : "")}>
      <h4 role="button" aria-expanded={open} onClick={(e) => { if ((e.target as HTMLElement).closest(".w")) return; onToggle(); }}>
        {title} {ai && <AI />}{!open && <span className="fold-sum">{summary}</span>}<span className="chev"><IconChevron /></span>
      </h4>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}

/** 单词详情（需求 3.2.5）：学习答案页与独立详情页共用；顶部固定 + 四个 Tab */
export default function WordDetail({ detail, settings, onNoteChange }: { detail: Detail; settings: UserSettings; onNoteChange?: (note: string | null) => void }) {
  const { toast } = useToast();
  const v = detail.view;
  const accent = settings.accent;
  const vk = voiceKeyOf(accent, settings.voice);
  const [peek, setPeek] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState<Partial<Record<FoldKey, boolean>>>({});
  const [expanded, setExpanded] = useState(false);
  const [allHistory, setAllHistory] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbText, setFbText] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [noteText, setNoteText] = useState(detail.note ?? "");
  const [collectOpen, setCollectOpen] = useState(false);
  const [books, setBooks] = useState<Wordbook[]>([]);
  const [bookId, setBookId] = useState("");

  useEffect(() => { setNoteText(detail.note ?? ""); setExpanded(false); setAllHistory(false); setPeek(null); }, [detail.spelling, detail.note]);
  useEffect(() => { setTab(0); setOpen({}); }, [detail.spelling]);

  const onPick = useCallback((base: string) => setPeek(base), []);
  const closePeek = useCallback(() => setPeek(null), []);

  // 首屏折叠块：有内容的才算；「全部展开 / 全部收起」
  const foldKeys: FoldKey[] = [];
  if (v.meanings.length) foldKeys.push("meanings");
  if (v.collocations.length) foldKeys.push("collocations");
  if (v.phrases.length) foldKeys.push("phrases");
  if (v.patterns.length) foldKeys.push("patterns");
  if (v.family.length) foldKeys.push("family");
  /** 默认展开的块：词族短、常看，其余默认折叠 */
  const isOpen = (k: FoldKey) => open[k] ?? k === "family";
  const allOpen = foldKeys.length > 0 && foldKeys.every(isOpen);
  const toggle = (k: FoldKey) => setOpen((o) => ({ ...o, [k]: !isOpen(k) }));
  const toggleAll = () => setOpen(Object.fromEntries(foldKeys.map((k) => [k, !allOpen])));

  // 这三处失败时原来既不关弹窗也不提示，还会产生未处理的 Promise rejection（审计 F047）
  async function saveNote(text: string) {
    try {
      const r = await api<{ note: string | null }>(`/api/words/${encodeURIComponent(detail.spelling)}/note`, { method: "PUT", json: { note: text } });
      setNoteOpen(false); onNoteChange?.(r.note); toast(r.note ? "备注已保存（仅自己可见）" : "备注已清除");
    } catch (e) { toast(`备注没有保存：${(e as Error).message}`); }
  }
  async function sendFeedback() {
    const content = fbText.trim();
    if (!content || fbBusy) return;
    setFbBusy(true);
    try {
      await api(`/api/words/${encodeURIComponent(detail.spelling)}/feedback`, { method: "POST", json: { content } });
      setFbOpen(false); setFbText(""); toast("感谢反馈，我们会尽快核对");
    } catch (e) { toast((e as Error).message); } finally { setFbBusy(false); }
  }
  async function openCollect() {
    setCollectOpen(true);
    try {
      const r = await api<{ wordbooks: Wordbook[] }>("/api/wordbooks");
      const custom = r.wordbooks.filter((b) => b.type === "custom");
      setBooks(custom); setBookId(custom[0]?.id ?? "");
    } catch (e) { setCollectOpen(false); toast((e as Error).message); }
  }
  async function collect() {
    if (!bookId) return;
    try {
      const r = await api<{ added: boolean; name: string }>(`/api/words/${encodeURIComponent(detail.spelling)}/collect`, { method: "POST", json: { wordbookId: bookId } });
      setCollectOpen(false); toast(r.added ? `已加入「${r.name}」` : `「${r.name}」中已有该词`);
    } catch (e) { setCollectOpen(false); toast(`没有加入成功：${(e as Error).message}`); }
  }

  const p = detail.progress;
  const history = detail.history;
  const hist = history.slice().reverse();
  const shownHist = allHistory ? hist : hist.slice(0, 6);
  const hw = detail.spelling;
  const speaker = (text: string) => (
    <button className="btn btn-icon sm btn-ghost ex-speak" type="button" aria-label="朗读例句" onClick={(e) => { e.stopPropagation(); speakSentence(text, vk); }}><IconSpeaker /></button>
  );
  const kv = (items: Array<{ en: string; zh: string }>) => (
    <div className="kv-list">{items.map((c, i) => <div className="kv" key={i}><span className="en"><WordTokens text={c.en} headword={hw} /></span><span className="zh">{c.zh}</span></div>)}</div>
  );
  const family = (items: Array<{ w: string; pos: string; zh: string }>) => (
    <div className="kv-list">{items.map((f, i) => <div className="kv" key={i}><span className="en"><WordTokens text={f.w} headword={hw} />{f.pos && <span className="pos-sm">{f.pos}</span>}</span><span className="zh">{f.zh}</span></div>)}</div>
  );
  const relatedEmpty = !v.synonyms.length && !v.antonyms.length && !v.confusables.length && !v.mistakes.length && !v.inflections.length && !v.cognates.length;
  const memoryEmpty = !v.mnemonic && !v.etymology && !v.usage;

  return (
    <PickCtx.Provider value={onPick}>
      <div className="detail">
        <div className="entry">
          <div className="entry-head">
            <div className="entry-title"><span className={tagCls(detail.status)}>{STATUS_LABEL[detail.status]}</span><span className="spelling">{detail.display ?? detail.spelling}</span></div>
            <div className="entry-sub">
              <span className="phonetic">{v.phonetic ? (accent === "uk" ? v.phonetic.uk : v.phonetic.us) : "—"}</span>
              <button className="btn btn-icon sm btn-soft" type="button" aria-label="发音" onClick={() => speakWord(detail.spelling, vk)}><IconSpeaker /></button>
            </div>
          </div>
          {/* 四个 Tab：释义（首屏核心）/ 关联词 / 记忆 / 词频；左右滑动或点击切换 */}
          <SwipeTabs tabs={TABS} index={tab} onChange={setTab}>
            <div>
              {(v.core || foldKeys.length > 0) && (
                <div className="entry-section"><h4>核心义 {v.coreFromAi && <AI />}{foldKeys.length > 0 && <button type="button" className="fold-all" onClick={toggleAll}>{allOpen ? "全部收起" : "全部展开"}</button>}</h4>
                  {v.core ? <div className="core-def">{v.core}</div> : <div className="ai-pending">暂无释义</div>}</div>
              )}
              {!v.core && !foldKeys.length && <div className="entry-section"><div className="ai-pending">暂无词条资料。</div></div>}
              {v.meanings.length > 0 && (
                <Fold open={isOpen("meanings")} onToggle={() => toggle("meanings")} title="释义" ai={v.meaningsSource === "ai"} summary={meaningsSummary(v)}>
                  {v.meanings.map((m, i) => (
                    <div className="def-group" key={i}>{m.pos && <span className="pos">{m.pos}</span>}
                      <ol className="senses">{m.senses.map((s, j) => (
                        <li className="sense" key={j}>
                          <div className="zh"><span className="num">{j + 1}</span>{s.zh}</div>
                          {s.en && <div className="en">{s.en}</div>}
                          {s.ex && <div className="ex"><div className="en"><WordTokens text={s.ex.en} headword={hw} /></div><div className="zh">{s.ex.zh}</div></div>}
                        </li>
                      ))}</ol>
                    </div>
                  ))}
                </Fold>
              )}
              {detail.note && <div className="entry-section"><h4>我的备注</h4><div className="note" onClick={() => setNoteOpen(true)}><span className="txt">{detail.note}</span><span className="edit">修改</span></div></div>}
              {v.examples.length > 0 && <div className="entry-section"><h4>例句 <AI /></h4>
                {v.examples.map((e, i) => (
                  <div className="example" key={i}>
                    {settings.exSpeaker === "left" && speaker(e.en)}
                    <div className="ex-body"><div className="en"><WordTokens text={e.en} headword={hw} /></div><div className="zh">{e.zh}{e.level && <span className="ex-level">{LEVEL[e.level]}</span>}</div></div>
                    {settings.exSpeaker !== "left" && speaker(e.en)}
                  </div>
                ))}
              </div>}
              {v.collocations.length > 0 && <Fold open={isOpen("collocations")} onToggle={() => toggle("collocations")} title="搭配" summary={summarize(v.collocations.map((c) => c.en), v.collocations.length)}>{kv(v.collocations)}</Fold>}
              {v.phrases.length > 0 && <Fold open={isOpen("phrases")} onToggle={() => toggle("phrases")} title="短语与习语" summary={summarize(v.phrases.map((c) => c.en), v.phrases.length)}>{kv(v.phrases)}</Fold>}
              {v.patterns.length > 0 && (
                <Fold open={isOpen("patterns")} onToggle={() => toggle("patterns")} title="句型" summary={summarize(v.patterns.map((c) => c.en), v.patterns.length, 4)}>
                  {v.patterns.map((pt, i) => (
                    <div className="pattern" key={i}>
                      <div className="p-en"><WordTokens text={pt.en} headword={hw} /></div><div className="p-zh">{pt.zh}</div>
                      {pt.ex && <div className="p-ex"><div className="en"><WordTokens text={pt.ex.en} headword={hw} /></div><div className="zh">{pt.ex.zh}</div></div>}
                    </div>
                  ))}
                </Fold>
              )}
              {v.family.length > 0 && <Fold open={isOpen("family")} onToggle={() => toggle("family")} title="词族" summary={summarize(v.family.map((f) => f.w), v.family.length, 4)}>{family(v.family)}</Fold>}
              {v.provider && <div className="ai-source">词条资料由 {AI_PROVIDER_LABEL[v.provider]} 填充，可在设置里切换来源</div>}
              <div className="detail-record">
                {!expanded ? (
                  <>
                    <h4>学习记录</h4>
                    {!history.length ? <div className="hist-empty">还没有学习记录</div> : (
                      <div className="hist-compact clickable" onClick={() => setExpanded(true)} title="点击查看详细记录">
                        <div className="hist-scroll">{history.map((h, i) => <span key={i} className={`tag ${RESULT[h.r][0]}`}>{RESULT[h.r][1]}</span>)}</div>
                        <span className="hist-hint">共 {history.length} 次 ›</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h4 className="flex">学习记录 · 详细<a className="hist-collapse" onClick={() => setExpanded(false)}>收起</a></h4>
                    <div className="record-grid">
                      <div className="stat"><b>{p.reps}</b><span>学习次数</span></div>
                      <div className="stat"><b>{p.lapses}</b><span>模糊次数</span></div>
                      <div className="stat"><b>{detail.status === "mastered" ? "—" : p.interval ? `${p.interval} 天` : "—"}</b><span>当前间隔</span></div>
                      <div className="stat"><b style={{ fontSize: 14, paddingTop: 5 }}>{detail.status === "mastered" ? "已掌握" : p.status === "new" ? (p.dueDate ? "今天（新词）" : "未安排") : p.dueDate ?? "—"}</b><span>下次复习</span></div>
                    </div>
                    <div className="history">
                      {shownHist.map((h, i) => (<div className="hist-row" key={i}><span className="date">{h.d === today() ? "今天" : h.d}</span><span className={`tag ${RESULT[h.r][0]}`}>{RESULT[h.r][1]}</span><span className="next">{nextText(h)}</span></div>))}
                      {hist.length > 6 && !allHistory && <a className="hist-more" onClick={() => setAllHistory(true)}>展开全部 {hist.length} 条</a>}
                    </div>
                  </>
                )}
              </div>
              <div className="detail-ops"><h4>操作</h4><div className="btns">
                <button className="btn btn-secondary" onClick={() => setNoteOpen(true)}><IconEdit />{detail.note ? "修改备注" : "备注"}</button>
                <button className="btn btn-secondary" onClick={openCollect}><IconBookmark />加入我的词库</button>
                <button className="btn btn-secondary" onClick={() => { setFbText(""); setFbOpen(true); }}><IconFlag />反馈</button>
              </div></div>
            </div>
            <div>
              {relatedEmpty && <div className="tab-empty">该词暂无关联词内容</div>}
              {v.synonyms.length > 0 && <div className="entry-section"><h4>近义词辨析 <AI /></h4>{v.synonyms.map((s, i) => <div className="confusable" key={i}><b><WordTokens text={s.w} /></b><span>{s.m}</span></div>)}</div>}
              {v.antonyms.length > 0 && <div className="entry-section"><h4>反义词 <AI /></h4>{v.antonyms.map((a, i) => <div className="confusable" key={i}><b><WordTokens text={a.w} /></b><span>{a.m}</span></div>)}</div>}
              {v.confusables.length > 0 && <div className="entry-section"><h4>易混词 <AI /></h4>{v.confusables.map((c, i) => <div className="confusable" key={i}><b><WordTokens text={c.w} /></b><span>{c.m}</span></div>)}</div>}
              {v.mistakes.length > 0 && <div className="entry-section"><h4>常见错误 <AI /></h4>
                {v.mistakes.map((m, i) => <div className="mistake" key={i}><div className="wrong">✕ <s>{m.wrong}</s></div><div className="fix">✓ {m.right}</div>{m.note && <div className="why">{m.note}</div>}</div>)}
              </div>}
              {v.inflections.length > 0 && <div className="entry-section"><h4>词形变化</h4><div className="kv-list">{v.inflections.map((f, i) => <div className="kv" key={i}><span className="en"><WordTokens text={f.w} /></span><span className="zh">{f.label}</span></div>)}</div></div>}
              {v.cognates.length > 0 && <div className="entry-section"><h4>同根词 <AI /></h4>{family(v.cognates)}</div>}
            </div>
            <div>
              {memoryEmpty && <div className="tab-empty">该词暂无记忆内容</div>}
              {v.mnemonic && <div className="entry-section"><h4>助记 <AI /></h4><div className="mnemonic">{v.mnemonic}</div></div>}
              {v.etymology && (v.etymology.parts.length > 0 || v.etymology.origin) && (
                <div className="entry-section"><h4>词源与构词 <AI /></h4>
                  <div className="etym">
                    {v.etymology.parts.length > 0 && <div className="parts">{v.etymology.parts.map((pt, i) => <span key={i}>{i > 0 && <span className="plus">+</span>}<span className="part">{pt.part}<small>{pt.meaning}</small></span></span>)}</div>}
                    {v.etymology.origin && <p className="origin">{v.etymology.origin}</p>}
                  </div>
                </div>
              )}
              {v.usage && <div className="entry-section"><h4>语域与场景 <AI /></h4><div className="usage-text"><WordTokens text={v.usage} headword={hw} /></div></div>}
            </div>
            <WordFreqPanel freq={detail.freq} kind={wordKind(detail.spelling)} />
          </SwipeTabs>
        </div>
      </div>

      <WordPeek word={peek} book={detail.bookId} accent={accent} voice={settings.voice} onClose={closePeek} autoSpeak={settings.autoReadDetail} />

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)}>
        <h3>我的备注</h3>
        <div className="field" style={{ marginTop: 12 }}>
          <textarea className="input note-input" maxLength={200} placeholder="输入备注" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <div className="hint right">{noteText.length} / 200</div>
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setNoteOpen(false)}>取消</button>
          {detail.note && <button className="btn btn-danger-soft" onClick={() => saveNote("")}>清除备注</button>}
          <button className="btn btn-primary" onClick={() => saveNote(noteText.trim())}>保存</button>
        </div>
      </Modal>

      <Modal open={fbOpen} onClose={() => setFbOpen(false)}>
        <h3>反馈这个词条的问题</h3>
        <p className="muted small">释义、音标、例句、助记有误或不合适，都可以写在这里；我们核对后修正。</p>
        <div className="field" style={{ marginTop: 12 }}>
          <textarea className="input note-input fb-input" maxLength={500} placeholder="例如：第二条释义不对 / 音标是英音 / 例句和释义不符" value={fbText} onChange={(e) => setFbText(e.target.value)} />
          <div className="hint right">{fbText.length} / 500</div>
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setFbOpen(false)}>取消</button>
          <button className="btn btn-primary" disabled={!fbText.trim() || fbBusy} onClick={sendFeedback}>提交</button>
        </div>
      </Modal>

      <Modal open={collectOpen} onClose={() => setCollectOpen(false)}>
        <h3>加入我的词库</h3>
        <p>把这个单词收藏到你创建的词库。</p>
        {books.length ? (
          <div className="list flat">{books.map((b) => (
            <label className="row link" key={b.id}><input type="radio" name="wb" checked={bookId === b.id} onChange={() => setBookId(b.id)} /> <span className="main"><span className="title">{b.name}</span><span className="sub">{b.wordCount} 词</span></span></label>
          ))}</div>
        ) : <p className="muted small">你还没有自建词库。<Link href="/wordbooks/new">+ 新建词库</Link></p>}
        <div className="actions"><button className="btn btn-secondary" onClick={() => setCollectOpen(false)}>取消</button><button className="btn btn-primary" disabled={!bookId} onClick={collect}>加入</button></div>
      </Modal>
    </PickCtx.Provider>
  );
}

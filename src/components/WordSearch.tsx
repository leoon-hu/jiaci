"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ClientApiError } from "@/lib/client/api";
import { addSearchHistory, clearSearchHistory, readSearchHistory, removeSearchHistory } from "@/lib/client/search-history";
import { dictUrl } from "@/lib/dict-url";
import { parseSearchQuery, SEARCH_MAX_LEN, type SearchHistoryItem, type SearchResult } from "@/lib/search";
import type { AiPreference } from "@/lib/ai/providers";
import { IconSearch, IconX } from "./Icons";

/** 停顿多久才发请求：连着打字只发最后一次 */
const DEBOUNCE_MS = 150;

type Mode = "app" | "public";
type Item = { spelling: string; display: string | null; pos?: string; def: string | null; note?: string };

/**
 * 顶栏的单词搜索（需求 3.9）：一个按钮（桌面带「搜索单词」字样，窄屏只有放大镜），点了弹出搜索面板。
 * mode = "app"：登录后的主框架，打开的是单词详情浮层 /word/x（盖在当前页面上，返回回到原页面）；
 * "public"：落地页与公开词典页（ISR，不知道登没登录），打开公开词条页 /dict/x。
 * ai = 词条资料来源（登录后按用户设置），结果里的核心义与单词列表同一口径。搜索记录只存本设备（lib/client/search-history.ts）。
 */
export default function WordSearch({ mode, ai = "auto" }: { mode: Mode; ai?: AiPreference }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openPanel = () => {
    // 先同步画出输入框再 focus：iOS 只在点击的这一下里允许弹键盘，放进 effect 里 focus 键盘就不出来
    flushSync(() => setOpen(true));
    inputRef.current?.focus();
  };
  return (
    <>
      <button type="button" className="search-btn" onClick={openPanel} aria-label="搜索单词" title="搜索单词">
        <IconSearch /><span className="label">搜索单词</span>
      </button>
      {open && <SearchPanel mode={mode} ai={ai} inputRef={inputRef} onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchPanel({ mode, ai, inputRef, onClose }: { mode: Mode; ai: AiPreference; inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<SearchHistoryItem[]>(readSearchHistory);
  const [res, setRes] = useState<{ key: string; result: SearchResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [active, setActive] = useState(0);
  const cache = useRef(new Map<string, SearchResult>());
  /** 结果还没回来就按了回车：回来后直接打开第一条 */
  const enterPending = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  const q = parseSearchQuery(text);
  const key = q ? `${q.kind}:${q.text}` : "";
  const qText = q?.text ?? "";
  const fresh = !!q && res?.key === key;

  const go = (h: Item) => {
    setHistory(addSearchHistory({ spelling: h.spelling, display: h.display, def: h.def }));
    onClose();
    if (mode === "app") router.push(`/word/${encodeURIComponent(h.spelling)}`, { scroll: false });
    else router.push(dictUrl(h.spelling));
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (!key) return;
    const hit = cache.current.get(key);
    if (hit) { setRes({ key, result: hit }); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<SearchResult>(`/api/search?q=${encodeURIComponent(qText)}${ai !== "auto" ? `&ai=${ai}` : ""}`, { signal: ctl.signal })
        .then((r) => {
          cache.current.set(key, r);
          setRes({ key, result: r });
          if (enterPending.current && r.hits[0]) goRef.current(r.hits[0]);
          enterPending.current = false;
        })
        .catch((e) => {
          if (ctl.signal.aborted) return;
          enterPending.current = false;
          setError({ key, message: e instanceof ClientApiError && e.status === 429 ? e.message : "搜索失败，请稍后再试" });
        });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key, qText, ai]);

  // 盖住整页时底下不跟着滚；Esc 在哪儿按都关
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  useEffect(() => { listRef.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }, [active]);

  // 输入为空列搜索记录；有输入列这次的结果，新结果没回来时先淡着显示上一次的
  const items: Item[] = !q ? history : res ? res.result.hits : [];
  const err = q && error?.key === key && !fresh ? error.message : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 输入法还在选字，回车 / 方向键是给输入法的
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!q || fresh) { const h = items[active] ?? items[0]; if (h) go(h); }
      else enterPending.current = true;
    }
  };

  const row = (h: Item, i: number, del?: () => void) => (
    <li key={h.spelling} className={"search-item" + (i === active ? " on" : "")}>
      <button type="button" id={`search-opt-${i}`} role="option" aria-selected={i === active} className="search-go" onClick={() => go(h)} onMouseMove={() => setActive(i)}>
        <span className="search-line">
          <b className="search-w">{h.display ?? h.spelling}</b>
          {h.pos && <span className="pos">{h.pos}</span>}
          <span className="search-def">{h.def ?? "暂无释义"}</span>
        </span>
        {h.note && <span className="search-note">{h.note}</span>}
      </button>
      {del && <button type="button" className="search-del" aria-label={`删除搜索记录 ${h.display ?? h.spelling}`} onClick={() => { del(); inputRef.current?.focus(); }}><IconX /></button>}
    </li>
  );

  let body: React.ReactNode;
  if (!q) {
    body = history.length ? (
      <>
        <div className="search-head"><span>搜索记录</span><button type="button" className="search-clear-all" onClick={() => { setHistory(clearSearchHistory()); setActive(0); inputRef.current?.focus(); }}>清空</button></div>
        <ul id="search-list" className="search-list" role="listbox" aria-label="搜索记录" ref={listRef}>{history.map((h, i) => row(h, i, () => { setHistory(removeSearchHistory(h.spelling)); setActive(0); }))}</ul>
      </>
    ) : <p className="search-hint">输入英文单词、短语或中文释义，比如 abandon、give up、放弃</p>;
  } else if (err) {
    body = <p className="search-hint">{err}</p>;
  } else if (!res) {
    body = <p className="search-hint">查询中…</p>;
  } else if (fresh && !items.length) {
    body = <p className="search-hint">没有找到「{text.trim()}」相关的词条</p>;
  } else {
    body = (
      <>
        {fresh && res.result.fuzzy && <div className="search-head"><span>没有以「{qText}」开头的词条，你要找的是不是：</span></div>}
        <ul id="search-list" className={"search-list" + (fresh ? "" : " stale")} role="listbox" aria-label="搜索结果" ref={listRef}>{items.map((h, i) => row(h, i))}</ul>
      </>
    );
  }

  return createPortal(
    <div className="search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="搜索单词">
        <div className="search-bar">
          <IconSearch />
          <input
            ref={inputRef} className="search-input" type="search" value={text} maxLength={SEARCH_MAX_LEN}
            placeholder="搜索单词、短语或中文释义" aria-label="搜索单词" role="combobox" aria-controls="search-list" aria-expanded={items.length > 0} aria-autocomplete="list"
            aria-activedescendant={items.length ? `search-opt-${Math.min(active, items.length - 1)}` : undefined}
            enterKeyHint="search" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setText(e.target.value); setActive(0); enterPending.current = false; }} onKeyDown={onKeyDown}
          />
          {text && <button type="button" className="btn btn-icon sm btn-ghost search-clear" aria-label="清空输入" onClick={() => { setText(""); setActive(0); inputRef.current?.focus(); }}><IconX /></button>}
          <button type="button" className="search-cancel" onClick={onClose}>取消</button>
        </div>
        <div className="search-body">{body}</div>
      </div>
    </div>,
    document.body,
  );
}

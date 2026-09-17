"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { coverText } from "@/lib/client/format";
import Pie from "@/components/Pie";
import { IconArrowUp, IconBookmarkSolid, IconChevron, IconSearch, IconSpeaker } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import Dropdown from "@/components/Dropdown";
import Modal from "@/components/Modal";
import { api, localToday } from "@/lib/client/api";
import { speakWordAndDef, voiceKeyOf, type VoiceKey } from "@/lib/client/speech";
import { useMe } from "@/lib/client/useMe";
import { isPopNavigation } from "@/lib/client/nav";
import { onWordChanged } from "@/lib/client/word-events";
import type { Bookmark, ListRow } from "@/lib/study";
import type { ProgressState, RateResult } from "@/lib/scheduler";
import { deriveStatus, pieProgress } from "@/lib/status";
import "./wordbook.css";

type Book = { id: string; name: string; type: "builtin" | "import" | "custom"; wordCount: number; learned: number; mastered: number; isCurrent: boolean; ownProgress: boolean };
type ListResp = { rows: ListRow[]; total: number; counts: Record<string, number>; nextCursor: number | null; isCurrent: boolean; ownProgress: boolean };
const TYPE_TAG: Record<Book["type"], [string, string]> = { builtin: ["tag-builtin", "内置"], import: ["tag-import", "导入"], custom: ["tag-custom", "自建"] };
/** 状态筛选：按钮上带该状态的饼图样式（空心 / 半填充 / 实心），就是列表的图例 */
const FILTERS: Array<[string, string, string | null, number]> = [["all", "全部", null, 0], ["new", "未开始", "st-new", 0], ["learning", "学习中", "st-learning", 50], ["mastered", "已掌握", "st-mastered", 100], ["none", "未加入", "st-none", 0]];
const SORT_OPTIONS = [{ value: "order", label: "按添加顺序" }, { value: "alpha", label: "按字母" }, { value: "freq", label: "按词频" }, { value: "due", label: "按下次复习时间" }, { value: "random", label: "随机" }];
/** 随机排序的种子编码在排序值里（random:<种子>）：翻页、书签还原都要按同一种子才不会错位；
 *  每次选「随机」都换一个种子，也就是重新洗一次牌 */
const newRandomSort = () => `random:${Math.random().toString(36).slice(2, 10)}`;
const isRandom = (v: string) => v.startsWith("random:");
/** 倒序：排序值加 -desc 后缀（order-desc / alpha-desc / freq-desc / due-desc）；随机没有倒序 */
const isDesc = (v: string) => v.endsWith("-desc");
const sortKey = (v: string) => (isRandom(v) ? "random" : isDesc(v) ? v.slice(0, -5) : v);
/** 换排序方式时保留当前的正 / 倒序 */
const withDir = (key: string, desc: boolean) => (key === "random" ? newRandomSort() : desc ? `${key}-desc` : key);
/** 列表显示模式：both 英文 + 释义 / en 隐藏释义 / zh 隐藏英文（被隐藏的一侧加模糊遮罩，点击显示） */
type ListMode = "both" | "en" | "zh";
const MODES: Array<[ListMode, string]> = [["both", "英文 + 释义"], ["en", "隐藏释义"], ["zh", "隐藏英文"]];
/** 列表里的三种状态操作 */
type ListAct = Extract<RateResult, "reset" | "master" | "remove">;
/** 拖拽操作按钮：顺序固定 取消 → 书签 → 重新记 → 加进度 → 已掌握 → 移出（需求 3.3.5），等宽铺满整行。
 *  书签挨着取消放：两个都是无损操作，最容易误碰的一头留给「移出」；
 *  中间三个按学习进度排：重新记（清零）→ 加进度（+1 次认识）→ 已掌握（到头），颜色也跟着状态色走 */
const OPTS: Array<{ o: "cancel" | ListAct | "bookmark" | "know"; label: string; sub: string; cls: string }> = [
  { o: "cancel", label: "取消", sub: "", cls: "cancel" }, { o: "bookmark", label: "书签", sub: "记住这里", cls: "bookmark" },
  { o: "reset", label: "重新记", sub: "按新词重背", cls: "reset" },
  { o: "know", label: "加进度", sub: "记一次认识", cls: "know" },
  { o: "master", label: "已掌握", sub: "不再出现", cls: "master" }, { o: "remove", label: "移出", sub: "不再学习", cls: "remove" },
];
/** 操作先在本地生效，UNDO_MS 内可撤销，到时才提交服务端 */
const UNDO_MS = 5000;
/** 向下滚过这么多像素就在右下角显示「回到顶部」：一屏的三分之一左右，不会一动就跳出来 */
const TOP_BTN_AT = 300;
/** 长按进入多选 */
const LONG_PRESS_MS = 500;
/**
 * 横向拖过这么多像素才算「拖到了按钮上」：按下的地方本来就压着某个按钮，轻轻一碰不该算数。
 * 只要拖够过一次就一直算数：拖开再拖回按下点附近，卡片压着哪个按钮就是哪个——
 * 不然按下点左右各 20px 是死区，压在那儿的按钮有一段怎么都点不亮、松手也不执行
 */
const DRAG_MIN = 20;
/** 松手后卡片飞向按钮（或飞回原位）的时长，与 wordbook.css 里的过渡一致 */
const DROP_MS = 180;
/** 每次加载的行数；滚动到底自动加载下一批 */
const PAGE = 100;
/** 接口允许的单次上限（route.ts 的 zod 校验），一次补齐多页时别越界 */
const MAX_LIMIT = 1000;
/**
 * 每个词库的浏览状态：筛选、搜索、排序、已加载行数、滚动位置。
 * 进单词详情再返回时按它还原（模块级、整页刷新即清空：刷新后本来也没有可还原的历史滚动位置）。
 */
type ListView = { filter: string; q: string; sort: string; start: number; loaded: number; scrollY: number };
const viewCache = new Map<string, ListView>();
/**
 * 书签落在第 index 行时该从哪一行开始加载：目标所在页往前多留 2 页做上下文。
 * 不从第 0 行一路加载过去——近万词的词库那样要塞上万行进 DOM，而接口单次上限也只有 1000。
 */
function windowFor(index: number) {
  const page = Math.floor(index / PAGE);
  const startPage = Math.max(0, page - 2);
  return { cursor: startPage * PAGE, limit: Math.min(MAX_LIMIT, (page - startPage + 1) * PAGE) };
}
const ACT_PROGRESS: Record<ListAct, "new" | "mastered" | "removed"> = { reset: "new", master: "mastered", remove: "removed" };
const actMessage = (act: ListAct, n: number) => n > 1
  ? `已把 ${n} 个词${act === "reset" ? "重新记" : act === "master" ? "标记为已掌握" : "移出学习"}`
  : act === "master" ? "已标记为已掌握，不再出现在学习中" : act === "remove" ? "已移出学习，状态为未加入" : "已重新记：按新词重新开始";
/**
 * 一批待定操作：三种状态操作走 rate-batch；「加进度」（know）一次只有一个词、走单词打分接口，
 * clientTs 与预览时用的同一个，真正提交与预览对应得上，离线补交也不会记两次
 */
type Pending = { ids: string[]; act: ListAct | "know"; clientTs?: string; rows: ListRow[]; data: ListResp | null; timer: ReturnType<typeof setTimeout> };
/** 服务端 rate-batch 单次上限 500，超过要切片提交（审计 F053） */
const BATCH_MAX = 500;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
/** 提交一批待定操作要发的请求（提交队列与离开页面的 keepalive 共用）；带上词库 id，开了独立进度的词库写自己那套（需求 3.3.6） */
const pendingRequests = (p: Pending, bookId: string): Array<{ url: string; body: unknown }> => p.act === "know"
  ? [{ url: "/api/study/rate", body: { wordId: p.ids[0], result: "know", date: localToday(), source: "list", clientTs: p.clientTs, wordbookId: bookId } }]
  : chunk(p.ids, BATCH_MAX).map((ids) => ({ url: "/api/study/rate-batch", body: { wordIds: ids, result: p.act, date: localToday(), wordbookId: bookId } }));

/** 词库详情 / 单词列表（需求 3.3.5） */
/**
 * 词库详情 / 单词列表（需求 3.3.5）。
 * 词库信息与书签由 page.tsx 在服务端查好传进来（性能优化 P1-1），单词列表仍在客户端取——
 * 它要按「后退还原的浏览状态 / 书签位置」决定从第几行开始加载，服务端提前算的那一页多半用不上。
 */
export default function WordbookClient({ initialBook, initialBookmark, initialError = "" }: { initialBook: Book | null; initialBookmark: Bookmark | null; initialError?: string }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, hideToast } = useToast();
  const { settings, update } = useMe();
  const [book, setBook] = useState<Book | null>(initialBook);
  const [loadErr, setLoadErr] = useState(initialError);
  const [data, setData] = useState<ListResp | null>(null);
  const [rows, setRows] = useState<ListRow[]>([]);
  // 浏览器后退回到本页时，用上次记下的浏览状态开局；从别处点进来照常是默认筛选、从头看起
  const [restore] = useState<ListView | null>(() => (isPopNavigation() ? viewCache.get(id) ?? null : null));
  const restoreRef = useRef(restore);
  const [filter, setFilter] = useState(restore?.filter ?? "all");
  const [q, setQ] = useState(restore?.q ?? "");
  const [sort, setSort] = useState(restore?.sort ?? "order");
  const [mode, setMode] = useState<ListMode>("both");
  const [bm, setBm] = useState<Bookmark | null>(initialBookmark);
  // 当前这批行是从第几行开始的（书签跳转会从中间开始，不一定是 0）
  const [start, setStart] = useState(restore?.start ?? 0);
  const startRef = useRef(start);
  // 点书签后要落到哪个词：加载完成、行渲染出来后滚过去并闪一下
  const jumpRef = useRef<{ wordId: string; index: number } | null>(null);
  const [jump, setJump] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addInput, setAddInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 最新的行与统计（供撤销快照与本地更新用，避免闭包里的旧值）
  const rowsRef = useRef<ListRow[]>([]);
  const dataRef = useRef<ListResp | null>(null);
  const pending = useRef<Pending | null>(null);
  /** 串行提交队列：一批接一批地发，互不覆盖 */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const loadingMoreRef = useRef(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMode(settings.listMode); }, [settings.listMode]);

  const setRowsSync = (next: ListRow[]) => { rowsRef.current = next; setRows(next); };
  const setDataSync = (next: ListResp | null) => { dataRef.current = next; setData(next); };
  const loadBookmark = useCallback(() => api<{ bookmark: Bookmark | null }>(`/api/wordbooks/${id}/bookmark`).then((r) => setBm(r.bookmark)).catch(() => {}), [id]);
  const loadBook = useCallback(() => api<Book>(`/api/wordbooks/${id}`).then((b) => { setBook(b); setLoadErr(""); }).catch((e) => { setLoadErr((e as Error).message || "词库加载失败"); toast((e as Error).message); }), [id, toast]);
  const fetchList = useCallback((cursor = 0, append = false, limit = PAGE) => {
    const u = new URLSearchParams({ status: filter, q, sort, cursor: String(cursor), limit: String(Math.min(MAX_LIMIT, limit)) });
    return api<ListResp>(`/api/wordbooks/${id}/words?${u}`).then((r) => {
      const have = new Set(rowsRef.current.map((x) => x.id));
      const next = append ? [...rowsRef.current, ...r.rows.filter((x) => !have.has(x.id))] : r.rows;
      if (!append) { startRef.current = cursor; setStart(cursor); }
      rowsRef.current = next; setRows(next); dataRef.current = r; setData(r);
      if (!append) setSelected((prev) => new Set([...prev].filter((w) => next.some((x) => x.id === w))));
    }).catch((e) => toast((e as Error).message));
  }, [id, filter, q, sort, toast]);
  /** 重新拉取当前这个窗口里已加载的行（轮询、出错后同步用），不打断滚动位置 */
  const refresh = useCallback(() => {
    // 已加载的行数按 nextCursor 减去起点推，本地删行不影响
    const from = startRef.current;
    const loaded = (dataRef.current?.nextCursor ?? from + rowsRef.current.length) - from;
    return fetchList(from, false, Math.max(PAGE, loaded));
  }, [fetchList]);
  /**
   * 提交一批待定操作：列表已经本地更新过，成功只刷新头部统计；失败则提示并从服务端重新同步。
   * 「加进度」本地显示的是预览结果，真正提交时若被守卫拦下（这几秒里别的设备学过 / 改过这个词），
   * 服务端返回 duplicate 或 skipped，与预览对不上，也从服务端重新同步这一段
   */
  const commit = useCallback(async (p: Pending) => {
    try {
      for (const { url, body } of pendingRequests(p, id)) {
        const r = await api<{ duplicate?: boolean; skipped?: string | null }>(url, { method: "POST", json: body });
        if (p.act === "know" && (r.duplicate || r.skipped)) await refresh();
      }
      loadBook();
    } catch (e) { toast(`操作没有保存：${(e as Error).message}`); await refresh(); }
  }, [id, refresh, loadBook, toast]);
  /**
   * 把一批待定操作交给串行提交队列：不等网络返回就返回，调用方可以立刻接着操作。
   * 原来 doAct 里 await flush() 期间的新操作会被随后的赋值覆盖、永远提交不上去（审计 F051）。
   */
  const enqueue = useCallback((p: Pending) => {
    clearTimeout(p.timer);
    // 提交后必须关掉那条带「撤销」的 toast：留着的话点它什么都不会发生（审计 F052）
    hideToast();
    queueRef.current = queueRef.current.then(() => commit(p));
    return queueRef.current;
  }, [commit, hideToast]);
  /** 有待定操作就立即提交并等队列排空（切换筛选、翻页、离开页面前调用） */
  const flush = useCallback(() => {
    const p = pending.current;
    if (p) { pending.current = null; enqueue(p); }
    return queueRef.current;
  }, [enqueue]);
  const loadList = useCallback(async (cursor = 0, append = false, limit = PAGE) => { await flush(); return fetchList(cursor, append, limit); }, [flush, fetchList]);
  // 首屏的词库信息与书签已经由服务端传进来了，只有拿不到时才补请求（例如从别处客户端跳转过来）
  useEffect(() => { if (!initialBook) { loadBook(); loadBookmark(); } }, [initialBook, loadBook, loadBookmark]);
  // 后退回来的第一次加载要一次补齐上次已加载的行数，否则滚不回原来的位置；
  // 点了书签则直接加载书签所在的那一段（jump 计数进依赖，条件没变时也能重新触发）
  useEffect(() => {
    const t = setTimeout(() => {
      const j = jumpRef.current;
      if (j) { const w = windowFor(j.index); return loadList(w.cursor, false, w.limit); }
      const r = restoreRef.current;
      return loadList(r?.start ?? 0, false, Math.max(PAGE, r?.loaded ?? 0));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, q, jump]);
  // 行渲染出来、页面够高了再滚回去；只做一次
  useEffect(() => {
    const r = restoreRef.current;
    if (!r || !rows.length) return;
    restoreRef.current = null;
    window.scrollTo(0, r.scrollY);
  }, [rows]);
  // 书签跳转：行渲染出来后滚到那一行并闪一下；只做一次。
  // 计时器挂在 ref 上而不是 effect 的 cleanup——跳过去之后往往紧接着触发一次「下滑加载更多」，
  // rows 一变 cleanup 就会把它清掉，高亮标记就再也不会消失了
  useEffect(() => {
    const j = jumpRef.current;
    if (!j || !rows.length) return;
    jumpRef.current = null;
    const el = document.querySelector<HTMLElement>(`.srow[data-id="${j.wordId}"]`);
    if (!el) { toast("没找到书签所在的那一行"); return; }
    el.scrollIntoView({ block: "center" });
    setFlash(j.wordId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }, [rows, toast]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  // 右下角「回到顶部」：向下滚过一段就出现。单独一个 effect、依赖为空，
  // 不跟着筛选与行数变化反复解绑重绑监听
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > TOP_BTN_AT);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  /** 记下浏览状态供返回时还原：筛选等变化时换一份快照，滚动时就地更新位置 */
  useEffect(() => {
    // 已加载的行数同 refresh：按服务端给的 nextCursor 推，本地改状态删掉的行不影响
    const v: ListView = { filter, q, sort, start, loaded: (data?.nextCursor ?? start + rows.length) - start, scrollY: window.scrollY };
    viewCache.set(id, v);
    const onScroll = () => { v.scrollY = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [id, filter, q, sort, start, rows.length, data]);
  /** 滚动到底自动加载下一批：先提交待定操作，再从当前已加载的行数处接着取 */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || dataRef.current?.nextCursor == null) return;
    loadingMoreRef.current = true; setLoadingMore(true);
    // 用服务端给的 nextCursor，而不是当前行数：本地改状态后行会被移出列表，按行数当偏移量会漏行（审计 F067）
    const cursor = dataRef.current.nextCursor;
    try { await flush(); await fetchList(cursor, true); } finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }, [flush, fetchList]);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) loadMore(); }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, data?.nextCursor, rows.length]);
  // 离开页面（关闭、跳转、切到别的路由）时，待定操作不等撤销期结束，用 keepalive 请求立即提交
  useEffect(() => {
    const beacon = () => {
      const p = pending.current; if (!p) return;
      clearTimeout(p.timer); pending.current = null;
      for (const { url, body } of pendingRequests(p, id)) fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, credentials: "same-origin" }).catch(() => {});
    };
    window.addEventListener("pagehide", beacon);
    return () => { window.removeEventListener("pagehide", beacon); beacon(); };
  }, [id]);
  // 详情浮层里打了分：这一页一直挂在浮层底下，不会因为返回而重新加载，得自己同步（需求 3.2.5）
  useEffect(() => onWordChanged(() => { refresh(); loadBook(); }), [refresh, loadBook]);
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitSelect(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode]);

  async function setCurrent() { await api("/api/wordbooks/current", { method: "PUT", json: { wordbookId: id } }); toast("已设为当前学习词库"); loadBook(); loadList(); }
  /**
   * 切换独立进度 / 全局进度（需求 3.3.6）：只改这本词库读写哪一套进度，两套都保留。
   * 待定操作先提交（它们属于切换前那一套），再改设置、重新拉词库信息与列表
   */
  const [scopeAsk, setScopeAsk] = useState(false);
  async function toggleScope() {
    if (!book || busy) return;
    setBusy(true);
    const next = !book.ownProgress;
    try {
      await flush();
      await api(`/api/wordbooks/${id}`, { method: "PATCH", json: { ownProgress: next } });
      setScopeAsk(false);
      toast(next ? "已改用独立进度：这本词库从零开始记，全局进度原样保留" : "已改回全局进度：独立进度原样保留，随时可以切回");
      await Promise.all([loadBook(), loadList()]);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  async function addWord() {
    if (!addInput.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<{ added: string[]; existed: string[]; bad: string[] }>(`/api/wordbooks/${id}/words`, { method: "POST", json: { input: addInput } });
      if (r.bad.length && !r.added.length) toast("请输入一个英文单词"); else if (!r.added.length) toast("该单词已在词库中"); else toast("已添加");
      setAddInput(""); await Promise.all([loadList(), loadBook()]);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  function changeMode(m: ListMode) { setMode(m); update({ listMode: m }).catch(() => {}); }

  /** 写书签：一本词库只有一个，新的覆盖旧的；toast 上可以撤销回上一个 */
  async function saveBookmark(wordId: string, view: { filter: string; q: string; sort: string; mode: ListMode }, undoOf?: Bookmark | null) {
    try {
      const r = await api<{ bookmark: Bookmark }>(`/api/wordbooks/${id}/bookmark`, { method: "PUT", json: { wordId, ...view } });
      setBm(r.bookmark);
      return r.bookmark;
    } catch (e) { toast((e as Error).message); return undoOf ?? null; }
  }
  /** 滑动选「书签」：把这个词连同当前的筛选、搜索、排序、显示模式一起记下来 */
  async function bookmarkRow(row: ListRow) {
    const prev = bm;
    const saved = await saveBookmark(row.id, { filter, q, sort, mode });
    if (!saved) return;
    toast(`已把「${row.display ?? row.spelling}」设为书签`, {
      ms: UNDO_MS,
      action: {
        label: "撤销",
        onClick: async () => {
          if (prev) await saveBookmark(prev.wordId, { filter: prev.filter, q: prev.q, sort: prev.sort, mode: prev.mode as ListMode }, prev);
          else { await api(`/api/wordbooks/${id}/bookmark`, { method: "DELETE" }).catch(() => {}); setBm(null); }
          toast(prev ? "已恢复上一个书签" : "已取消书签");
        },
      },
    });
  }
  /** 点顶部书签图标：还原当时的筛选 / 搜索 / 排序 / 显示模式，再定位到那个词 */
  async function jumpToBookmark() {
    // 重新取一次：这个词的状态可能已经变了，排第几要按现在的数据算
    const r = await api<{ bookmark: Bookmark | null }>(`/api/wordbooks/${id}/bookmark`).catch(() => null);
    const b = r?.bookmark ?? null;
    setBm(b);
    if (!b) { toast("这本词库还没有书签：左右滑动一行，选「书签」"); return; }
    setFilter(b.filter); setQ(b.q); setSort(b.sort);
    if (b.mode !== mode) changeMode(b.mode as ListMode);
    if (b.index === null) {
      // 词还在，但按书签记下的条件已经筛不到它了（比如当时筛「未开始」，现在这个词已掌握）
      jumpRef.current = null;
      toast(`「${b.display ?? b.spelling}」已不在书签记下的筛选里，先按书签的条件打开列表`);
    } else {
      jumpRef.current = { wordId: b.wordId, index: b.index };
    }
    setJump((n) => n + 1);
  }

  /** 本地先按新状态更新行与各状态数量；不在当前筛选里的行从列表移走 */
  function applyLocal(ids: string[], act: ListAct) {
    const set = new Set(ids); const cur = dataRef.current;
    const st = deriveStatus({ progressStatus: ACT_PROGRESS[act] });
    const counts = { ...(cur?.counts ?? {}) };
    let gone = 0;
    const next: ListRow[] = [];
    for (const r of rowsRef.current) {
      if (!set.has(r.id)) { next.push(r); continue; }
      counts[r.status] = Math.max(0, (counts[r.status] ?? 0) - 1); counts[st] = (counts[st] ?? 0) + 1;
      if (filter === "all" || filter === st) next.push({ ...r, status: st, pie: st === "mastered" ? 100 : 0, due: null }); else gone++;
    }
    setRowsSync(next);
    if (cur) setDataSync({ ...cur, counts, total: cur.total - gone });
  }
  /** 滑动或批量操作：本地生效 + 可撤销的 toast，UNDO_MS 后提交 */
  function doAct(ids: string[], act: ListAct) {
    if (!ids.length) return;
    // 上一批先入队（同步完成，不等网络），再建立这一批的快照
    const prev = pending.current;
    if (prev) { pending.current = null; enqueue(prev); }
    const snap: Pending = { ids, act, rows: rowsRef.current, data: dataRef.current, timer: setTimeout(() => { if (pending.current === snap) { pending.current = null; enqueue(snap); } }, UNDO_MS) };
    pending.current = snap;
    applyLocal(ids, act);
    toast(actMessage(act, ids.length), { ms: UNDO_MS, action: { label: "撤销", onClick: () => undo(snap) } });
  }
  /**
   * 拖到「加进度」：按「认识」给这个词记一次学习。走单词打分接口而不是批量接口——
   * know 的那几条守卫（已掌握 / 已移出不被拉回、当天不重复记、旧打分不覆盖新进度）只在 rateWord 里；
   * 来源标成 list，不算进首页「今日已完成」与当天的新词配额（审计 F024）。
   * 新的间隔要服务端算，本地算不出来，所以先用 preview 只算不写拿到结果，按结果本地生效，
   * 然后与其它操作一样进「5 秒内可撤销、到时才提交」的队列；提交时用同一个 clientTs 真打一次分。
   */
  async function addProgress(row: ListRow) {
    // 上一批先落库并等它返回：里面可能就有这一行（比如刚拖过「已掌握」），预览得按落库后的状态算
    await flush();
    const clientTs = `list-${row.id}-${Date.now()}`;
    let r: { progress: ProgressState; nextInterval: number; duplicate: boolean; skipped: string | null };
    try {
      r = await api("/api/study/rate", { method: "POST", json: { wordId: row.id, result: "know", date: localToday(), source: "list", clientTs, preview: true, wordbookId: id } });
    } catch (e) { toast((e as Error).message); return; }
    // 被守卫拦下的情况什么都不会写，只提示原因，没有可撤销的东西
    if (r.skipped === "mastered" || r.skipped === "removed") {
      toast(r.skipped === "mastered" ? "这个词已掌握，不再安排复习" : "这个词已移出学习，先用「重新记」加回来");
      return;
    }
    if (r.duplicate) { toast("今天已经学过这个词了，进度不重复记"); return; }
    // 等预览的这段时间里用户可能又拖了别的行，那批先入队再建立这一批的快照
    const prev = pending.current;
    if (prev) { pending.current = null; enqueue(prev); }
    const snap: Pending = { ids: [row.id], act: "know", clientTs, rows: rowsRef.current, data: dataRef.current, timer: setTimeout(() => { if (pending.current === snap) { pending.current = null; enqueue(snap); } }, UNDO_MS) };
    pending.current = snap;
    applyProgress(row.id, r.progress);
    toast(r.skipped === "stale" ? "已记入学习历史；其它设备上有更新的记录，复习安排不变"
      : r.nextInterval > 0 ? `已记一次「认识」，${r.nextInterval} 天后再复习` : "已记一次「认识」",
    { ms: UNDO_MS, action: { label: "撤销", onClick: () => undo(snap) } });
  }
  /** 打完分按服务端返回的进度刷新这一行：状态、饼图、下次复习时间，顺带调整各筛选的数量 */
  function applyProgress(id: string, p: ProgressState) {
    const cur = dataRef.current;
    const st = deriveStatus({ progressStatus: p.status });
    const counts = { ...(cur?.counts ?? {}) };
    let gone = 0;
    const next: ListRow[] = [];
    for (const r of rowsRef.current) {
      if (r.id !== id) { next.push(r); continue; }
      if (r.status !== st) { counts[r.status] = Math.max(0, (counts[r.status] ?? 0) - 1); counts[st] = (counts[st] ?? 0) + 1; }
      if (filter === "all" || filter === st) next.push({ ...r, status: st, pie: pieProgress(st, p.interval), due: p.dueDate }); else gone++;
    }
    setRowsSync(next);
    if (cur) setDataSync({ ...cur, counts, total: cur.total - gone });
  }
  function undo(p: Pending) {
    if (pending.current !== p) { toast("操作已经提交，无法撤销"); return; }
    clearTimeout(p.timer); pending.current = null;
    setRowsSync(p.rows); setDataSync(p.data);
    toast("已撤销");
  }
  function enterSelect(rowId: string) { setSelectMode(true); setSelected(new Set([rowId])); }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggle(rowId: string) { setSelected((prev) => { const n = new Set(prev); if (n.has(rowId)) n.delete(rowId); else n.add(rowId); return n; }); }
  function batch(act: ListAct) { const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id); exitSelect(); doAct(ids, act); }
  const vk = voiceKeyOf(settings.accent, settings.voice);

  return (
    <AppShell nav="books">
      <main className={"page medium" + (selectMode ? " has-selbar" : "")}>
        <Link className="back" href="/wordbooks">‹ 词库</Link>
        {/* 词库不存在 / 拉取失败时给出口，不要一直停在「加载中…」（审计 F062） */}
        {loadErr && !book && (
          <div className="center" style={{ padding: 40 }}>
            <p className="muted">{loadErr}</p>
            <div className="btn-row"><button className="btn btn-secondary" onClick={() => { loadBook(); loadList(); }}>重试</button><Link className="btn btn-primary" href="/wordbooks">返回词库</Link></div>
          </div>
        )}
        {book && (
          <div className="section mt-8">
            <div className="head-card">
              <div className="cover">{coverText(book.name)}</div>
              <div className="grow">
                <div className="flex wrap"><h2>{book.name}</h2><span className={`tag ${TYPE_TAG[book.type][0]}`}>{TYPE_TAG[book.type][1]}</span>{book.isCurrent && <span className="tag tag-current">学习中</span>}{book.ownProgress && <span className="tag tag-own" title="这本词库用自己的一套进度，与其它词库不共享">独立进度</span>}
                  {bm && <button type="button" className="bm-go" onClick={jumpToBookmark}
                    title={`跳到书签：${bm.display ?? bm.spelling}`} aria-label={`跳到书签：${bm.display ?? bm.spelling}`}><IconBookmarkSolid /></button>}
                </div>
                <div className="small muted mt-8">{book.wordCount} 词 · 已学 {book.learned} · 已掌握 {book.mastered}</div>
                <div className="progress thin mt-8" style={{ maxWidth: 360 }}><i style={{ width: `${book.wordCount ? (book.learned / book.wordCount) * 100 : 0}%` }} /></div>
              </div>
            </div>
            <div className="btn-row mt-16">{book.isCurrent ? <Link className="btn btn-primary" href="/study">开始学习</Link> : <button className="btn btn-primary" onClick={setCurrent}>设为当前学习</button>}
              <button type="button" className="btn btn-secondary" onClick={() => setScopeAsk(true)} disabled={busy}>{book.ownProgress ? "改用全局进度" : "改用独立进度"}</button></div>
            {book.type === "custom" && <div className="add-inline"><input className="input" placeholder="输入单词或短语，回车添加" value={addInput} onChange={(e) => setAddInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} /><button className="btn btn-primary" onClick={addWord} disabled={busy}>添加</button></div>}
          </div>
        )}
        <div className="toolbar">
          <div className="chips">{FILTERS.map(([k, label, pie, p]) => (<button key={k} className={"chip btn-chip" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>
            <span className="lbl">{pie && <span className={"pie " + pie} style={{ ["--p" as string]: p }} />}{label}</span><span className="cnt">{k === "all" ? (data?.counts.all ?? "") : (data?.counts[k] ?? "")}</span></button>))}</div>
          <div className="tools">
            <div className="search"><IconSearch /><input className="input" placeholder="搜索单词或释义" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Dropdown block ariaLabel="排序" value={sortKey(sort)} onChange={(v) => setSort(withDir(v, isDesc(sort)))} options={SORT_OPTIONS} />
            <button type="button" className={"dir-btn" + (isDesc(sort) ? " desc" : "")} disabled={isRandom(sort)}
              title={isRandom(sort) ? "随机排序没有正倒序" : isDesc(sort) ? "当前倒序，点击改正序" : "当前正序，点击改倒序"}
              aria-label={isDesc(sort) ? "当前倒序，点击改正序" : "当前正序，点击改倒序"} aria-pressed={isDesc(sort)}
              onClick={() => setSort(withDir(sortKey(sort), !isDesc(sort)))}><IconArrowUp /></button>
            <div className="seg" title="列表显示模式">{MODES.map(([m, label]) => <button key={m} className={mode === m ? "active" : ""} onClick={() => changeMode(m)}>{label}</button>)}</div>
          </div>
        </div>
        {/* 一行操作提示；按钮的含义拖起来就能看到，这里只提醒有这两个手势 */}
        <div className="list-hint">
          <span>横向拖动一行：书签 / 重新记 / 加进度 / 已掌握 / 移出；长按多选{mode !== "both" && "；点击单词或释义揭开遮罩并朗读，释义右边的空白到行尾都进详情"}</span>
        </div>
        <div className={`list edge dense mode-${mode}`}>
          {loadErr && !data ? <div className="empty">{loadErr}</div> : !data ? <div className="empty">加载中…</div> : rows.length === 0 ? <div className="empty"><div className="icon">🔍</div>没有匹配的单词</div> : rows.map((r) => (
            <DragRow key={r.id} row={r} mode={mode} vk={vk} selectMode={selectMode} checked={selected.has(r.id)}
              bookmarked={bm?.wordId === r.id} flash={flash === r.id}
              onOpen={() => router.push(`/word/${encodeURIComponent(r.spelling)}?book=${id}`, { scroll: false })} onAct={(a) => doAct([r.id], a)} onProgress={() => addProgress(r)}
              onBookmark={() => bookmarkRow(r)} onLongPress={() => enterSelect(r.id)} onToggle={() => toggle(r.id)} />
          ))}
        </div>
        {data && (
          <div className="pager">
            显示 {rows.length ? start + 1 : 0}–{start + rows.length}，共 {data.total} 词
            {start > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { jumpRef.current = null; setJump((n) => n + 1); window.scrollTo(0, 0); }}>回到开头</button>}
            {data.nextCursor !== null && <div ref={moreRef} className="more">{loadingMore ? "加载中…" : "下滑加载更多"}</div>}
          </div>
        )}
        {showTop && !selectMode && (
          <button type="button" className="to-top" aria-label="回到顶部" title="回到顶部"
            onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>
            <IconArrowUp />
          </button>
        )}
        {selectMode && (
          <div className="sel-bar" role="toolbar" aria-label="批量操作">
            <div className="inner">
              <div className="row">
                <span className="sel-count">已选 {selected.size} 词</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>全选</button>
                <span className="small faint grow">点击行勾选 · 操作后几秒内可撤销</span>
              </div>
              <div className="row acts">
                <button type="button" className="btn act-cancel" onClick={exitSelect}>取消</button>
                <button type="button" className="btn act-reset" disabled={!selected.size} onClick={() => batch("reset")}>重新记</button>
                <button type="button" className="btn act-master" disabled={!selected.size} onClick={() => batch("master")}>已掌握</button>
                <button type="button" className="btn act-remove" disabled={!selected.size} onClick={() => batch("remove")}>移出</button>
              </div>
            </div>
          </div>
        )}
      </main>
      {/* 切换进度作用域前说清楚：两套记录都在，只是换一套来看、来记 */}
      <Modal open={scopeAsk} onClose={() => setScopeAsk(false)}>
        {book?.ownProgress ? (
          <>
            <h3>改回全局进度？</h3>
            <p>这本词库将改用所有词库共用的那套进度：每个词显示它在全局的状态。这本的独立进度不会删除，随时可以再切回来。</p>
          </>
        ) : (
          <>
            <h3>改用独立进度？</h3>
            <p>这本词库将单独记一套进度：所有词从「未开始」算起，学习、打分、已掌握都只记在这本里，不影响其它词库；全局进度原样保留，随时可以切回。</p>
          </>
        )}
        <div className="actions"><button className="btn btn-secondary" onClick={() => setScopeAsk(false)}>取消</button><button className="btn btn-primary" onClick={toggleScope} disabled={busy}>{book?.ownProgress ? "改回全局进度" : "改用独立进度"}</button></div>
      </Modal>
    </AppShell>
  );
}

/** listWordbookWords 在词典与 AI 都没释义时填的占位串，朗读时要跳过（否则会念出「暂无释义」） */
const NO_DEF = "暂无释义";


/** 单词行：进度饼图 + 小喇叭 + 拖拽操作（拖到行内按钮上松手，拖到别处松手就是取消）；长按进入多选，多选时点击行勾选 */
function DragRow({ row, mode, vk, selectMode, checked, bookmarked, flash, onOpen, onAct, onProgress, onBookmark, onLongPress, onToggle }: { row: ListRow; mode: ListMode; vk: VoiceKey; selectMode: boolean; checked: boolean; bookmarked: boolean; flash: boolean; onOpen: () => void; onAct: (a: ListAct) => void; onProgress: () => void; onBookmark: () => void; onLongPress: () => void; onToggle: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  /** 行内的操作按钮条（一直有布局，不拖时只是看不见）：拖拽判定按每个按钮的真实位置量 */
  const optsRef = useRef<HTMLDivElement>(null);
  /** 行尾区域（释义右侧的空白 + 到期日 + 箭头）：遮罩模式下点这里进详情、点其余位置揭开遮罩 */
  const tailRef = useRef<HTMLDivElement>(null);
  const dg = useRef<{ x: number; y: number; pick: number | null; axis: "x" | "y" | null; armed: boolean; id: number } | null>(null);
  const lp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  /** 跟手小卡片的中心（视口坐标）；null = 没在拖。卡片挂在 body 上，可以拖到页面任何地方 */
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  /** 卡片正压着的按钮；null = 还没拖够距离，松手不做事 */
  const [pick, setPick] = useState<number | null>(null);
  /** 松手后的落点动画：卡片飞向按钮（或飞回按下的位置）并淡出 */
  const [dropping, setDropping] = useState(false);
  // 隐藏释义 / 隐藏英文时，被遮住的一侧点开后显示；换显示模式重新遮起来
  const [revealed, setRevealed] = useState(false);
  const suppress = useRef(false);
  useEffect(() => { setRevealed(false); }, [mode]);
  /**
   * 拖动中吃掉 touchmove：touch-action 只在手势开始时定方向，手指拖起来之后再往上下走，
   * 浏览器仍会把它当成滚动（并发 pointercancel 把这次拖拽打断）。
   */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (dg.current?.axis === "x") e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);
  /** 隐藏释义 / 隐藏英文时点「单词 + 释义」是揭开遮罩、点释义右侧到行尾的区域进详情；多选时整行是勾选区 */
  const masked = mode !== "both" && !selectMode;
  /** 可朗读的释义：占位串不读 */
  const readableDef = row.def && row.def !== NO_DEF ? row.def : null;
  /**
   * 朗读时要不要带释义：释义当前看得见才带。
   * 「隐藏释义」模式下没点开的行只读单词——那时用户正在看英文回忆中文，读出释义等于直接公布答案。
   */
  const speechDef = () => (mode !== "en" || revealed ? readableDef : null);
  /** 卡片上写什么：跟着显示模式走，别把遮住的那一半漏出来 */
  const chipText = mode === "zh" && !revealed ? (readableDef ?? row.display ?? row.spelling) : (row.display ?? row.spelling);
  /** 卡片正压着的按钮：卡片会挡住按钮上的字，所以把要执行的操作写在卡片上 */
  const armed = pick === null ? null : OPTS[pick];
  /** 揭开 / 收起遮罩：揭开时顺带读一遍这个词与释义（遮住的那一侧已可见，两种模式都可以带释义；revealed 还没生效，不走 speechDef()），收起不读 */
  const toggleReveal = () => {
    const next = !revealed;
    setRevealed(next);
    if (next) speakWordAndDef(row.spelling, readableDef, vk);
  };

  const clearLp = () => { if (lp.current) { clearTimeout(lp.current); lp.current = null; } };
  /** 卡片压着哪个按钮：按每个按钮的真实位置判断（不按「行宽 / 个数」平均算，字多的按钮在窄屏上可能被撑宽）；不在按钮条里返回 null */
  const optAt = (x: number, y: number): number | null => {
    const el = optsRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const kids = Array.from(el.children);
    const i = kids.findIndex((k) => x < k.getBoundingClientRect().right);
    return i < 0 ? kids.length - 1 : i;
  };

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== undefined && e.button !== 0) return;
    dg.current = { x: e.clientX, y: e.clientY, pick: null, axis: null, armed: false, id: e.pointerId }; fired.current = false;
    if (selectMode) return;
    lp.current = setTimeout(() => {
      lp.current = null; fired.current = true;
      suppress.current = true; setTimeout(() => { suppress.current = false; }, 400);
      try { navigator.vibrate?.(15); } catch { /* ignore */ }
      onLongPress();
    }, LONG_PRESS_MS);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const s = dg.current; if (!s) return;
    const d = e.clientX - s.x; const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(d) < 8 && Math.abs(dy) < 8) return;
      clearLp();
      if (fired.current || selectMode) { s.axis = "y"; return; }
      s.axis = Math.abs(d) > Math.abs(dy) ? "x" : "y";
      if (s.axis !== "x") return;
      try { contentRef.current?.setPointerCapture(s.id); } catch { /* ignore */ }
      setDropping(false);
    }
    if (s.axis !== "x") return;
    // 拖够 DRAG_MIN 一次之后才认按钮，认了就不再收回（见 DRAG_MIN 的说明）
    if (Math.abs(d) >= DRAG_MIN) s.armed = true;
    // 按钮只在这一行里：手指出了这一行（拖到别的行、页面别处）就按「取消」算，松手什么都不做
    s.pick = s.armed ? optAt(e.clientX, e.clientY) ?? 0 : null;
    setPt({ x: e.clientX, y: e.clientY }); setPick(s.pick);
  }
  /** 松手（cancelled = 被浏览器打断，一律当取消处理） */
  function end(cancelled = false) {
    clearLp();
    const s = dg.current; dg.current = null;
    if (fired.current) { fired.current = false; return; }
    if (!s || s.axis !== "x") return;
    suppress.current = true; setTimeout(() => { suppress.current = false; }, 60);
    const k = cancelled ? null : s.pick;
    const opt = k === null ? null : OPTS[k];
    setDropping(true);
    // 「取消」、拖到行外、没拖够距离：卡片飞回按下的位置，什么都不做
    if (k === null || !opt || opt.o === "cancel") {
      setPick(null); setPt({ x: s.x, y: s.y });
      setTimeout(() => { setPt(null); setDropping(false); }, DROP_MS);
      return;
    }
    // 落在按钮上：卡片吸到那个按钮的中心淡出，动画结束再执行（「书签」不改状态）
    const b = optsRef.current?.children[k]?.getBoundingClientRect();
    if (b) setPt({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    setTimeout(() => {
      setPt(null); setPick(null); setDropping(false);
      if (opt.o === "bookmark") onBookmark(); else if (opt.o === "know") onProgress(); else onAct(opt.o as ListAct);
    }, DROP_MS);
  }
  return (
    <div className={"srow" + (pt ? " dragging" : "") + (selectMode ? " selecting" : "") + (masked ? " masked" : "") + (checked ? " checked" : "") + (revealed ? " revealed" : "") + (bookmarked ? " bookmarked" : "") + (flash ? " bm-flash" : "")} data-sp={row.spelling} data-id={row.id}>
      <div className="s-opts" ref={optsRef} aria-hidden>{OPTS.map((o, i) => <div key={o.o} className={`s-opt ${o.cls}${pick === i ? " active" : ""}`}>{o.label}{o.sub && <small>{o.sub}</small>}</div>)}</div>
      {/* 卡片挂到 body 上：留在行里会被列表的 overflow 裁掉，拖不出这一行 */}
      {pt && createPortal(
        <div className={"s-chip" + (armed ? ` on ${armed.cls}` : "") + (dropping ? " dropping" : "")}
          style={{ transform: `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)` }} aria-hidden>
          <Pie status={row.status} progress={row.pie} /><span className="t">{chipText}</span>{armed && <b className="a">{armed.label}</b>}
        </div>, document.body)}
      <div ref={contentRef} className="s-content"
        onPointerDown={down} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (suppress.current) return;
          if (selectMode) onToggle();
          else if (masked && !tailRef.current?.contains(e.target as Node)) toggleReveal();
          else onOpen();
        }}
        role={selectMode ? "checkbox" : undefined} aria-checked={selectMode ? checked : undefined}>
        <Pie status={row.status} progress={row.pie} />
        <button type="button" className="spk" aria-label={`播放 ${row.spelling} 的发音`} onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); speakWordAndDef(row.spelling, speechDef(), vk); }}><IconSpeaker /></button>
        {/* 点击都挂在整行（上面的 onClick）、按落点分派，而不是分别挂在这块和 .tail 上：
            两块都只有一行字高，行的上下内边距点到会落空；整行接住再按「落点在不在行尾区域」判断，留白也算数 */}
        <div className="main">
          <span className="word">{row.display ?? row.spelling}</span><span className="def">{row.pos && <i className="pos">{row.pos}</i>}{row.def}</span>
        </div>
        {/* 行尾区域：释义右侧的空白 + 到期日 + 箭头，撑满行高。遮罩模式下进详情靠这一整块，不只是箭头那 44px；
            左缘一道小竖线（CSS）标出与「单词 + 释义」的分界，鼠标悬上去在箭头旁显示提示 */}
        <div className="tail" ref={tailRef}>
          {row.due && row.status === "learning" && <span className="due">复习 {row.due}</span>}
          {masked && <span className="tip" aria-hidden>点击查看详情</span>}
          {/* 多选时勾选圈放在行尾，顶替进入详情的箭头；箭头不自己接点击（键盘上按 Enter 触发的 click 会冒泡到整行、落点在 .tail 里，同样进详情） */}
          {selectMode ? <span className={"s-check" + (checked ? " on" : "")} aria-hidden />
            : <button type="button" className="chev" aria-label={`打开 ${row.spelling} 的详情`}><IconChevron /></button>}
        </div>
      </div>
    </div>
  );
}

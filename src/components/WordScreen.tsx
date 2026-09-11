"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import WordDetail from "@/components/WordDetail";
import RateBar from "@/components/RateBar";
import BackLink from "@/components/BackLink";
import Dropdown from "@/components/Dropdown";
import { api, localToday } from "@/lib/client/api";
import { useMe } from "@/lib/client/useMe";
import { useToast } from "@/components/Toast";
import { speakSequence, voiceKeyOf } from "@/lib/client/speech";
import { emitWordChanged } from "@/lib/client/word-events";
import type { WordDetail as Detail } from "@/lib/study";
import type { RateResult } from "@/lib/scheduler";
import { AI_PROVIDERS, AI_PROVIDER_LABEL, type AiPreference } from "@/lib/ai/providers";

/** 左缘多少像素内起手才算「右滑返回」，与 iOS 的边缘手势一致，免得和 SwipeTabs 抢横向滑动 */
const EDGE = 24;
/** 划出去多远松手就关掉（不超过屏宽的三成） */
const CLOSE_AT = 90;
/** 关闭动画的时长，跟 globals.css 的 sheet-out 对齐 */
const OUT_MS = 170;
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 单词详情（需求 3.2.5），两种形态共用一套逻辑：
 * - `page`：独立页 `/word/[spelling]`，直接打开 / 刷新 / 分享链接时用；
 * - `overlay`：站内点词时由拦截路由 `@detail/(.)word/[spelling]` 渲染的全屏浮层，
 *   盖在词库列表 / 学习页之上——底层页面不卸载，返回就是关掉浮层，不重新请求、滚动位置原样还在。
 * 首屏的词条数据由服务端查好传进来（性能优化 P1-1），之后的切换来源、打分仍走接口。
 */
export default function WordScreen({ mode, spelling, initial, initialError = "" }: { mode: "page" | "overlay"; spelling: string; initial: Detail | null; initialError?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { settings, loading, update } = useMe();
  const [switching, setSwitching] = useState(false);
  const { toast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(initial);
  const [err, setErr] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const spoke = useRef(false);
  // 打过分才需要在关闭时通知底层页面同步（见 lib/client/word-events.ts）
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/words/${encodeURIComponent(spelling)}?date=${localToday()}`);
      setDetail(d);
      return d;
    } catch (e) { setErr((e as Error).message); return null; }
  }, [spelling]);

  useEffect(() => {
    if (!detail || loading || spoke.current || !settings.autoReadDetail) return;
    spoke.current = true;
    // 只读第一个例句：例句由接口每次随机排序，所以每次进来读到的都不一样（需求 3.2.5）
    speakSequence(detail.spelling, detail.view.examples.slice(0, 1).map((e) => e.en), voiceKeyOf(settings.accent, settings.voice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, loading]);

  /** 关掉浮层：先放关闭动画再 history.back（底层页面一直挂着，退回去不会重新加载） */
  const close = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    const back = setTimeout(() => router.back(), reduceMotion() ? 0 : OUT_MS);
    // 万一退不回去（历史里没有上一条），别把浮层卡在划出去的状态
    const reset = setTimeout(() => setClosing(false), 900);
    return () => { clearTimeout(back); clearTimeout(reset); };
  }, [closing, router]);

  // 离开时把改动推给底层还挂着的页面（浏览器后退、手势返回也走这里）
  useEffect(() => () => { if (dirty.current) emitWordChanged(spelling); }, [spelling]);

  /** 切换词条资料来源：保存到设置（与设置页同一项）并重新加载本词 */
  async function switchProvider(v: AiPreference) {
    if (switching || v === settings.aiProvider) return;
    setSwitching(true);
    try { await update({ aiProvider: v }); await load(); } catch (e) { toast((e as Error).message); } finally { setSwitching(false); }
  }

  async function rate(r: RateResult) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const res = await api<{ nextInterval: number }>("/api/study/rate", { method: "POST", json: { wordId: detail.id, result: r, date: localToday(), clientTs: `${detail.id}-${Date.now()}` } });
      dirty.current = true;
      toast(r === "master" ? "已标记为已掌握，不再进入学习" : r === "reset" ? "已重新记：保留学习记录，按新词重新开始" : res.nextInterval === 0 ? "今日学习时再次出现" : `下次复习：${res.nextInterval} 天后`);
      await load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  const top = (
    <div className="word-top">
      {/* 浮层里「返回」= 关掉浮层；独立页回到来处，直接打开 / 刷新进来的退到词库列表 */}
      {mode === "overlay"
        ? <button type="button" className="back" onClick={close}>‹ 返回</button>
        : <BackLink href="/wordbooks">‹ 返回</BackLink>}
      <span className="book small faint" title={detail?.bookName ?? undefined}>{detail?.bookName ? `当前词库：${detail.bookName}` : ""}</span>
      {detail && (
        <Dropdown<AiPreference> ariaLabel="词条资料来源" value={settings.aiProvider} disabled={switching} onChange={switchProvider}
          options={[{ value: "auto", label: "自动" }, ...AI_PROVIDERS.map((p) => ({ value: p as AiPreference, label: AI_PROVIDER_LABEL[p], note: detail.aiAvailable.includes(p) ? undefined : "无资料" }))]} />
      )}
    </div>
  );
  const body = (
    <>
      {err && <div className="err-msg mt-12">{err}</div>}
      {!detail ? <p className="muted mt-12">加载中…</p> : (
        <div className="mt-12"><WordDetail detail={detail} settings={settings} onNoteChange={(note) => setDetail({ ...detail, note })} /></div>
      )}
    </>
  );
  const bar = detail ? <RateBar labels={detail.labels} mastered={detail.status === "mastered"} removed={detail.progress.status === "removed"} onRate={rate} disabled={busy} /> : null;

  // 平行插槽在跳到别的页面时会留着上一次的内容（Next 的已知行为），按地址兜底：
  // 已经不在 /word/... 上就别再盖着人家的页面
  if (mode === "overlay") return pathname.startsWith("/word/") ? <WordSheet closing={closing} onClose={close} top={top} bar={bar}>{body}</WordSheet> : null;
  return (
    <AppShell nav="books" tabbar={false}>
      <main className="page narrow has-ratebar-pad">{top}{body}</main>
      {bar}
    </AppShell>
  );
}

/**
 * 详情浮层的外壳：覆盖整屏、自己滚动，顶栏吸顶。
 * 关闭方式：顶栏「返回」/ Esc / 从左缘往右滑 / 浏览器后退，都是回到上一条历史。
 */
function WordSheet({ closing, onClose, top, bar, children }: { closing: boolean; onClose: () => void; top: React.ReactNode; bar: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; axis: "x" | "y" | null; id: number } | null>(null);

  // Esc 关闭；备注 / 反馈弹窗或点词小框开着时先让它们关掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop.open, #peek")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 锁住底层页面并记住它的滚动位置：只靠浮层遮住的话，iOS 上滑到底会带着后面的列表一起滚
  useEffect(() => {
    const y = window.scrollY;
    const s = document.body.style;
    const prev = { position: s.position, top: s.top, width: s.width };
    s.position = "fixed"; s.top = `-${y}px`; s.width = "100%";
    return () => { s.position = prev.position; s.top = prev.top; s.width = prev.width; window.scrollTo(0, y); };
  }, []);

  // 左缘右滑返回：起手点必须在最左边一条，且不能落在按钮上（打分栏也用 Pointer Events）
  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (closing || e.clientX > EDGE || (e.target as HTMLElement).closest("button,a,input,textarea,.rate-bar")) return;
    // 拦下这一次按下，免得内层的 SwipeTabs 把同一次滑动当成切 Tab
    e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY, axis: null, id: e.pointerId };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current, el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") { try { el.setPointerCapture(d.id); } catch { /* ignore */ } el.classList.add("dragging"); }
    }
    if (d.axis === "x") el.style.transform = `translateX(${Math.max(0, dx)}px)`;
  }
  function end(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current, el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    el.classList.remove("dragging");
    el.style.transform = "";
    if (d.axis === "x" && e.clientX - d.x > Math.min(el.offsetWidth * 0.3, CLOSE_AT)) onClose();
  }
  function cancel() { drag.current = null; ref.current?.classList.remove("dragging"); if (ref.current) ref.current.style.transform = ""; }

  return (
    <div ref={ref} className={"word-sheet" + (closing ? " closing" : "")} role="dialog" aria-modal="true" aria-label="单词详情"
      onPointerDownCapture={down} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
      <div className="sheet-top">{top}</div>
      <div className="sheet-body has-ratebar-pad">{children}</div>
      {bar}
    </div>
  );
}

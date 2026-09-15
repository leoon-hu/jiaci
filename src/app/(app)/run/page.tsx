"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { IconNext, IconPause, IconPlay, IconPrev, IconX } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api, localToday } from "@/lib/client/api";
import { useMe } from "@/lib/client/useMe";
import { voiceKeyOf } from "@/lib/client/speech";
import { applyOptions, jumpTo, next, pause, play, prepare, prev, stop, useRunPlayer, type RunOptions, type RunWord } from "@/lib/client/run-player";
import type { UserSettings } from "@/lib/settings";
import "./run.css";

type RunResp = { words: RunWord[]; total: number; hasBook: boolean };
const KIND_TAG: Record<RunWord["kind"], [string, string]> = { review: ["tag-review", "复习"], new: ["tag-new", "新词"], done: ["tag-result-know", "今日已学"] };
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2];
const optionsOf = (s: UserSettings): RunOptions => ({ repeat: s.runRepeat, def: s.runDef, sentence: s.runSentence, gap: s.runGap, speed: s.runSpeed });
const minutes = (sec: number) => Math.max(1, Math.round(sec / 60));

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, label]) => <button key={String(v)} type="button" className={value === v ? "active" : ""} onClick={() => onChange(v)}>{label}</button>)}</div>;
}
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>;
}

/**
 * 跑步模式（需求 3.2.6）：熄屏后台循环朗读今天的学习内容。播放器是模块级单例（lib/client/run-player），
 * 这个页面只负责取今天的内容、把设置交给它、画它的状态；离开页面不停，主框架的小条可以回来。
 */
export default function RunPage() {
  const { settings, update, loading: meLoading } = useMe();
  const st = useRunPlayer();
  const { toast } = useToast();
  const [data, setData] = useState<RunResp | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [booted, setBooted] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  const load = () => api<RunResp>(`/api/study/run?date=${localToday()}`).then(setData).catch((e) => setLoadErr((e as Error).message));
  useEffect(() => { load(); }, []);
  // iOS 上的微信 / 内嵌浏览器不保证后台播放，提示用 Safari 打开
  useEffect(() => { const ua = navigator.userAgent; setEmbedded(/iPhone|iPad/.test(ua) && /MicroMessenger|FBAN|FBAV|Instagram|Line\/|Weibo|QQ\//i.test(ua)); }, []);

  // 内容与设置都到手后准备一次：回到页面时播放器还在放（或准备着）就不打断，内容有更新只提示；
  // 准备好但还没开始播的、放的是旧内容，直接按新内容重新准备
  // 按集合比、不看顺序：接口每次返回的顺序不稳定（混合 / 随机顺序会洗牌，同日到期的复习词先后也不固定），
  // 开发环境 StrictMode 还会把挂载请求跑两遍，按顺序比会把同一批词当成「有更新」
  const sameWords = !!data && st.words.length === data.words.length && (() => { const ids = new Set(st.words.map((w) => w.wordId)); return data.words.every((w) => ids.has(w.wordId)); })();
  useEffect(() => {
    if (!data || meLoading || booted) return;
    setBooted(true);
    if (!data.hasBook || !data.words.length) return;
    if (st.status === "preparing" || st.status === "playing" || st.status === "paused" || (st.status === "ready" && sameWords)) return;
    prepare(data.words, optionsOf(settings), voiceKeyOf(settings.accent, settings.voice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, meLoading, booted]);

  const restart = async () => { setLoadErr(""); const r = await api<RunResp>(`/api/study/run?date=${localToday()}`).catch((e) => { setLoadErr((e as Error).message); return null; }); if (!r) return; setData(r); if (r.words.length) prepare(r.words, optionsOf(settings), voiceKeyOf(settings.accent, settings.voice)); };

  async function save(patch: Partial<UserSettings>) {
    const merged = { ...settings, ...patch };
    applyOptions(optionsOf(merged));
    try { await update(patch); } catch (e) { toast(`没有保存成功：${(e as Error).message}`); }
  }

  const words = st.words.length ? st.words : data?.words ?? [];
  const cur = st.index >= 0 ? words[st.index] : null;
  const playing = st.status === "playing";
  const active = playing || st.status === "paused";
  const position = st.index >= 0 ? `${st.index + 1} / ${words.length}` : words.length ? `${words.length} 词` : "";

  let hero: React.ReactNode;
  if (loadErr && !words.length) hero = <div className="run-hero"><p>今天的内容没能加载出来</p><p className="err-msg">{loadErr}</p><button className="btn btn-primary" onClick={() => { setLoadErr(""); load(); }}>重新加载</button></div>;
  else if (!data && st.status === "idle") hero = <div className="run-hero"><p className="muted">正在读取今天的内容…</p></div>;
  else if (data && !data.hasBook) hero = <div className="run-hero"><p>还没有选择词库</p><Link className="btn btn-primary" href="/wordbooks">去选择词库</Link></div>;
  else if (data && !data.words.length && !st.words.length) hero = <div className="run-hero"><p>今天没有可播放的内容</p><p className="small muted">学习首页有待学或已完成的词时，这里就能听</p><Link className="btn btn-primary" href="/home">返回首页</Link></div>;
  else if (st.status === "preparing") hero = (
    <div className="run-hero">
      <div className="run-emoji">🎧</div>
      <p>正在准备音频 {st.progress.done} / {st.progress.total || "…"}</p>
      <div className="progress run-progress"><i style={{ width: `${st.progress.total ? (st.progress.done / st.progress.total) * 100 : 0}%` }} /></div>
      <p className="small muted">第一次准备会把今天要用的音频全部下载好，跑步中不再需要网络；没有现成音频的例句要现合成，可能要等一两分钟</p>
    </div>
  );
  else if (st.status === "ready") hero = (
    <div className="run-hero">
      <div className="run-emoji">🎧</div>
      <p className="run-summary">今天 {words.length - st.skipped} 个词 · 一轮约 {minutes(st.duration / settings.runSpeed)} 分钟，循环播放</p>
      {st.skipped > 0 && <p className="small muted">{st.skipped} 个词还没有音频，这轮先跳过</p>}
      {data && data.total > data.words.length && <p className="small muted">今天共 {data.total} 个词，只取前 {data.words.length} 个</p>}
      <button className="btn btn-primary btn-lg btn-block run-start" onClick={play}><IconPlay /> 开始播放</button>
      <p className="small muted">戴上耳机，点开始后就可以熄屏放进口袋；锁屏和耳机上可以暂停、切词</p>
    </div>
  );
  else if (st.status === "error") hero = <div className="run-hero"><p>{st.error}</p><button className="btn btn-primary" onClick={restart}>重新准备</button></div>;
  else if (st.status === "idle") hero = <div className="run-hero"><div className="run-emoji">🎧</div><p className="muted">已停止</p><button className="btn btn-primary btn-lg" onClick={restart}>重新准备</button></div>;
  else hero = (
    <div className="run-hero now">
      {cur && (
        <div className="run-now">
          <span className={`tag ${KIND_TAG[cur.kind][0]}`}>{KIND_TAG[cur.kind][1]}</span>
          <div className="run-word">{cur.display ?? cur.spelling}</div>
          <div className="run-phonetic">{cur.phonetic ? (settings.accent === "uk" ? cur.phonetic.uk : cur.phonetic.us) : " "}</div>
          {settings.runDef && cur.def && <div className="run-def">{cur.def}</div>}
          {settings.runSentence && cur.sentence && <div className="run-sentence">{cur.sentence}</div>}
        </div>
      )}
      <div className="run-controls">
        <button className="btn btn-secondary btn-icon" type="button" onClick={prev} aria-label="上一个"><IconPrev /></button>
        <button className="btn btn-primary btn-icon run-toggle" type="button" onClick={playing ? pause : play} aria-label={playing ? "暂停" : "继续"}>{playing ? <IconPause /> : <IconPlay />}</button>
        <button className="btn btn-secondary btn-icon" type="button" onClick={next} aria-label="下一个"><IconNext /></button>
      </div>
      {st.error && <p className="err-msg center">{st.error}</p>}
      <p className="small muted">{playing ? "熄屏或切到其它应用都会继续播放；锁屏和耳机上可以暂停、切词" : "已暂停"}</p>
      <button className="btn btn-ghost btn-sm" type="button" onClick={stop}>停止</button>
    </div>
  );

  return (
    <main className="run-page">
      <div className="run-top">
        <Link className="btn btn-icon sm btn-ghost" href="/home" aria-label="返回首页" title="返回首页（播放不会停）"><IconX /></Link>
        <div className="run-title">跑步模式</div>
        <div className="run-count">{position}</div>
      </div>
      {embedded && <p className="run-notice">当前浏览器熄屏后可能停止播放，建议用 Safari 打开本页</p>}
      {data && st.status !== "idle" && st.status !== "error" && !sameWords && <p className="run-notice">今天的内容有更新，停止后重新准备即可听到</p>}
      {hero}
      {words.length > 0 && (
        <>
          <div className="section-title">播放设置</div>
          <div className="list">
            <div className="row setting"><div className="main"><div className="title">每个单词读几遍</div></div><div className="ctl"><Seg value={settings.runRepeat} options={[[1, "1"], [2, "2"], [3, "3"]]} onChange={(v) => save({ runRepeat: v })} /></div></div>
            <div className="row setting"><div className="main"><div className="title">读中文释义</div></div><div className="ctl"><Switch checked={settings.runDef} onChange={(v) => save({ runDef: v })} /></div></div>
            <div className="row setting"><div className="main"><div className="title">读例句</div><div className="desc">每个词读第一条例句</div></div><div className="ctl"><Switch checked={settings.runSentence} onChange={(v) => save({ runSentence: v })} /></div></div>
            <div className="row setting"><div className="main"><div className="title">词与词之间停几秒</div></div><div className="ctl"><Seg value={settings.runGap} options={[[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]]} onChange={(v) => save({ runGap: v })} /></div></div>
            <div className="row setting"><div className="main"><div className="title">语速</div></div><div className="ctl"><Seg value={settings.runSpeed} options={SPEEDS.map((v) => [v, v === 1 ? "1.0" : String(v)])} onChange={(v) => save({ runSpeed: v })} /></div></div>
          </div>
          <div className="section-title">今天的词 <span className="muted" style={{ fontWeight: 400 }}>{words.length}</span></div>
          <div className="list run-list">
            {words.map((w, i) => (
              <div key={w.wordId} className={"row link" + (i === st.index ? " current" : "")} onClick={() => { if (active || st.status === "ready") jumpTo(i); }}>
                <div className="main"><div className="title">{w.display ?? w.spelling}</div><div className="sub">{w.def ?? "—"}</div></div>
                <span className={`tag ${KIND_TAG[w.kind][0]}`}>{KIND_TAG[w.kind][1]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

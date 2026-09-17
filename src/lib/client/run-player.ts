"use client";
/**
 * 跑步模式播放器（需求 3.2.6）：模块级单例，不随页面卸载而停，/run 页面与主框架的小条都只订阅它的状态。
 *
 * 熄屏后浏览器只保留「用户点击启动过、正在播放的 <audio>」——Web Speech、Web Audio、定时器、处于暂停的元素都活不过锁屏。
 * 所以开跑前把今天所有片段下载进内存，按 lib/run-plan 拼成一整段 Blob（词间间隔是拼进去的静音帧），
 * 一个 <audio loop> 从头播到尾、循环；播放中零次换 src、零个定时器、零次网络请求。
 * 锁屏 / 通知栏 / 耳机的控制走 MediaSession；timeupdate 对照 cue 表更新当前词与锁屏文字。
 */
import { useSyncExternalStore } from "react";
import { audioUrl, setExclusivePlayer, stopSpeaking, type VoiceKey } from "./speech";
import { buildRunPlan, clampExamples, cueIndexAt, frameCount, FRAME_BYTES, isRunClip, SILENCE_FRAME, type RunClipKind, type RunCue, type RunPlanOptions } from "@/lib/run-plan";

export type RunWord = { wordId: string; spelling: string; display: string | null; kind: "review" | "new" | "done"; phonetic: { us: string; uk: string } | null; def: string | null; examples: Array<{ en: string; zh: string }> };
export type RunOptions = RunPlanOptions & { speed: number };
export type RunStatus = "idle" | "preparing" | "ready" | "playing" | "paused" | "error";
export type RunState = {
  status: RunStatus;
  words: RunWord[];
  /** 当前词在 words 里的下标；还没开始时是第一个会播的词 */
  index: number;
  /** 下载进度（去重后的片段数）；播放中改设置需要补下载片段时也走这里（done < total 就是在补） */
  progress: { done: number; total: number };
  /** 一段音频都没有、被跳过的词数 */
  skipped: number;
  /** 一轮的时长（秒） */
  duration: number;
  error: string;
};

const INITIAL: RunState = { status: "idle", words: [], index: -1, progress: { done: 0, total: 0 }, skipped: 0, duration: 0, error: "" };
let state: RunState = INITIAL;
const listeners = new Set<() => void>();
function set(patch: Partial<RunState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useRunPlayer(): RunState { return useSyncExternalStore(subscribe, () => state, () => INITIAL); }

// ---- 内部状态 ----
let audio: HTMLAudioElement | null = null;
let blobUrl = "";
let cues: RunCue[] = [];
/** 每个词各段片段的 URL：单词、释义、每条例句的英文与译文（没有的不填） */
type ClipUrls = { word?: string; definition?: string; examples: Array<{ en?: string; zh?: string }> };
let clipUrls: ClipUrls[] = [];
/** 已下载且格式合格的片段，保留到 stop()；改设置只重新拼接，要用到还没下载的段（多开一条例句、加上译文）才补下载 */
let clips = new Map<string, ArrayBuffer>();
/** 试过拿不到的片段（没有音频、格式不对），改设置时不再反复去要 */
let unavailable = new Set<string>();
let options: RunOptions = { repeat: 2, def: true, sentence: "both", examples: 2, gap: 2, speed: 1 };
/** 补下载的序号：改设置连点几下，只有最后一次的结果拿来重拼 */
let topUpSeq = 0;
/** 正在换 src（准备 / 改设置重拼）：期间的 pause 事件不当成播放状态变化；metadata 到了就清掉 */
let rebuilding = false;
let prepareSeq = 0;
let aborter: AbortController | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 同时下载几段：现成的文件几毫秒一段，要现合成的由服务端的合成并发（tts.concurrency）排队，开多几路让合成那边一直有活干 */
const DOWNLOAD_CONCURRENCY = 6;

/** 被限速时最多等多久（毫秒）：一轮要现合成几百段时，按 Retry-After 排队等，等够这么久还没轮到才放弃 */
const RATE_LIMIT_WAIT_MS = 10 * 60_000;

/**
 * 下载一段：429 是按需合成限速，按响应的 Retry-After 等（没有就 5 秒）再要，累计等满 RATE_LIMIT_WAIT_MS 才放弃；
 * 404 / 507 是没有音频且合成不了，跳过；网络错误与其它状态最多试 4 次
 */
async function fetchClip(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  let waited = 0;
  for (let attempt = 1; attempt <= 4; ) {
    let r: Response;
    try { r = await fetch(url, { credentials: "same-origin", signal }); }
    catch { if (signal.aborted || ++attempt > 4) return null; await sleep(3000); continue; }
    if (r.ok) return r.arrayBuffer();
    if (r.status === 404 || r.status === 507) return null;
    if (r.status === 429) {
      const ms = Math.min(60_000, Math.max(1000, (Number(r.headers.get("retry-after")) || 5) * 1000));
      if (waited >= RATE_LIMIT_WAIT_MS) return null;
      waited += ms;
      await sleep(ms);
      continue;
    }
    if (++attempt > 4) return null;
    await sleep(3000);
  }
  return null;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const silenceCache = new Map<number, ArrayBuffer>();
function silence(frames: number): ArrayBuffer {
  let b = silenceCache.get(frames);
  if (!b) {
    const u = new Uint8Array(frames * FRAME_BYTES);
    for (let i = 0; i < frames; i++) u.set(SILENCE_FRAME, i * FRAME_BYTES);
    b = u.buffer;
    silenceCache.set(frames, b);
  }
  return b;
}

const active = () => cues.length > 0 && state.status !== "idle" && state.status !== "preparing";

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.loop = true;
  a.addEventListener("timeupdate", () => {
    if (!cues.length) return;
    const w = cues[cueIndexAt(cues, a.currentTime)]?.word;
    if (w !== undefined && w !== state.index) { set({ index: w }); updateMetadata(); }
  });
  // 真的开始播了，换 src 的过程就算结束（有的平台要到 play() 才加载 metadata）
  a.addEventListener("play", () => { rebuilding = false; if (active()) { set({ status: "playing", error: "" }); setPlaybackState("playing"); } });
  // 自己按的暂停、锁屏控件的暂停、来电 / Siri / 耳机断开的打断都到这里，一律停在暂停态，不自动恢复：
  // 耳机断开时收到的也是同一个 pause，自动恢复会从手机外放；用户在锁屏控件上点一下播放即可继续
  a.addEventListener("pause", () => { if (active() && !rebuilding) { set({ status: "paused" }); setPlaybackState("paused"); } });
  a.addEventListener("error", () => { if (a.getAttribute("src")) { rebuilding = false; set({ status: "error", error: "音频播放出错，请重新准备" }); } });
  audio = a;
  return a;
}

function setPlaybackState(s: MediaSessionPlaybackState) { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = s; }

function updateMetadata() {
  if (!("mediaSession" in navigator)) return;
  const w = state.words[state.index];
  if (!w) { navigator.mediaSession.metadata = null; return; }
  const pos = cues.findIndex((c) => c.word === state.index) + 1;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: w.display ?? w.spelling,
    artist: w.def ?? w.phonetic?.us ?? "",
    album: `AI加词 · 跑步模式 ${pos} / ${cues.length}`,
    artwork: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
}

let sessionReady = false;
/** 锁屏 / 通知栏 / 耳机按键：不支持的动作名有的浏览器会抛，逐个 try */
function setupMediaSession() {
  if (sessionReady || !("mediaSession" in navigator)) return;
  sessionReady = true;
  const handlers: Array<[MediaSessionAction, () => void]> = [["play", play], ["pause", pause], ["previoustrack", prev], ["nexttrack", next], ["stop", stop]];
  for (const [action, fn] of handlers) { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* 不支持这个动作 */ } }
}
function clearMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = null;
  setPlaybackState("none");
}

const sizeOf = (u: string | undefined) => (u ? clips.get(u)?.byteLength : undefined);
/** 片段 URL → 一个词各段的字节数（拼接计划只看有没有、多大） */
const sizesOf = (u: ClipUrls) => ({ clips: { word: sizeOf(u.word), definition: sizeOf(u.definition) }, examples: u.examples.map((e) => ({ en: sizeOf(e.en), zh: sizeOf(e.zh) })) });
/** 拼接计划里某一段对应的 URL */
const urlOf = (u: ClipUrls, kind: RunClipKind, n: number) => kind === "word" ? u.word : kind === "definition" ? u.definition : kind === "sentence" ? u.examples[n]?.en : u.examples[n]?.zh;

/** 按设置算出这一批词要用到哪些片段（去重）：单词总要，释义看 def，例句取前 examples 条、译文只在 both 时要 */
function neededUrls(opts: RunOptions): string[] {
  const out = new Set<string>();
  for (const u of clipUrls) {
    if (u.word) out.add(u.word);
    if (opts.def && u.definition) out.add(u.definition);
    if (opts.sentence !== "off") for (const e of u.examples.slice(0, clampExamples(opts.examples))) {
      if (e.en) out.add(e.en);
      if (opts.sentence === "both" && e.zh) out.add(e.zh);
    }
  }
  return Array.from(out);
}

/** 下载一批片段进 clips（拿不到的记进 unavailable），进度写到 state.progress；被作废（seq 变了）就中途返回 false */
async function download(urls: string[], signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> {
  set({ progress: { done: 0, total: urls.length } });
  let done = 0;
  await pool(urls, DOWNLOAD_CONCURRENCY, async (u) => {
    const b = await fetchClip(u, signal);
    if (!isCurrent()) return;
    if (b && isRunClip(new Uint8Array(b))) clips.set(u, b); else unavailable.add(u);
    set({ progress: { done: ++done, total: urls.length } });
  });
  return isCurrent();
}

/**
 * 按当前设置把片段拼成一整段，从 atWord 这个词开始；resume 时 metadata 就绪就接着播。
 * 不等 metadata 就返回：iOS 可能要到 play() 才真正加载，等它会让「开始」按钮永远出不来；
 * 初次拼接从 0 开始不需要 seek，重拼时的 seek 与续播放在 loadedmetadata 里做。
 */
function build(atWord: number, resume: boolean) {
  const plan = buildRunPlan(clipUrls.map(sizesOf), options);
  cues = plan.cues;
  const parts: ArrayBuffer[] = plan.parts.map((p) => {
    if (p.type === "silence") return silence(p.frames);
    const b = clips.get(urlOf(clipUrls[p.word], p.kind, p.n)!)!;
    // 只拼整帧（现有文件都是整帧，防万一）
    return b.slice(0, frameCount(b.byteLength) * FRAME_BYTES);
  });
  const a = ensureAudio();
  rebuilding = true;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
  const ci = Math.max(0, cues.findIndex((c) => c.word === atWord));
  const startAt = cues[ci]?.start ?? 0;
  set({ skipped: plan.skipped.length, duration: plan.duration, index: cues[ci]?.word ?? -1 });
  updateMetadata();
  const onMeta = () => {
    a.removeEventListener("error", onErr);
    if (startAt > 0) a.currentTime = startAt;
    rebuilding = false;
    if (resume) a.play().catch(() => { set({ status: "paused" }); });
  };
  const onErr = () => { a.removeEventListener("loadedmetadata", onMeta); };
  a.addEventListener("loadedmetadata", onMeta, { once: true });
  a.addEventListener("error", onErr, { once: true });
  a.src = blobUrl;
  a.playbackRate = options.speed;
  a.load();
}

/** 下载今天的片段并拼好，状态 preparing → ready；再次调用会作废上一次 */
export async function prepare(words: RunWord[], opts: RunOptions, key: VoiceKey) {
  reset();
  const my = ++prepareSeq;
  aborter = new AbortController();
  const { signal } = aborter;
  options = opts;
  set({ status: "preparing", words, index: -1, progress: { done: 0, total: 0 }, skipped: 0, duration: 0, error: "" });
  // 例句译文是中文，与释义走同一种音频（中文音色）
  clipUrls = await Promise.all(words.map(async (w) => ({
    word: (await audioUrl("word", w.spelling, key)) ?? undefined,
    definition: w.def ? (await audioUrl("definition", w.def, key)) ?? undefined : undefined,
    examples: await Promise.all(w.examples.map(async (e) => ({
      en: (await audioUrl("sentence", e.en, key)) ?? undefined,
      zh: (await audioUrl("definition", e.zh, key)) ?? undefined,
    }))),
  })));
  if (my !== prepareSeq) return;
  // 只下载当前设置用得到的段：三条例句带译文全下载的话 150 词要 20 MB 上下，改设置再补
  const urls = neededUrls(options);
  if (!(await download(urls, signal, () => my === prepareSeq))) return;
  if (!clips.size) {
    set({ status: "error", error: urls.length ? "没有拿到可用的音频：网络不通，或当前的音频格式不支持跑步模式" : "这些词还没有可朗读的音频" });
    return;
  }
  build(0, false);
  set({ status: "ready" });
}

/** 开始 / 继续：必须在用户点击的处理函数里同步调用，元素由此解锁，之后锁屏控件才能控制 */
export function play() {
  const a = audio;
  if (!a || !cues.length || state.status === "idle" || state.status === "preparing") return;
  stopSpeaking();
  setupMediaSession();
  updateMetadata();
  a.play().catch((e: unknown) => {
    set({ status: "paused", error: (e as { name?: string })?.name === "NotAllowedError" ? "浏览器没有允许播放，请再点一次" : "" });
  });
}
export function pause() { audio?.pause(); }
export function toggle() { if (state.status === "playing") pause(); else play(); }

function seekToCue(ci: number) {
  const a = audio;
  if (!a || !cues.length) return;
  const c = cues[(ci + cues.length) % cues.length];
  a.currentTime = c.start;
  set({ index: c.word });
  updateMetadata();
}
export function next() { if (audio && cues.length) seekToCue(cueIndexAt(cues, audio.currentTime) + 1); }
export function prev() { if (audio && cues.length) seekToCue(cueIndexAt(cues, audio.currentTime) - 1); }
/** 跳到某个词（词表里点一行）；被跳过的词没有 cue，不动 */
export function jumpTo(word: number) { const ci = cues.findIndex((c) => c.word === word); if (ci >= 0) seekToCue(ci); }

/**
 * 改设置：语速直接改；其余重新拼接，当前词接着播。已有的片段不重新下载；
 * 用到还没下载的段（多开一条例句、加上译文）先补下载，期间照常播旧的一段，补完再重拼
 */
export function applyOptions(patch: Partial<RunOptions>) {
  const before = options;
  options = { ...options, ...patch };
  if (!audio || !clips.size || state.status === "preparing" || state.status === "idle") return;
  if (patch.speed !== undefined) audio.playbackRate = options.speed;
  const structural = (["repeat", "def", "sentence", "examples", "gap"] as const).some((k) => patch[k] !== undefined && patch[k] !== before[k]);
  if (!structural) return;
  const missing = neededUrls(options).filter((u) => !clips.has(u) && !unavailable.has(u));
  const rebuild = () => build(Math.max(0, state.index), state.status === "playing");
  if (!missing.length) { rebuild(); return; }
  const my = ++topUpSeq, mine = prepareSeq;
  const signal = aborter?.signal ?? new AbortController().signal;
  download(missing, signal, () => my === topUpSeq && mine === prepareSeq).then((ok) => { if (ok) rebuild(); });
}

/** 放掉正在进行的准备、音频源与片段；不发状态（prepare 里紧接着就进 preparing，不要闪一下空闲态） */
function reset() {
  aborter?.abort();
  aborter = null;
  prepareSeq++;
  topUpSeq++;
  cues = [];
  clipUrls = [];
  clips = new Map();
  unavailable = new Set();
  state = { ...INITIAL };
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ""; }
  rebuilding = false;
  clearMediaSession();
}
/** 停止：释放音频与片段，回到 idle；再开要重新准备 */
export function stop() { reset(); set({}); }

if (typeof window !== "undefined") {
  // 别处开始朗读（小喇叭、学习卡自动发音）时让位，两路声音不叠在一起
  setExclusivePlayer(() => { if (state.status === "playing") pause(); });
}

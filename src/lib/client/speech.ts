"use client";
/**
 * 发音（需求 7.1）：单词、例句与中文释义都优先播放服务端预生成 / 按需合成的音频文件（/api/audio/…），
 * 播放失败（没有文件、网络错误）再退到浏览器 Web Speech，并明确挑音色（英文段挑英文嗓子，释义挑中文嗓子）。
 * URL 由这里按文本规则拼出（单词按拼写，例句与释义按规范化文本的 SHA-1），音色名从 /api/config/public 的 ttsVoices / ttsDefVoice 取，接口不用下发。
 */
import { clipUrlPath, voiceKeyOf, type VoiceKey } from "@/lib/tts/text";
export { voiceKeyOf, type VoiceKey };

type Outcome = "ended" | "failed" | "blocked" | "stopped";
type Kind = "word" | "sentence" | "definition";

/** 四种英文音色 + 中文音色（释义用） */
type VoiceMap = { keys: Record<string, string>; def: string };
let voicesCache: VoiceMap | null = null;
let voicesPromise: Promise<VoiceMap> | null = null;
async function voices(): Promise<VoiceMap> {
  if (voicesCache) return voicesCache;
  voicesPromise ??= fetch("/api/config/public", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((d) => (voicesCache = { keys: (d?.ttsVoices as Record<string, string>) ?? {}, def: (d?.ttsDefVoice as string) ?? "" }))
    .catch(() => { voicesPromise = null; return { keys: {}, def: "" }; });
  return voicesPromise;
}

/**
 * 已知取不到音频的 URL。记时间戳而不是永久拉黑：限速 429、瞬时 5xx 之后音频往往就有了，
 * 永久标记会让整个页面生命周期都退到质量差很多的 Web Speech（审计 F045）。
 */
const MISS_TTL = 5 * 60_000;
const missing = new Map<string, number>();
const isMissing = (u: string) => { const t = missing.get(u); if (t === undefined) return false; if (Date.now() - t < MISS_TTL) return true; missing.delete(u); return false; };
const markMissing = (u: string) => missing.set(u, Date.now());
const preloaded = new Set<string>();
let current: HTMLAudioElement | null = null;
/** 每次发起朗读递增；异步链路里发现序号变了就放弃，避免旧的朗读盖住新的 */
let seq = 0;
/** 独占的长播放（跑步模式）：这里任何一次朗读开始前先让它暂停，两路声音不叠在一起；只停朗读（stopSpeaking）不碰它 */
let exclusive: (() => void) | null = null;
export function setExclusivePlayer(pause: (() => void) | null) { exclusive = pause; }

function stopAll() {
  if (current) { const a = current; current = null; a.pause(); }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
/** 开始一次新的朗读：停掉上一次与跑步模式，拿到本次序号 */
function begin(): number { stopAll(); exclusive?.(); return ++seq; }

function playUrl(url: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    current = a;
    let done = false;
    const finish = (o: Outcome) => { if (done) return; done = true; if (current === a) current = null; resolve(o); };
    a.onended = () => finish("ended");
    a.onerror = () => finish(current === a ? "failed" : "stopped");
    a.onpause = () => { if (!a.ended && current !== a) finish("stopped"); };
    a.play().catch((e: unknown) => finish((e as { name?: string })?.name === "NotAllowedError" ? "blocked" : "failed"));
  });
}

// ---- Web Speech 兜底：等音色列表加载后按口音、性别挑英文音色，避免中文系统用中文音色念英文；释义反过来挑中文音色 ----
let voiceList: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (typeof speechSynthesis === "undefined") return;
  voiceList = speechSynthesis.getVoices();
  if (!voiceList.length) speechSynthesis.addEventListener("voiceschanged", () => { voiceList = speechSynthesis.getVoices(); }, { once: true });
}
if (typeof window !== "undefined") loadVoices();
const PREFER: Record<VoiceKey, string[]> = {
  us_female: ["Google US English", "Microsoft Aria", "Microsoft Jenny", "Samantha", "Ava", "Allison"],
  us_male: ["Microsoft Guy", "Microsoft Christopher", "Alex", "Fred", "Tom"],
  uk_female: ["Google UK English Female", "Microsoft Sonia", "Microsoft Libby", "Kate", "Serena", "Martha"],
  uk_male: ["Google UK English Male", "Microsoft Ryan", "Daniel", "Arthur", "Oliver"],
};
function pickVoice(key: VoiceKey): SpeechSynthesisVoice | null {
  if (!voiceList.length) loadVoices();
  const lang = key.startsWith("uk") ? "en-gb" : "en-us";
  for (const name of PREFER[key]) { const v = voiceList.find((x) => x.name.includes(name)); if (v) return v; }
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return voiceList.find((v) => norm(v.lang) === lang) ?? voiceList.find((v) => norm(v.lang).startsWith("en")) ?? null;
}
/** 中文释义的兜底音色：优先常见的普通话嗓子，其次任意 zh 音色；一个都没有就返回 null 并只设 lang */
const PREFER_ZH = ["Microsoft Xiaoxiao", "Microsoft Yunxi", "Microsoft Huihui", "Ting-Ting", "Tingting", "Google 普通话", "Google 中文"];
function pickZhVoice(): SpeechSynthesisVoice | null {
  if (!voiceList.length) loadVoices();
  for (const name of PREFER_ZH) { const v = voiceList.find((x) => x.name.includes(name)); if (v) return v; }
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return voiceList.find((v) => norm(v.lang) === "zh-cn") ?? voiceList.find((v) => norm(v.lang).startsWith("zh")) ?? null;
}
function tts(text: string, key: VoiceKey, rate: number, zh = false): Promise<Outcome> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve("failed");
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = zh ? pickZhVoice() : pickVoice(key);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = zh ? "zh-CN" : key.startsWith("uk") ? "en-GB" : "en-US";
    u.rate = rate;
    u.onend = () => resolve("ended");
    u.onerror = (e) => resolve(e.error === "interrupted" || e.error === "canceled" ? "stopped" : "failed");
    speechSynthesis.speak(u);
  });
}

/** 一段音频的访问 URL（音色名按当前配置取，取不到返回 null）；跑步模式下载片段也用它 */
export async function audioUrl(kind: Kind, text: string, key: VoiceKey): Promise<string | null> {
  const v = await voices();
  const voice = kind === "definition" ? v.def : v.keys[key];
  return voice ? `/api/audio/${clipUrlPath(kind, voice, text)}` : null;
}
const urlFor = audioUrl;

/** 播放一段：音频文件 → 失败记为缺失并退到 Web Speech；my 是发起时的序号，变了就放弃 */
async function speak(kind: Kind, text: string, key: VoiceKey, my: number): Promise<Outcome> {
  const url = await urlFor(kind, text, key);
  if (my !== seq) return "stopped";
  if (url && !isMissing(url)) {
    const r = await playUrl(url);
    if (r !== "failed") return r;
    markMissing(url);
  }
  if (my !== seq) return "stopped";
  return tts(text, key, kind === "word" ? 0.9 : 0.95, kind === "definition");
}

/** 读单词 */
export async function speakWord(word: string, key: VoiceKey) { const my = begin(); await speak("word", word, key, my); }
/** 读句子 */
export async function speakSentence(text: string, key: VoiceKey) { const my = begin(); await speak("sentence", text, key, my); }
/** 进入详情自动朗读：单词 → 例句，串行；被自动播放策略拦住或被新的朗读打断就停。
 *  详情页只传第一个例句（例句顺序由接口每次随机），学习卡答案态同理 */
export async function speakSequence(word: string, sentences: string[], key: VoiceKey) {
  const my = begin();
  let r = await speak("word", word, key, my);
  for (const s of sentences) {
    if (my !== seq || r === "stopped" || r === "blocked") return;
    r = await speak("sentence", s, key, my);
  }
}
/**
 * 列表点词：读单词，接着读中文释义（需求 7.1）。释义为空就只读单词。
 * 串行且沿用 speakSequence 的中断规则——被新的朗读打断、或被浏览器自动播放策略拦住，就不再读后面那段。
 */
export async function speakWordAndDef(word: string, def: string | null | undefined, key: VoiceKey) {
  const my = begin();
  const r = await speak("word", word, key, my);
  if (!def || my !== seq || r === "stopped" || r === "blocked") return;
  await speak("definition", def, key, my);
}
/** 停止当前朗读（离开页面、切换卡片） */
export function stopSpeaking() { ++seq; stopAll(); }

/** 预取音频进浏览器缓存（学习卡片正面：本词例句与下一个词），没有文件的会顺便按需合成 */
export async function preloadAudio(words: string[], sentences: string[], key: VoiceKey) {
  const urls = [...(await Promise.all(words.map((w) => urlFor("word", w, key)))), ...(await Promise.all(sentences.map((s) => urlFor("sentence", s, key))))];
  for (const u of urls) {
    if (!u || preloaded.has(u) || isMissing(u)) continue;
    preloaded.add(u);
    // 只有 404（确实没有这段音频）才记缺失；429 / 5xx 是暂时的，下次还要再试
    fetch(u, { credentials: "same-origin" }).then((r) => { if (r.status === 404) markMissing(u); else if (!r.ok) preloaded.delete(u); }).catch(() => preloaded.delete(u));
  }
}

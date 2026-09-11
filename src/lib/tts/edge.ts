/**
 * Edge-TTS 合成引擎：微软 Edge「朗读」接口，Azure 神经音色，免费无 Key，npm 包 msedge-tts。
 * 并发按槽位控制（每个槽位自己的 WebSocket 连接，按音色缓存复用），失败重试 3 次并重建连接。
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

type Slot = { busy: boolean; clients: Map<string, MsEdgeTTS>; gen: Map<string, number> };
const slots: Slot[] = [];
const waiters: Array<(s: Slot) => void> = [];
/** 当前允许的槽位数：ttsConfig 每次调用都会传进来，调小后要能真的缩下去（审计 NO06） */
let maxSlots = 0;
/** 排队上限与等待超时：Edge 不可达时请求会在这里无限堆积（审计 F073） */
const MAX_WAITERS = 50;
const WAIT_TIMEOUT_MS = 15_000;

function closeSlot(s: Slot) {
  for (const c of s.clients.values()) { try { c.close(); } catch { /* 已断开 */ } }
  s.clients.clear();
}

function acquire(max: number): Promise<Slot> {
  maxSlots = Math.max(1, max);
  const free = slots.find((s) => !s.busy);
  if (free) { free.busy = true; return Promise.resolve(free); }
  if (slots.length < maxSlots) { const s: Slot = { busy: true, clients: new Map(), gen: new Map() }; slots.push(s); return Promise.resolve(s); }
  if (waiters.length >= MAX_WAITERS) return Promise.reject(new Error(`合成排队已满（${MAX_WAITERS}），稍后再试`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.indexOf(wrapped);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error(`等待合成槽位超过 ${WAIT_TIMEOUT_MS / 1000} 秒`));
    }, WAIT_TIMEOUT_MS);
    const wrapped = (s: Slot) => { clearTimeout(timer); resolve(s); };
    waiters.push(wrapped);
  });
}

function release(s: Slot) {
  const w = waiters.shift();
  if (w) { w(s); return; }
  s.busy = false;
  // 配置把并发调小了就把多出来的槽位连同连接一起丢掉，不用重启进程（审计 NO06）
  while (slots.length > maxSlots) {
    const idx = slots.findIndex((x) => !x.busy);
    if (idx < 0) break;
    closeSlot(slots[idx]);
    slots.splice(idx, 1);
  }
}

/** SSML 里的特殊字符要转义，否则含 & 或 < 的句子会让服务端拒绝 */
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Edge-TTS ${ms / 1000} 秒超时`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function synthOnce(slot: Slot, text: string, voice: string, rate: string): Promise<Buffer> {
  let client = slot.clients.get(voice);
  if (!client) {
    // 记下建连时的代号：超时被放弃的那次握手完成得比新连接晚时，不能再把自己塞回缓存（审计 F183）
    const gen = slot.gen.get(voice) ?? 0;
    const fresh = new MsEdgeTTS();
    await fresh.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    if ((slot.gen.get(voice) ?? 0) !== gen) { try { fresh.close(); } catch { /* 已断开 */ } throw new Error("连接已被新的重试取代"); }
    client = fresh;
    slot.clients.set(voice, client);
  }
  const { audioStream } = client.toStream(escapeXml(text), { rate });
  const chunks: Buffer[] = [];
  for await (const c of audioStream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * 合成一段文本为 MP3（24kHz 48kbps 单声道）；rate 为 SSML 相对语速，如 "-10%"。
 * fast = 接口里的按需合成：预算收到 2 次 × 8 秒，用户等不了三轮 20 秒超时（审计 F073）。
 */
export async function synthesizeEdge(text: string, voice: string, rate: string, concurrency = 3, fast = false): Promise<Buffer> {
  const attempts = fast ? 2 : 3, perTry = fast ? 8_000 : 20_000;
  const slot = await acquire(Math.max(1, concurrency));
  try {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const buf = await withTimeout(synthOnce(slot, text, voice, rate), perTry);
        if (buf.length > 0) return buf;
        lastErr = new Error("Edge-TTS 返回空音频");
      } catch (e) { lastErr = e; }
      // 连接可能已坏：关掉、作废这一代，下次重建
      try { slot.clients.get(voice)?.close(); } catch { /* 已断开 */ }
      slot.clients.delete(voice);
      slot.gen.set(voice, (slot.gen.get(voice) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally { release(slot); }
}

/** 关闭全部连接（脚本结束时调用，否则进程不退出） */
export function closeEdge() {
  for (const s of slots) closeSlot(s);
}

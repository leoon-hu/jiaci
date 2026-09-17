/**
 * 发音音频访问接口：
 *   GET /api/audio/word/{voice}/{spelling}.mp3   单词（短语空格写成下划线）
 *   GET /api/audio/sent/{voice}/{hash}.mp3       例句（规范化文本的 SHA-1，须已登记在 audio_text）
 *   GET /api/audio/def/{voice}/{hash}.mp3        中文释义（同上，音色是 tts.voice_zh；列表点词时跟在单词后朗读）
 * 文件存在直接返回（一年缓存、ETag、支持 Range，谁都能读——公开词条页 /dict/* 的发音按钮也走这里，音频只按文本对应、不含任何用户信息，
 * 缓存标 public 让 Cloudflare 存）；不存在则**需要登录**、校验后同步合成再返回（匿名访客直接 404，前端退到 Web Speech）；
 * 合成失败返回 404 加 X-Audio-Fallback。按用户限制按需合成次数。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audioDir, ensureClip, ttsConfig, voiceAllowed } from "@/lib/tts";
import { allow, retryAfterMs } from "@/lib/rate-limit";
import { getConfigInt } from "@/lib/config";
import { clipRelPath, parseAudioPath } from "@/lib/tts/text";

export const runtime = "nodejs";

const fallback = (status = 404, extra: Record<string, string> = {}) => new Response(null, { status, headers: { "X-Audio-Fallback": "webspeech", "Cache-Control": "no-store", ...extra } });
/** 限速 429 带 Retry-After（秒）：跑步模式准备时按它等，不用每 5 秒盲目重试 */
const tooMany = (ms: number) => fallback(429, { "Retry-After": String(Math.max(1, Math.ceil(ms / 1000))) });

/** 音频目录所在分区的剩余空间是否还够（statfs 拿不到就放行，不因为探测失败而停掉功能） */
async function hasFreeSpace(minMb: number): Promise<boolean> {
  try {
    const st = await fs.statfs(audioDir());
    return (st.bavail * st.bsize) / (1024 * 1024) >= minMb;
  } catch { return true; }
}

const toBody = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

/**
 * 有 nginx 时把文件发送交给它（性能优化 P1-8）：鉴权与「该不该给」仍在这里判断，通过之后回一个
 * X-Accel-Redirect 指向 internal 的 /_audio/，由 nginx 零拷贝发送，Range 与 304 也由它处理——
 * 否则每段音频都要整个读进 Node 的堆（服务器上 Node 只有 256 MB）。
 * 环境变量 AUDIO_ACCEL 就是 nginx 里那个 internal location 的前缀；本机开发不设，走下面的自己读文件。
 * Cache-Control 由 nginx 的 location 加，这里不重复设，免得出现两个同名响应头。
 */
const accelRedirect = (prefix: string, relPath: string) =>
  new Response(null, {
    headers: {
      "X-Accel-Redirect": `${prefix.replace(/\/+$/, "")}/${relPath.split("/").map(encodeURIComponent).join("/")}`,
      "Content-Type": "audio/mpeg",
    },
  });

async function serve(req: Request, abs: string, size: number, mtimeMs: number): Promise<Response> {
  const etag = `"${size}-${Math.floor(mtimeMs)}"`;
  const base: Record<string, string> = { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "Accept-Ranges": "bytes" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
  const buf = await fs.readFile(abs);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const part = buf.subarray(start, end + 1);
    return new Response(toBody(part), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(part.length) } });
  }
  return new Response(toBody(buf), { headers: { ...base, "Content-Length": String(size) } });
}

export const GET = handle(async (req, { params }: { params: Promise<{ path: string[] }> }) => {
  const parsed = parseAudioPath((await params).path ?? []);
  if (!parsed) return fallback();
  const cfg = await ttsConfig();
  if (!voiceAllowed(cfg, parsed.voice, parsed.kind)) return fallback();
  let text: string;
  if (parsed.kind === "word") {
    // 单词必须在词表或词典里，防止被当成任意文本的免费 TTS
    const known = (await prisma.word.findUnique({ where: { spelling: parsed.name }, select: { id: true } }))
      ?? (await prisma.dictEntry.findFirst({ where: { spelling: parsed.name }, select: { word: true } }));
    if (!known) return fallback();
    text = parsed.name;
  } else {
    // 例句与中文释义都只放行已登记在 audio_text 的文本，同样是防止接口被当成任意文本的免费 TTS
    const row = await prisma.audioText.findUnique({ where: { textHash: parsed.name } });
    if (!row || row.kind !== parsed.kind) return fallback();
    text = row.text;
  }
  const rel = clipRelPath(parsed.kind, parsed.voice, text);
  const abs = path.join(audioDir(), rel);
  let st = await fs.stat(abs).catch(() => null);
  if (!st || st.size === 0) {
    // 按需合成只给登录用户：匿名访客（公开词条页）拿不到现成文件就退到 Web Speech，接口不能被当成免费 TTS
    const user = await getCurrentUser();
    if (!user) return fallback();
    // 按需合成限速按登录用户计（不按 X-Forwarded-For：nginx 把客户端自带的值放在最前，换个假 IP 就能绕过；
    // 按用户计更准，NAT 后的用户也不会被邻居连累，审计 F012）：每分钟 tts.synth_per_minute 段——
    // 跑步模式准备一轮要现合成几百段例句译文，这个数别设太小，合成本身另有并发闸门；
    // 每人每天 tts.daily_synth_per_user 段：整张词典 × 4 音色远大于磁盘，光靠每分钟限速拦不住（审计 NO01）
    const perMinute = await getConfigInt("tts.synth_per_minute"), perDay = await getConfigInt("tts.daily_synth_per_user");
    const minKey = `synth-min:${user.id}`, dayKey = `synth-day:${user.id}`;
    if (!allow(minKey, perMinute, 60_000)) return tooMany(retryAfterMs(minKey, perMinute, 60_000));
    if (!allow(dayKey, perDay, 86_400_000)) return tooMany(retryAfterMs(dayKey, perDay, 86_400_000));
    // 磁盘余量守卫：音频目录与 Postgres 同盘，写满会让数据库先崩
    if (!(await hasFreeSpace(await getConfigInt("tts.min_free_mb")))) {
      console.warn("[audio] 磁盘剩余空间不足，暂停按需合成");
      return fallback(507);
    }
    try { await ensureClip(cfg, parsed.kind, text, parsed.voice, undefined, true); } catch (e) { console.warn(`[audio] 合成失败 ${parsed.kind} ${parsed.voice} ${text.slice(0, 40)}：${(e as Error).message}`); return fallback(); }
    st = await fs.stat(abs);
  }
  const accel = process.env.AUDIO_ACCEL?.trim();
  return accel ? accelRedirect(accel, rel) : serve(req, abs, st.size, st.mtimeMs);
});

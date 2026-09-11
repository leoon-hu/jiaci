/**
 * 发音音频子系统：读 tts.* 配置、选择引擎、把文本合成到 AUDIO_DIR 并记 audio_text / audio_clip。
 * 只在服务端用（接口按需合成、运营脚本批量生成）；文本规则在 ./text.ts，浏览器也用。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { getConfig, getConfigInt } from "../config";
import { prisma as defaultPrisma } from "../db";
import { synthesizeEdge } from "./edge";
import { synthesizeKokoro } from "./kokoro";
import { VOICE_KEYS, clipRelPath, isVoiceKey, normalizeText, textHash, type AudioKind, type VoiceKey } from "./text";

export type TtsProviderName = "edge" | "kokoro";
export type TtsConfig = {
  provider: TtsProviderName;
  /** 逻辑声音键 → 当前引擎的实际音色名 */
  voices: Record<VoiceKey, string>;
  /** 中文音色：列表点词时朗读中文释义用，与四种英文音色分开 */
  defVoice: string;
  wordRate: string; sentenceRate: string; defRate: string; concurrency: number;
  /** 批量预生成例句用的声音；单词四种都生成 */
  batchVoices: VoiceKey[];
};

export async function ttsConfig(): Promise<TtsConfig> {
  const provider: TtsProviderName = (await getConfig("tts.provider")) === "kokoro" ? "kokoro" : "edge";
  const voices = {} as Record<VoiceKey, string>;
  for (const k of VOICE_KEYS) voices[k] = await getConfig(provider === "kokoro" ? `tts.kokoro_voice_${k}` : `tts.voice_${k}`);
  const batch = (await getConfig("tts.batch_voices")).split(",").map((s) => s.trim()).filter(isVoiceKey);
  return {
    provider, voices,
    defVoice: await getConfig(provider === "kokoro" ? "tts.kokoro_voice_zh" : "tts.voice_zh"),
    wordRate: await getConfig("tts.word_rate"), sentenceRate: await getConfig("tts.sentence_rate"), defRate: await getConfig("tts.def_rate"),
    concurrency: Math.max(1, await getConfigInt("tts.concurrency")), batchVoices: batch.length ? batch : ["us_female"],
  };
}

/** 音频根目录：环境变量 AUDIO_DIR，默认项目下 storage/audio（已 gitignore） */
let warnedAudioDir = false;
export const audioDir = () => {
  const dir = process.env.AUDIO_DIR;
  // 生产环境没配就会落在应用目录里，下次 rsync --delete 发布会把音频全删掉（审计 F131）
  if (!dir && process.env.NODE_ENV === "production" && !warnedAudioDir) {
    warnedAudioDir = true;
    console.warn("[tts] 未设置 AUDIO_DIR，音频会写在应用目录内，下次部署同步时会被删除；请在 .env 里指定独立目录");
  }
  return path.resolve(dir || "storage/audio");
};
/**
 * 音色名是否允许用在这种文本上（接口白名单）：单词与例句只认配置的四种英文音色，中文释义只认中文音色。
 * 分开判断，免得用中文音色去请求英文单词（或反过来）合成出一份多余的重复文件。
 */
export const voiceAllowed = (cfg: TtsConfig, voice: string, kind: AudioKind = "word") =>
  kind === "definition" ? voice === cfg.defVoice : (Object.values(cfg.voices) as string[]).includes(voice);

/** 简单的并发闸门：Kokoro 是自托管服务，也要受 tts.concurrency 限制，不能被接口路径直接打穿（审计 F078） */
let running = 0;
const queue: Array<() => void> = [];
async function withLimit<T>(max: number, fn: () => Promise<T>): Promise<T> {
  if (running >= max) await new Promise<void>((r) => queue.push(r));
  running++;
  try { return await fn(); } finally { running--; const next = queue.shift(); if (next) next(); }
}

export async function synthesize(cfg: TtsConfig, kind: AudioKind, text: string, voice: string, fast = false): Promise<Buffer> {
  const rate = kind === "word" ? cfg.wordRate : kind === "definition" ? cfg.defRate : cfg.sentenceRate;
  if (cfg.provider === "kokoro") return withLimit(cfg.concurrency, () => synthesizeKokoro(text, voice, rate));
  return synthesizeEdge(text, voice, rate, cfg.concurrency, fast);
}

export type ClipResult = { relPath: string; absPath: string; bytes: number; created: boolean };
const inflight = new Map<string, Promise<ClipResult>>();

/**
 * 保证「文本 × 音色」的音频文件存在：有文件直接返回；没有就合成、先写临时文件再改名、登记 audio_text 并记 audio_clip。
 * 同一路径并发只合成一次；失败时 audio_clip 记 failed 与原因并抛错。
 */
export async function ensureClip(cfg: TtsConfig, kind: AudioKind, rawText: string, voice: string, db: PrismaClient = defaultPrisma, fast = false): Promise<ClipResult> {
  const text = normalizeText(rawText);
  const relPath = clipRelPath(kind, voice, text);
  const absPath = path.join(audioDir(), relPath);
  const st = await fs.stat(absPath).catch(() => null);
  if (st && st.size > 0) {
    // 文件在但表里没有登记（例如音频是 rsync 过来的）时补一条，否则 stats 会一直报不一致（审计 F077）
    const hash = textHash(text);
    const known = await db.audioClip.findUnique({ where: { textHash_voice: { textHash: hash, voice } }, select: { status: true } });
    if (!known || known.status !== "ok") {
      await db.audioText.upsert({ where: { textHash: hash }, create: { textHash: hash, kind, text }, update: {} });
      await db.audioClip.upsert({
        where: { textHash_voice: { textHash: hash, voice } },
        create: { textHash: hash, voice, provider: cfg.provider, path: relPath, bytes: st.size, status: "ok", error: null },
        update: { provider: cfg.provider, path: relPath, bytes: st.size, status: "ok", error: null },
      }).catch(() => {});
    }
    return { relPath, absPath, bytes: st.size, created: false };
  }
  const running = inflight.get(relPath);
  if (running) return running;
  const job = (async () => {
    const hash = textHash(text);
    await db.audioText.upsert({ where: { textHash: hash }, create: { textHash: hash, kind, text }, update: {} });
    try {
      const buf = await synthesize(cfg, kind, text, voice, fast);
      if (buf.length < 100) throw new Error("合成结果为空");
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tmp, buf);
        await fs.rename(tmp, absPath);
      } catch (e) {
        // 写一半失败 / 改名失败时清掉半成品，不然它会永远留在 AUDIO_DIR 里，stats 与 prune 都看不见（审计 NO05）
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      const row = { provider: cfg.provider, path: relPath, bytes: buf.length, status: "ok" as const, error: null };
      await db.audioClip.upsert({ where: { textHash_voice: { textHash: hash, voice } }, create: { textHash: hash, voice, ...row }, update: row });
      return { relPath, absPath, bytes: buf.length, created: true };
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      await db.audioClip.upsert({
        where: { textHash_voice: { textHash: hash, voice } },
        create: { textHash: hash, voice, provider: cfg.provider, path: relPath, bytes: 0, status: "failed", error },
        update: { status: "failed", error },
      }).catch(() => {});
      throw e;
    }
  })().finally(() => inflight.delete(relPath));
  inflight.set(relPath, job);
  return job;
}

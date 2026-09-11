/**
 * 批量生成用的公共逻辑（运营脚本 ai:fill / audio:generate 共用）：一词要朗读的文本、登记 audio_text、按并发生成。
 */
import type { PrismaClient } from "@prisma/client";
import { AiExamplesSchema, parseAi } from "../ai/schema";
import { wordCore } from "../word-view";
import { ensureClip, type TtsConfig } from "./index";
import { VOICE_KEYS, normalizeText, textHash, type AudioKind, type VoiceKey } from "./text";

export type AudioTarget = { kind: AudioKind; text: string };
export type AudioJob = AudioTarget & { voice: string };

/**
 * 一词要朗读的文本：拼写 + 各厂商行的例句（examples[].en）+ 中文释义，各自去重。
 * 释义按 wordCore 的口径取，与列表行显示的 def 完全一致：各厂商的 core 都生成一份（用户可以切「词条资料来源」，
 * 挑中哪家就播哪家的），一家都没有时才用词典 translation 的第一段兜底。
 */
export function targetsOfWord(
  spelling: string,
  aiRows: Array<{ examples?: unknown; core?: string | null } | null | undefined>,
  dict?: { translation?: string | null } | null,
): AudioTarget[] {
  const out: AudioTarget[] = [{ kind: "word", text: normalizeText(spelling) }];
  const seen = new Set<string>();
  const defs = new Set<string>();
  for (const r of aiRows) {
    for (const e of parseAi(AiExamplesSchema, r?.examples) ?? []) {
      const t = normalizeText(e.en);
      if (t && !seen.has(t)) { seen.add(t); out.push({ kind: "sentence", text: t }); }
    }
    const core = normalizeText(r?.core ?? "");
    if (core && !defs.has(core)) { defs.add(core); out.push({ kind: "definition", text: core }); }
  }
  if (!defs.size) {
    const fallback = normalizeText(wordCore({ translation: dict?.translation ?? null }).def ?? "");
    if (fallback) out.push({ kind: "definition", text: fallback });
  }
  return out;
}

/** 登记到 audio_text（已有的跳过）：只有登记过的例句才允许按需合成 */
export async function registerTexts(db: PrismaClient, targets: AudioTarget[]) {
  if (!targets.length) return;
  await db.audioText.createMany({ data: targets.map((t) => ({ textHash: textHash(t.text), kind: t.kind, text: t.text })), skipDuplicates: true });
}

/** 文本 → 要生成的音色：单词四种都生成，例句只生成 batchVoices（或指定的 only），中文释义只有中文音色一种 */
export function jobsOf(cfg: TtsConfig, targets: AudioTarget[], only?: VoiceKey[]): AudioJob[] {
  const jobs: AudioJob[] = [];
  for (const t of targets) {
    if (t.kind === "definition") { jobs.push({ ...t, voice: cfg.defVoice }); continue; }
    const keys = t.kind === "word" ? [...VOICE_KEYS] : (only ?? cfg.batchVoices);
    for (const k of keys) jobs.push({ ...t, voice: cfg.voices[k] });
  }
  return jobs;
}

export type GenStats = { done: number; created: number; skipped: number; failed: number; bytes: number; errors: string[] };

/** 生成一批音频（已有文件的跳过），并发 concurrency；onEach 用于打印进度 */
export async function generateClips(cfg: TtsConfig, jobs: AudioJob[], db: PrismaClient, concurrency = cfg.concurrency, onEach?: (j: AudioJob, r: { created: boolean; bytes: number } | Error) => void): Promise<GenStats> {
  const st: GenStats = { done: 0, created: 0, skipped: 0, failed: 0, bytes: 0, errors: [] };
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      try {
        const r = await ensureClip(cfg, j.kind, j.text, j.voice, db);
        st.done++; if (r.created) { st.created++; st.bytes += r.bytes; } else st.skipped++;
        onEach?.(j, r);
      } catch (e) {
        st.failed++; st.errors.push(`${j.voice} ${j.kind === "word" ? j.text : j.text.slice(0, 40)}：${(e as Error).message}`);
        onEach?.(j, e as Error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return st;
}

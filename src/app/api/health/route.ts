/**
 * 健康检查（审计 NO02）：给外部拨测用。
 * /login 是纯客户端页面，数据库挂了照样返回 200；这里真的碰一次数据库与音频目录，任一不通返回 503。
 */
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { audioDir } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} 超时`)), ms))]);

export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;
  try { await withTimeout(prisma.$queryRaw`SELECT 1`, 3000, "数据库"); checks.db = "ok"; }
  catch (e) { ok = false; checks.db = (e as Error).message.slice(0, 120); }
  try { await withTimeout(fs.access(audioDir()), 2000, "音频目录"); checks.audio = "ok"; }
  catch (e) { ok = false; checks.audio = (e as Error).message.slice(0, 120); }
  return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

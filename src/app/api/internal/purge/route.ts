/**
 * 内部清理接口（审计 F163）：给服务器上的 cron 调用，执行注销 30 天物理删除与过期会话 / 验证码清理。
 * 用 PURGE_TOKEN 鉴权（服务器 .env 里配），没配就一律 404，避免误开放。
 * 部署产物里没有运营脚本，所以线上只能走这个入口。
 */
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { purgeExpired } from "@/lib/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

function tokenOk(req: Request, expected: string): boolean {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req: Request) {
  const expected = process.env.PURGE_TOKEN;
  if (!expected) return deny(404);           // 没配 token 就当这个接口不存在
  if (!tokenOk(req, expected)) return deny(401);
  const r = await purgeExpired(prisma);
  console.log(`[purge] 注销账号 ${r.users}，过期会话 ${r.sessions}，过期验证码 ${r.otps}`);
  return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}

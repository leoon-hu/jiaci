import { z } from "zod";
import { handle, ok, readJson, fail, ApiError } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";
import { getAuthMode, getPrivateUserEmailForKey } from "@/lib/auth-mode";

export const runtime = "nodejs";
export const POST = handle(async (req) => {
  if (getAuthMode() !== "api_key") return fail(404, "接口不可用", "not_found");

  // Single-process protection. For public deployments, add reverse-proxy
  // rate limiting and do not expose Next.js directly to the Internet.
  const ip = clientIp(req);
  if (!allow(`api-key-login:${ip}`, 5, 60_000)) {
    throw new ApiError(429, "登录过于频繁，请稍后重试", "rate_limited");
  }
  const { apiKey } = z.object({
    apiKey: z.string().min(1).max(256),
  }).parse(await readJson(req));

  // Always validate the configured secret on the server. Never expose it via
  // NEXT_PUBLIC_* or /api/config/public.
  const email = getPrivateUserEmailForKey(apiKey);
  if (!email) {
    throw new ApiError(401, "登录密钥不正确", "invalid_credentials");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    throw new ApiError(503, "私有账号未创建或不可用，请检查服务端初始化", "not_initialized");
  }
  await createSession(user.id);
  return ok({ loggedIn: true });
});

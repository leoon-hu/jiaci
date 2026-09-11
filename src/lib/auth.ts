import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { primeSettings } from "./settings";
import { getConfig, getConfigInt } from "./config";
import { sendOtpMail } from "./mail";
import { allow, isOver } from "./rate-limit";

/**
 * 邮箱验证码登录 + 长效会话（需求 3.1）
 * - 验证码 6 位数字，有效期 / 每日上限 / 重发间隔 / 错误次数均读配置
 * - 会话 id 随机 32 字节，存 session 表；Cookie HttpOnly，90 天，活跃自动续期
 */
export const SESSION_COOKIE = "aiword_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // 生产环境漏配不能静默用公开的默认值：验证码哈希与会话都靠它（审计 F005）
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET 未配置：生产环境必须在 .env 里设置");
  return "dev-secret";
}
function hashCode(email: string, code: string) {
  return createHash("sha256").update(`${secret()}:${email}:${code}`).digest("hex");
}
/**
 * 会话表的主键是 Cookie 里那串随机值的 SHA-256：库里不存可直接使用的凭证，库被拖走或备份外泄也冒用不了会话。
 * 随机值本身有 256 位熵，不需要再加盐 / 密钥，这样已有会话也能用一条 SQL 原地换成哈希（迁移 session_id_hash）
 */
const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");
export function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}
export function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** 已注销的账号在发码前就挡住，别让用户白等一封邮件、白填一次验证码（审计 F165） */
async function assertNotDeleted(email: string) {
  const u = await prisma.user.findUnique({ where: { email }, select: { deletedAt: true } });
  if (u?.deletedAt) throw new AuthError("deleted", "该账号已注销，30 天内无法用同一邮箱登录");
}

/** 同一 IP 的发码上限：10 分钟 5 次、1 小时 20 次（审计 F002）。每档一个计数桶，别共用一个 key */
const IP_LIMITS: Array<{ tag: string; limit: number; windowMs: number; note: string }> = [
  { tag: "10m", limit: 5, windowMs: 10 * 60_000, note: "10 分钟" },
  { tag: "1h", limit: 20, windowMs: 3600_000, note: "1 小时" },
];

export async function requestOtp(rawEmail: string, ip?: string): Promise<{ devCode?: string; resendSeconds: number }> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new AuthError("invalid_email", "请输入正确的邮箱地址");
  await assertNotDeleted(email);
  // 原来只按邮箱限速：换一个邮箱就能接着发，可以拿它刷别人的邮箱、刷 Resend 配额（审计 F002）
  if (ip) for (const t of IP_LIMITS) {
    if (isOver(`otp:${ip}:${t.tag}`, t.limit, t.windowMs)) throw new AuthError("too_many_requests", `发送太频繁，请稍后再试（同一网络 ${t.note}内最多 ${t.limit} 次）`, 429);
  }
  const [resendSeconds, dailyLimit, expireMinutes] = await Promise.all([
    getConfigInt("otp.resend_seconds"), getConfigInt("otp.daily_limit"), getConfigInt("otp.expire_minutes"),
  ]);
  const now = new Date();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  // 检查与写入放进一个事务并按邮箱加咨询锁：先查后写的写法能被并发绕过，一次就能发出几十封（审计 F002）
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email}))`;
    const last = await tx.otpCode.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
    if (last && now.getTime() - last.createdAt.getTime() < resendSeconds * 1000) {
      const wait = Math.ceil((resendSeconds * 1000 - (now.getTime() - last.createdAt.getTime())) / 1000);
      throw new AuthError("too_soon", `发送太频繁，请 ${wait} 秒后再试`, 429);
    }
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const todayCount = await tx.otpCode.count({ where: { email, createdAt: { gte: dayStart } } });
    if (todayCount >= dailyLimit) throw new AuthError("daily_limit", `今天发送次数已达上限（${dailyLimit} 次），请明天再试`, 429);
    // 作废该邮箱之前未使用的验证码
    await tx.otpCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: now } });
    await tx.otpCode.create({ data: { email, codeHash: hashCode(email, code), expiresAt: new Date(now.getTime() + expireMinutes * 60_000) } });
  });
  // 通过了才记 IP 计数，被 too_soon / daily_limit 挡住的不占额度
  if (ip) for (const t of IP_LIMITS) allow(`otp:${ip}:${t.tag}`, t.limit, t.windowMs);
  const mail = await sendOtpMail(email, code);
  return { devCode: mail.devCode, resendSeconds };
}

export async function verifyOtp(rawEmail: string, code: string): Promise<{ userId: string; isNew: boolean }> {
  const email = normalizeEmail(rawEmail);
  await assertNotDeleted(email);
  const maxAttempts = await getConfigInt("otp.max_attempts");
  const otp = await prisma.otpCode.findFirst({ where: { email, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!otp) throw new AuthError("no_code", "验证码不存在或已作废，请重新发送");
  if (otp.expiresAt < new Date()) throw new AuthError("expired", "验证码已过期，请重新发送");
  // 先原子占用一次尝试再比对：读到旧 attempts 再判上限的写法能被并发猜测绕过（审计 F173）
  const taken = await prisma.otpCode.updateMany({ where: { id: otp.id, usedAt: null, attempts: { lt: maxAttempts } }, data: { attempts: { increment: 1 } } });
  if (taken.count === 0) throw new AuthError("too_many", "错误次数过多，该验证码已作废，请重新发送");
  const ok = timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hashCode(email, code.trim())));
  if (!ok) {
    const cur = await prisma.otpCode.findUnique({ where: { id: otp.id }, select: { attempts: true } });
    const left = Math.max(0, maxAttempts - (cur?.attempts ?? maxAttempts));
    if (left <= 0) throw new AuthError("too_many", "错误次数过多，该验证码已作废，请重新发送");
    throw new AuthError("wrong_code", `验证码错误，还可尝试 ${left} 次`);
  }
  // 一码一用：只有把 used_at 从 null 改过来的那个请求继续建会话
  const used = await prisma.otpCode.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count === 0) throw new AuthError("no_code", "验证码已被使用，请重新发送");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.deletedAt) throw new AuthError("deleted", "该账号已注销，30 天内无法用同一邮箱登录");
  // 首次注册即记录同意的条款版本与时间：登录按钮写的是「同意并登录」，这里留下凭据（审计 F171）
  const user = existing ?? (await prisma.user.create({ data: { email, termsVersion: await getConfig("legal.version"), termsAcceptedAt: new Date() } }));
  return { userId: user.id, isNew: !existing };
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  // Secure 只在 HTTPS 下标：没有域名时是 http 直连 IP，标了 Secure 浏览器根本不会带上 cookie；上 HTTPS 后 nginx 传 X-Forwarded-Proto=https 自动变 Secure
  const proto = ((await headers()).get("x-forwarded-proto") ?? "").split(",")[0].trim();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: proto === "https", path: "/", expires: expiresAt });
}

export async function createSession(userId: string) {
  const days = await getConfigInt("session.days");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await prisma.session.create({ data: { id: sessionKey(token), userId, expiresAt } });
  await setSessionCookie(token, expiresAt);
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sessionKey(token) } });
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
}

export type CurrentUser = { id: string; email: string; settings: Record<string, unknown>; termsVersion: string | null };

/**
 * 读取当前登录用户；活跃时自动续期（每天最多写一次）。
 * 用 React 的 cache() 包住：同一个请求里 layout、API 处理器可能各调一次，
 * 没有它就是每次都查一遍 session（还会重复跑续期与写 Cookie 的副作用）。
 * cache() 在请求作用域外（脚本、测试）会直接透传调用，不会报错。
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sessionKey(token);
  const s = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || s.user.deletedAt) return null;
  let expiresAt = s.expiresAt;
  if (Date.now() - s.lastSeen.getTime() > 86_400_000) {
    const days = await getConfigInt("session.days");
    expiresAt = new Date(Date.now() + days * 86_400_000);
    // 条件更新：会话可能已被另一端登出删除，update 会抛 P2025 变成 500（审计 F182）
    await prisma.session.updateMany({ where: { id }, data: { lastSeen: new Date(), expiresAt } });
  }
  // 数据库续期不会延长浏览器里 Cookie 的 Expires，否则活跃用户满 90 天照样被登出（审计 NU01）。
  // Server Component 里不允许写 Cookie（会抛错），只有 API 路由 / Server Action 能刷新，忽略失败即可。
  try { await setSessionCookie(token, expiresAt); } catch { /* Server Component 上下文，跳过 */ }
  const settings = (s.user.settings as Record<string, unknown>) ?? {};
  // user 整行已经取回来了，把设置存进请求级缓存：后面 getSettings 就不必再查一次库
  primeSettings(s.user.id, settings);
  return { id: s.user.id, email: s.user.email, settings, termsVersion: s.user.termsVersion };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("unauthorized", "请先登录", 401);
  return u;
}

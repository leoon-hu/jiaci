import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, requireUser, type CurrentUser } from "./auth";

/** Route Handler 通用封装：统一 JSON、错误码；业务错误用 ApiError 抛出 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

/** 接口响应一律不缓存：登录后的 JSON 里都是个人数据，不该被浏览器或中间缓存留存（审计 NA02） */
function noStore(res: NextResponse) {
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return noStore(NextResponse.json(data, init));
}

export function fail(status: number, message: string, code = "error") {
  return noStore(NextResponse.json({ error: { code, message } }, { status }));
}

/** 路径参数已由框架解码一次，这里只做容错的二次解码：畸形百分号编码不能变成 500（审计 F020） */
export function safeDecode(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof AuthError) return fail(e.status, e.message, e.code);
      if (e instanceof ApiError) return fail(e.status, e.message, e.code);
      if (e instanceof ZodError) return fail(400, "参数不正确：" + e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；"), "invalid");
      console.error("[api]", e);
      return fail(500, "服务器开小差了，请稍后重试", "internal");
    }
  };
}

/** 需要登录的处理器 */
export function withUser<C>(fn: (req: Request, ctx: C, user: CurrentUser) => Promise<Response>): Handler<C> {
  return handle(async (req, ctx) => fn(req, ctx, await requireUser()));
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  // 只接受 application/json：简单请求（text/plain 等）不触发预检，是跨站伪造请求的入口（审计 F008）
  if (!/^application\/json\b/i.test((req.headers.get("content-type") ?? "").trim())) {
    throw new ApiError(415, "请求体必须是 application/json", "invalid");
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "请求体不是合法的 JSON", "invalid");
  }
}

export type Params<T extends Record<string, string>> = { params: Promise<T> };

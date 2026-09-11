"use client";
/** 浏览器端 fetch 封装：统一 JSON、错误提示、401 跳登录 */
export class ClientApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
  }
  const text = await res.text();
  // 反向代理的 502 / 504 / 413 返回的是 HTML，直接 JSON.parse 会把 SyntaxError 原样弹给用户（审计 F064）
  let data: { error?: { message?: string; code?: string } } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch {
    if (res.ok) throw new ClientApiError(res.status, "服务器返回了无法识别的内容，请稍后重试", "bad_response");
  }
  if (!res.ok) throw new ClientApiError(res.status, data?.error?.message ?? (res.status >= 500 ? "服务器开小差了，请稍后重试" : `请求失败（${res.status}）`), data?.error?.code);
  return data as T;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

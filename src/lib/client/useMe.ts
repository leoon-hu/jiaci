"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useUser } from "@/components/UserContext";
import type { UserSettings } from "@/lib/settings";

export type Me = { id: string; email: string; settings: UserSettings; currentWordbookId: string | null; termsOutdated?: boolean };

const DEFAULTS: UserSettings = { newWords: 20, reviewLimit: 200, order: "review-first", newOrder: "book", accent: "us", voice: "female", exSpeaker: "right", autoPlay: true, autoReadDetail: true, theme: "system", listMode: "both", aiProvider: "auto" };

/**
 * 模块级缓存：只在同一个页面生命周期内有效。退出 / 注销 / 换账号登录都是客户端路由跳转、页面不刷新，
 * 所以缓存必须和服务端 layout 校验出的当前用户（UserContext）比对，用户 id 不一致就作废重取；
 * 登录、退出、注销时再额外调用 resetMeCache() 清空。
 */
let cached: Me | null = null;

export function resetMeCache() { cached = null; }

export function applyTheme(t: UserSettings["theme"]) {
  const r = document.documentElement;
  if (t === "light" || t === "dark") r.setAttribute("data-theme", t); else r.removeAttribute("data-theme");
  try { localStorage.setItem("aiword.theme", t); } catch { /* ignore */ }
}

/** 缓存属于当前登录用户时才可用；UserContext 不可用（在 (app) 之外）时不校验 */
function cacheFor(userId: string | undefined): Me | null {
  if (!cached) return null;
  if (userId && cached.id !== userId) { cached = null; return null; }
  return cached;
}

/**
 * 当前用户与设置。(app) 的 layout 已经在服务端把这些一并下发到 UserContext，
 * 所以正常情况下不再请求 /api/me（性能优化 P1-1）；保存设置后以模块级缓存里的新值为准。
 */
export function useMe() {
  const shell = useUser();
  const fromShell: Me | null = shell ? { id: shell.id, email: shell.email, settings: shell.settings, currentWordbookId: shell.currentWordbookId, termsOutdated: shell.termsOutdated } : null;
  const initial = cacheFor(shell?.id) ?? fromShell;
  const [me, setMe] = useState<Me | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hit = cacheFor(shell?.id) ?? fromShell;
    if (hit) { cached = hit; setMe(hit); setLoading(false); applyTheme(hit.settings.theme); return; }
    // 兜底：(app) 之外的页面没有 UserContext，仍旧问一次接口。
    // 取不到当前用户时要让页面知道（否则设置页会把默认值当成用户设置显示、还能存回去）（审计 F069）
    setMe(null); setLoading(true); setFailed(false);
    api<Me>("/api/me").then((m) => { cached = m; setMe(m); applyTheme(m.settings.theme); }).catch(() => setFailed(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.id, shell?.settings, shell?.currentWordbookId, shell?.termsOutdated]);
  const update = useCallback(async (patch: Partial<UserSettings>) => {
    const s = await api<UserSettings>("/api/settings", { method: "PUT", json: patch });
    // 缓存为空时不能把 me 置成 null：那会让界面退回默认设置，而不是服务器刚保存的值（审计 F049）
    setMe((prev) => { const next = cached ? { ...cached, settings: s } : prev ? { ...prev, settings: s } : prev; cached = next; return next; });
    applyTheme(s.theme);
    return s;
  }, []);
  return { me, settings: me?.settings ?? DEFAULTS, loading, failed, update, refresh: async () => { cached = await api<Me>("/api/me"); setMe(cached); } };
}

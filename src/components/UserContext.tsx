"use client";
import { createContext, useContext } from "react";
import type { UserSettings } from "@/lib/settings";

/**
 * 主框架已经在服务端校验过会话，顺带把 /api/me 的内容一并下发（性能优化 P1-1）：
 * 设置、当前词库、条款版本都在会话那次查询里就拿到了，客户端不必再单独请求一次。
 */
export type ShellUser = { id: string; email: string; settings: UserSettings; currentWordbookId: string | null; termsOutdated: boolean };
const Ctx = createContext<ShellUser | null>(null);

export function UserProvider({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export const useUser = () => useContext(Ctx);

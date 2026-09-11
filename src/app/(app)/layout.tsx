import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getCurrentWordbookId } from "@/lib/study";
import { getConfig } from "@/lib/config";
import { UserProvider } from "@/components/UserContext";

/**
 * 登录后的主框架：服务端校验会话，未登录跳登录页。
 * `detail` 是单词详情浮层的平行插槽（`@detail`）：站内点词时拦截路由把详情渲染在这里，
 * children 保持原来那一页不动，返回就是关掉浮层（需求 3.2.5）。
 */
export default async function AppLayout({ children, detail }: { children: React.ReactNode; detail: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // 会话过期但 Cookie 还在时是走到这里的，带上原路径，登录后能回到深链接（审计 NU09）
    const path = (await headers()).get("x-pathname");
    redirect(path && path.startsWith("/") ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }
  // 设置来自会话那次查询（getSettings 走请求级缓存，不再查库），当前词库与条款版本各一次轻查询；
  // 有了它们客户端就不用再打 /api/me（性能优化 P1-1）
  const [settings, currentWordbookId, version] = await Promise.all([
    getSettings(user.id), getCurrentWordbookId(user.id), getConfig("legal.version"),
  ]);
  return (
    <UserProvider user={{ id: user.id, email: user.email, settings, currentWordbookId, termsOutdated: user.termsVersion !== version }}>
      {children}
      {detail}
    </UserProvider>
  );
}

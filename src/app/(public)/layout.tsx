import PublicShell from "@/components/public/PublicShell";

/**
 * 公开页外壳（/dict/*）：匿名可看，不校验会话、不挂 UserProvider，页面里也不碰 cookies / headers，
 * 所以这些页面能走 ISR。
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

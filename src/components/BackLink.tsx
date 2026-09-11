"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { canGoBack } from "@/lib/client/nav";

/**
 * 「返回」链接：站内跳进来的回到来处（history.back，保留原页面的筛选与滚动位置），
 * 直接打开链接或刷新后进来的退到 href 指定的兜底页面。href 保留，右键 / 中键打开照常可用。
 */
export default function BackLink({ href, className = "back", children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return <Link className={className} href={href} onClick={(e) => { if (canGoBack()) { e.preventDefault(); router.back(); } }}>{children}</Link>;
}

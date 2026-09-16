import type { Metadata } from "next";
import { Suspense } from "react";

/** 带 next 参数的登录地址（/login?next=/word/…）都是同一页，canonical 指回 /login，搜索引擎不把它们当成一堆重复网页 */
export const metadata: Metadata = { title: "登录", alternates: { canonical: "/login" } };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}

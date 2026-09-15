"use client";
import Link from "next/link";
import Logo from "./Logo";
import TermsNotice from "./TermsNotice";
import RunPill from "./RunPill";
import { IconBooks, IconSettings, IconStudy } from "./Icons";
import { useUser } from "./UserContext";

const NAV = [
  { key: "study", label: "学习", href: "/home", Icon: IconStudy },
  { key: "books", label: "词库", href: "/wordbooks", Icon: IconBooks },
  { key: "settings", label: "设置", href: "/settings", Icon: IconSettings },
] as const;

export type NavKey = (typeof NAV)[number]["key"];

/** 主框架：桌面顶部导航 / 手机底部 Tab（需求 4.1）；tabbar=false 的子页面（详情、学习）不显示底部 Tab */
export default function AppShell({ nav, tabbar = true, children }: { nav: NavKey; tabbar?: boolean; children: React.ReactNode }) {
  const user = useUser();
  const email = user?.email;
  // prefetch={false}：三个导航链接一直在视口里，生产环境下每进一个页面就会预取三份 RSC
  // （线上日志里占了 10% 的请求）。而这些页面的数据都在客户端取，预取回来的 RSC 里没有业务数据，
  // 白白让服务端多跑三次 middleware + 会话查询。等首屏数据改成服务端直出后再打开才有意义
  const links = NAV.map(({ key, label, href, Icon }) => (
    <Link key={key} href={href} prefetch={false} className={key === nav ? "active" : undefined}><Icon /><span>{label}</span></Link>
  ));
  return (
    <>
      <header className="app-header">
        <div className="inner">
          <Link className="brand" href="/home"><Logo size={28} />AI加词</Link>
          <nav className="app-nav">{links}</nav>
          <div className="header-right">
            {email && <span className="email">{email}</span>}
            <span className="avatar">{(email?.[0] ?? "U").toUpperCase()}</span>
          </div>
        </div>
      </header>
      <TermsNotice />
      <div className={tabbar ? "has-tabbar" : undefined}>{children}</div>
      <RunPill />
      {tabbar && <nav className="tabbar">{links}</nav>}
    </>
  );
}

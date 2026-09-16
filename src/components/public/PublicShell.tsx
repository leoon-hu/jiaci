import Link from "next/link";
import Logo from "@/components/Logo";
import "@/app/landing.css";
import "@/app/(public)/dict.css";

const REPO = "https://github.com/leoon-hu/jiaci";

/** 公开页的外壳（顶栏 + 页脚，复用落地页的类名）：/dict/* 的 layout 与全站 404 页共用 */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="land pub">
      <header className="land-top">
        <Link className="brand" href="/"><Logo size={28} />AI加词</Link>
        <nav className="land-nav">
          <Link href="/dict">词典</Link>
          <a href={REPO} target="_blank" rel="noopener">GitHub</a>
          <Link className="btn btn-primary btn-sm" href="/login">登录</Link>
        </nav>
      </header>
      <main className="pub-main">{children}</main>
      <footer className="land-foot">
        <span>AI加词</span>
        <Link href="/dict">词典</Link>
        <Link href="/legal/privacy">隐私政策</Link>
        <Link href="/legal/terms">服务条款</Link>
        <a href={REPO} target="_blank" rel="noopener">GitHub</a>
      </footer>
    </div>
  );
}

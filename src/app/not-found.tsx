import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";

/** 全站 404：路由匹配不上的路径（登录与否都一样，中间件不再把它们跳到登录页）；/dict 下查不到的词由 (public)/not-found.tsx 处理 */
export default function NotFound() {
  return (
    <PublicShell>
      <div className="pub-404">
        <h1>页面不存在</h1>
        <p className="muted">这个地址没有对应的页面，可能是链接写错了。</p>
        <div className="land-cta"><Link className="btn btn-primary" href="/">回首页</Link><Link className="btn btn-secondary" href="/dict">浏览词库</Link></div>
      </div>
    </PublicShell>
  );
}

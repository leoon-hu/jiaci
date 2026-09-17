import Link from "next/link";
import { SISTER_SITES } from "@/lib/sites";

const REPO = "https://github.com/leoon-hu/jiaci";

/** 落地页与公开页共用的页脚：本站链接一行 + 同一作者另外三个站一行（需求 4.1「四个站互相链接」） */
export default function SiteFooter() {
  return (
    <footer className="land-foot">
      <div className="land-foot-row">
        <span>AI加词</span>
        <Link href="/dict">词典</Link>
        <Link href="/legal/privacy">隐私政策</Link>
        <Link href="/legal/terms">服务条款</Link>
        <a href={REPO} target="_blank" rel="noopener">GitHub</a>
      </div>
      <div className="land-foot-row land-sites">
        <span>更多应用</span>
        {SISTER_SITES.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener">{s.name}<small>{s.desc}</small></a>
        ))}
      </div>
    </footer>
  );
}

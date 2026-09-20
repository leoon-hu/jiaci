import Link from "next/link";
import { OPEN_CLAIM, REPO_URL, SISTER_SITES } from "@/lib/sites";
import ContactLink from "@/components/ContactLink";
import ShareButton from "@/components/ShareButton";

/** 落地页与公开页共用的页脚：「开源」一句 + 本站链接一行（GitHub、分享给朋友、联系站长）+ 同一作者另外三个站一行（需求 4.1「四个站互相链接」「站长联系方式」「开源与分享」） */
export default function SiteFooter() {
  return (
    <footer className="land-foot">
      <p className="land-foot-open">{OPEN_CLAIM}</p>
      <div className="land-foot-row">
        <span>AI加词</span>
        <Link href="/dict">词典</Link>
        <Link href="/legal/privacy">隐私政策</Link>
        <Link href="/legal/terms">服务条款</Link>
        <a href={REPO_URL} target="_blank" rel="noopener">GitHub 源码 ↗</a>
        <ShareButton className="link-btn">分享给朋友</ShareButton>
        <ContactLink />
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

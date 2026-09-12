import Link from "next/link";

/** /dict 下查不到的词或词库 */
export default function NotFound() {
  return (
    <div className="pub-404">
      <h1>没有收录这个词</h1>
      <p className="muted">词典只收录 AI加词 里的词条（约 2.8 万个单词与短语）。</p>
      <div className="land-cta"><Link className="btn btn-primary" href="/dict">浏览词库</Link><Link className="btn btn-secondary" href="/">回首页</Link></div>
    </div>
  );
}

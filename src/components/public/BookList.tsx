import Link from "next/link";
import { BOOK_PAGE_SIZE, type PublicBookPage } from "@/lib/public-dict";
import { bookPageUrl, dictUrl } from "@/lib/dict-url";

const fmt = (n: number) => n.toLocaleString("zh-CN");

/** 页码条：上一页 / 下一页 + 当前页附近的页码 */
function Pager({ slug, page, pages }: { slug: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const nums = Array.from(new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label="分页">
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={bookPageUrl(slug, page - 1)} rel="prev">上一页</Link> : <span className="btn btn-secondary btn-sm" aria-disabled>上一页</span>}
      <span className="nums">{nums.map((n, i) => (
        <span key={n}>{i > 0 && nums[i - 1] !== n - 1 && <span className="gap">…</span>}{n === page ? <b aria-current="page">{n}</b> : <Link href={bookPageUrl(slug, n)}>{n}</Link>}</span>
      ))}</span>
      {page < pages ? <Link className="btn btn-secondary btn-sm" href={bookPageUrl(slug, page + 1)} rel="next">下一页</Link> : <span className="btn btn-secondary btn-sm" aria-disabled>下一页</span>}
    </nav>
  );
}

/** 公开词库页：介绍 + 本页词表（拼写 · 音标 · 核心义），每行链到词条页 */
export default function BookList({ data }: { data: PublicBookPage }) {
  const { book, wordCount, page, pages, rows } = data;
  const first = (page - 1) * BOOK_PAGE_SIZE + 1;
  return (
    <article className="pub-book">
      <nav className="crumbs" aria-label="位置"><Link href="/">首页</Link><span>›</span><Link href="/dict">词典</Link><span>›</span><span>{book.name}</span></nav>
      <header className="page-head">
        <div>
          <h1 className="page-title">{book.name}词汇表{page > 1 && <span className="muted">（第 {page} 页）</span>}</h1>
          <p className="page-sub">共 {fmt(wordCount)} 词 · {book.blurb}</p>
        </div>
      </header>
      <ol className="wl" start={first}>
        {rows.map((r, i) => (
          <li key={r.spelling}>
            <Link href={dictUrl(r.spelling)}>
              <span className="n">{first + i}</span>
              <span className="sp" lang="en">{r.display ?? r.spelling}</span>
              {r.phonetic && <span className="ph" lang="en">{r.phonetic}</span>}
              <span className="def">{r.pos && <i className="pos">{r.pos}</i>}{r.def ?? "—"}</span>
            </Link>
          </li>
        ))}
      </ol>
      <Pager slug={book.slug} page={page} pages={pages} />
      <aside className="pub-cta card">
        <h2>按计划把这 {fmt(wordCount)} 个词背下来</h2>
        <p>登录后把「{book.name}」设为当前词库：每天按设定的新词量学习，FSRS 间隔重复安排复习，四色状态一眼看清进度。免费、开源、无需密码。</p>
        <div className="land-cta"><Link className="btn btn-primary" href="/login">免费开始学习</Link></div>
      </aside>
    </article>
  );
}

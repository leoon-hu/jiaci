import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicBooks } from "@/lib/public-dict";

export const revalidate = 86400;

const fmt = (n: number) => n.toLocaleString("zh-CN");

export const metadata: Metadata = {
  title: "英语词典与词汇表：中高考、四六级、考研、托福、雅思、GRE",
  description: "AI加词的公开词典：2.8 万个单词与短语的释义、例句、搭配、辨析、词族与词源，21 本内置词库——高频核心、考试大纲、学术词汇、常用短语与海外生活场景词汇表，无需登录即可查阅。",
  alternates: { canonical: "/dict" },
};

/** 词典目录：21 本内置词库的入口；词条本身靠词库页与站内链接被发现 */
export default async function DictIndex() {
  const books = await loadPublicBooks();
  const groups: Array<[string, string[]]> = [
    ["高频系列", ["高频核心", "高频进阶", "高频拓展"]],
    ["考试词汇", ["中考词汇", "高考词汇", "四级词汇", "六级词汇", "考研词汇", "托福词汇", "雅思核心", "雅思词汇", "GRE 词汇"]],
    ["学术与短语", ["学术词汇", "常用短语", "常用词组"]],
    ["海外生活", books.filter((b) => b.name.startsWith("海外生活")).map((b) => b.name)],
  ];
  const byName = new Map(books.map((b) => [b.name, b]));
  return (
    <div className="pub-index">
      <header className="page-head"><div><h1 className="page-title">词典与词汇表</h1><p className="page-sub">每个词条有核心义、释义、例句、搭配、句型、近反义辨析、词族、助记与词源，AI 生成、人可读、无需登录。从词库进入，或直接打开 <code>/dict/单词</code>。</p></div></header>
      {groups.map(([title, names]) => {
        const list = names.map((n) => byName.get(n)).filter((b): b is NonNullable<typeof b> => !!b);
        if (!list.length) return null;
        return (
          <section className="book-group" key={title}>
            <h2>{title}</h2>
            <div className="book-grid">
              {list.map((b) => (
                <Link className="card clickable book-card" href={`/dict/book/${b.slug}`} key={b.slug}>
                  <h3>{b.name}<span className="cnt">{fmt(b.wordCount)} 词</span></h3>
                  <p>{b.blurb}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

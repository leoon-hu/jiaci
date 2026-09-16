import Link from "next/link";
import type { ReactNode } from "react";
import type { PublicWord as Data } from "@/lib/public-dict";
import { AI_PROVIDER_LABEL } from "@/lib/ai/providers";
import WordFreqPanel from "@/components/WordFreqPanel";
import Ipa from "./Ipa";
import PubTokens from "./PubTokens";
import SpeakButton from "./SpeakButton";

const LEVEL: Record<number, string> = { 1: "基础", 2: "自然", 3: "场景" };
const AI = () => <span className="ai">AI</span>;

/** 一个内容块：h2 标题 + 内容；标题样式在 dict.css 里对齐登录版的 h4 */
function Section({ id, title, ai = false, children }: { id: string; title: string; ai?: boolean; children: ReactNode }) {
  return <section className="entry-section" id={id}><h2>{title} {ai && <AI />}</h2>{children}</section>;
}

/**
 * 公开词条页正文（匿名可看，供搜索引擎收录）：与登录版 WordDetail 同一份数据、同一套类名，
 * 去掉个人部分（状态、学习记录、备注、打分、反馈、来源切换），四个 Tab 摊成一列全部展开——爬虫不点折叠。
 */
export default function PublicWord({ data }: { data: Data }) {
  const v = data.view;
  const hw = data.spelling;
  const title = data.display ?? data.spelling;
  const links = data.links;
  const tok = (text: string) => <PubTokens text={text} headword={hw} links={links} />;
  const kv = (items: Array<{ en: string; zh: string }>) => (
    <div className="kv-list">{items.map((c, i) => <div className="kv" key={i}><span className="en" lang="en">{tok(c.en)}</span><span className="zh">{c.zh}</span></div>)}</div>
  );
  const family = (items: Array<{ w: string; pos: string; zh: string }>) => (
    <div className="kv-list">{items.map((f, i) => <div className="kv" key={i}><span className="en" lang="en">{tok(f.w)}{f.pos && <span className="pos-sm">{f.pos}</span>}</span><span className="zh">{f.zh}</span></div>)}</div>
  );
  const related = (items: Array<{ w: string; m: string }>) => items.map((s, i) => <div className="confusable" key={i}><b lang="en">{tok(s.w)}</b><span>{s.m}</span></div>);
  // 带 next 的登录链接每个词一条，加 nofollow 免得爬虫挨个去抓（登录页的 canonical 也指回 /login）
  const loginNext = `/login?next=${encodeURIComponent(`/word/${encodeURIComponent(data.spelling)}`)}`;

  return (
    <article className="entry pub-entry">
      <nav className="crumbs" aria-label="位置">
        <Link href="/">首页</Link><span>›</span><Link href="/dict">词典</Link>
        {data.books[0] && <><span>›</span><Link href={`/dict/book/${data.books[0].slug}`}>{data.books[0].name}</Link></>}
        <span>›</span><span lang="en">{title}</span>
      </nav>

      <header className="entry-head">
        <div className="entry-title"><h1 className="spelling" lang="en">{title}</h1></div>
        <div className="entry-sub">
          {v.phonetic ? <span className="phonetic">{v.phonetic.us === v.phonetic.uk ? <Ipa text={v.phonetic.us} /> : <>美 <Ipa text={v.phonetic.us} /> <span className="sep">·</span> 英 <Ipa text={v.phonetic.uk} /></>}</span> : <span className="phonetic">—</span>}
          <SpeakButton text={data.spelling} />
        </div>
      </header>

      {v.core ? <Section id="core" title="核心义" ai={v.coreFromAi}><p className="core-def">{v.core}</p></Section> : <div className="entry-section"><div className="ai-pending">暂无词条资料。</div></div>}

      {v.meanings.length > 0 && (
        <Section id="meanings" title="释义" ai={v.meaningsSource === "ai"}>
          {v.meanings.map((m, i) => (
            <div className="def-group" key={i}>{m.pos && <span className="pos">{m.pos}</span>}
              <ol className="senses">{m.senses.map((s, j) => (
                <li className="sense" key={j}>
                  <div className="zh"><span className="num">{j + 1}</span>{s.zh}</div>
                  {s.en && <div className="en" lang="en">{s.en}</div>}
                  {s.ex && <div className="ex"><div className="en" lang="en">{tok(s.ex.en)}</div><div className="zh">{s.ex.zh}</div></div>}
                </li>
              ))}</ol>
            </div>
          ))}
        </Section>
      )}

      {v.examples.length > 0 && (
        <Section id="examples" title="例句" ai>
          {v.examples.map((e, i) => (
            <div className="example" key={i}>
              <div className="ex-body"><div className="en" lang="en">{tok(e.en)}</div><div className="zh">{e.zh}{e.level && <span className="ex-level">{LEVEL[e.level]}</span>}</div></div>
              <SpeakButton text={e.en} sentence className="btn btn-icon sm btn-ghost ex-speak" />
            </div>
          ))}
        </Section>
      )}

      {v.collocations.length > 0 && <Section id="collocations" title="搭配" ai>{kv(v.collocations)}</Section>}
      {v.phrases.length > 0 && <Section id="phrases" title="短语与习语" ai>{kv(v.phrases)}</Section>}
      {v.patterns.length > 0 && (
        <Section id="patterns" title="句型" ai>
          {v.patterns.map((pt, i) => (
            <div className="pattern" key={i}>
              <div className="p-en" lang="en">{tok(pt.en)}</div><div className="p-zh">{pt.zh}</div>
              {pt.ex && <div className="p-ex"><div className="en" lang="en">{tok(pt.ex.en)}</div><div className="zh">{pt.ex.zh}</div></div>}
            </div>
          ))}
        </Section>
      )}
      {v.usage && <Section id="usage" title="语域与场景" ai><div className="usage-text">{tok(v.usage)}</div></Section>}

      {v.synonyms.length > 0 && <Section id="synonyms" title="近义词辨析" ai>{related(v.synonyms)}</Section>}
      {v.antonyms.length > 0 && <Section id="antonyms" title="反义词" ai>{related(v.antonyms)}</Section>}
      {v.confusables.length > 0 && <Section id="confusables" title="易混词" ai>{related(v.confusables)}</Section>}
      {v.mistakes.length > 0 && (
        <Section id="mistakes" title="常见错误" ai>
          {v.mistakes.map((m, i) => <div className="mistake" key={i}><div className="wrong" lang="en">✕ <s>{m.wrong}</s></div><div className="fix" lang="en">✓ {m.right}</div>{m.note && <div className="why">{m.note}</div>}</div>)}
        </Section>
      )}
      {v.inflections.length > 0 && <Section id="inflections" title="词形变化"><div className="kv-list">{v.inflections.map((f, i) => <div className="kv" key={i}><span className="en" lang="en">{tok(f.w)}</span><span className="zh">{f.label}</span></div>)}</div></Section>}
      {v.family.length > 0 && <Section id="family" title="词族" ai>{family(v.family)}</Section>}
      {v.cognates.length > 0 && <Section id="cognates" title="同根词" ai>{family(v.cognates)}</Section>}

      {v.mnemonic && <Section id="mnemonic" title="助记" ai><div className="mnemonic">{v.mnemonic}</div></Section>}
      {v.etymology && (v.etymology.parts.length > 0 || v.etymology.origin) && (
        <Section id="etymology" title="词源与构词" ai>
          <div className="etym">
            {v.etymology.parts.length > 0 && <div className="parts">{v.etymology.parts.map((pt, i) => <span key={i}>{i > 0 && <span className="plus">+</span>}<span className="part">{pt.part}<small>{pt.meaning}</small></span></span>)}</div>}
            {v.etymology.origin && <p className="origin">{v.etymology.origin}</p>}
          </div>
        </Section>
      )}

      <Section id="frequency" title="词频与标签"><WordFreqPanel freq={data.freq} kind={data.kind} /></Section>

      {data.books.length > 0 && (
        <Section id="books" title="收录于">
          <div className="chips book-chips">{data.books.map((b) => <Link className="chip" href={`/dict/book/${b.slug}`} key={b.slug}>{b.name}</Link>)}</div>
        </Section>
      )}

      <aside className="pub-cta card">
        <h2>把 <span lang="en">{title}</span> 加进学习计划</h2>
        <p>AI加词按 FSRS 间隔重复安排复习，每次只需回答「认识」或「模糊」；21 本内置词库，也可以导入自己的词表。免费、开源、无需密码。</p>
        <div className="land-cta"><Link className="btn btn-primary" href={loginNext} rel="nofollow">免费学习这个词</Link><Link className="btn btn-secondary" href="/dict">浏览全部词库</Link></div>
      </aside>

      <p className="ai-source">
        词条资料由 {v.provider ? AI_PROVIDER_LABEL[v.provider] : "AI"} 生成，词典数据来自 ECDICT，仅供参考。发现错误？<Link href={loginNext} rel="nofollow">登录后可以反馈</Link>。
      </p>
    </article>
  );
}

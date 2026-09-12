import Link from "next/link";
import { dictUrl } from "@/lib/dict-url";
import { tokenize } from "@/lib/lemma";
import { normalizeWord } from "@/lib/words";

/**
 * 公开词条页里的英文：本词及其变形加粗，能链到别的词条的 token 变成链接（links 表由 loadPublicWord 算好，只含 word 表里有的词），
 * 其余原样。登录版用的是点词弹框（WordTokens + WordPeek），公开页不需要弹框，链接对爬虫也更有用。
 */
export default function PubTokens({ text, headword, links }: { text: string; headword?: string; links: Record<string, string> }) {
  // 整条就是一个词条（词族里的 give up、搭配里的短语）：整体一个链接
  const whole = normalizeWord(text);
  if (whole.includes(" ") && links[whole]) return <Link className="w" href={dictUrl(links[whole])} lang="en">{text}</Link>;
  const hwParts = headword ? headword.split(" ") : [];
  return (
    <>
      {tokenize(text).map((t, i) => {
        if (!t.word) return <span key={i}>{t.text}</span>;
        const base = t.text.toLowerCase();
        const hw = hwParts.length > 0 && (hwParts.includes(base) || (hwParts.length === 1 && base.startsWith(hwParts[0]) && base.length - hwParts[0].length <= 3));
        if (hw) return <b className="w hw" key={i}>{t.text}</b>;
        const to = links[base];
        return to ? <Link className="w" href={dictUrl(to)} key={i}>{t.text}</Link> : <span key={i}>{t.text}</span>;
      })}
    </>
  );
}

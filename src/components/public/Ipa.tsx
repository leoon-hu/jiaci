import { ipaBody } from "@/lib/dict";

/**
 * 公开页上的音标：数据里写作 /ˈlæsi/，这里去掉斜杠、由 CSS（.ipa::before / ::after）画出来。
 * 斜杠和音标连成一个字符串写进页面（HTML 文本、RSC 数据都算），搜索引擎会把它当相对路径去抓，
 * Search Console 里就多出一堆 /ˈlæsi 这样的网址；拆开后页面里就不再有这个字符串。
 */
export default function Ipa({ text, className }: { text: string; className?: string }) {
  return <span className={className ? `ipa ${className}` : "ipa"} lang="en">{ipaBody(text)}</span>;
}

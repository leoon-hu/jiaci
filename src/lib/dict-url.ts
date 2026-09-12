import { isValidWord, normalizeWord } from "./words";

/**
 * 公开词条 / 词库页（/dict/*）的地址规则，纯函数，浏览器与服务端共用。
 * 拼写里的空格写成下划线（/dict/give_up），其余原样；不能用连字符代替空格：库里有 best-seller / best seller 这样的同形对。
 */
export const spellingToPath = (spelling: string) => encodeURIComponent(spelling.replace(/ /g, "_"));
export const dictUrl = (spelling: string) => `/dict/${spellingToPath(spelling)}`;
/** URL 段 → 拼写；不合法返回 null（页面 404，不让爬虫用任意拼写造页） */
export function pathToSpelling(raw: string): string | null {
  let s: string;
  try { s = decodeURIComponent(raw); } catch { s = raw; }
  s = normalizeWord(s.replace(/_/g, " "));
  return isValidWord(s) ? s : null;
}
/** 词库页第 n 页的地址：第 1 页不带页码 */
export const bookPageUrl = (slug: string, page: number) => (page <= 1 ? `/dict/book/${slug}` : `/dict/book/${slug}/${page}`);

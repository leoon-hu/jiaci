/** 词条（单词 / 短语）标准化与导入解析（需求 3.3.3 / 3.3.4） */

/** 单词：小写字母开头，可含撇号与连字符 */
export const WORD_RE = /^[a-z][a-z'-]*$/;
/** 短语：两个以上单词，以单个空格分隔 */
export const PHRASE_RE = /^[a-z][a-z'-]*(?: [a-z][a-z'-]*)+$/;
/** 拼写最大长度（含短语） */
export const MAX_WORD_LEN = 60;

export type WordKind = "word" | "phrase";

/**
 * 词表行常写成「abandon vt. 放弃」「able adj. 能够的」，去掉尾部中文后会剩下「abandon vt」被当成短语（审计 F083）。
 * 必须带句点才算词性标注，否则会误伤 classified ad、clip art 这类真短语。
 */
const POS_NOTE = /\s+(?:n|v|vt|vi|vs|adj|a|ad|adv|prep|conj|pron|num|aux|int|interj|art|det|abbr|pl|sing)\.(?:\s.*)?$/i;

/**
 * 小写、合并空白、去掉首尾的非字母字符（如「abandon 放弃」→ abandon，「Give  up!」→ give up）。
 * 带重音的字母先折成 ASCII（café → cafe），弯引号与各种连字符折成 ' 与 -：
 * 直接按 [^a-z] 剪首尾会把 café 剪成 caf、cliché 剪成 clich，变成另一个「合法」的词被导入（审计 F082）。
 */
export function normalizeWord(raw: string): string {
  const folded = raw
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")   // 去掉组合用重音记号
    .replace(/[\u2018\u2019\u02bc]/g, "'")               // 弯引号 → '
    .replace(/[\u2010-\u2015\u2212]/g, "-");             // 各种连字符 / 减号 → -
  // 先按句点剥掉词性标注与其后的释义，再做常规修剪
  const w = folded.trim().toLowerCase().replace(/\s+/g, " ").replace(POS_NOTE, "").replace(/^[^a-z]+|[^a-z]+$/g, "");
  // 折不成 ASCII 的（俄语、日文等）整条判为不合法，而不是剪成半截词
  if (/[^\x00-\x7f]/.test(folded.trim().toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")) && !/^[a-z]/.test(w)) return "";
  return w;
}

export const isPhrase = (w: string) => w.includes(" ");
export const wordKind = (w: string): WordKind => (isPhrase(w) ? "phrase" : "word");

/**
 * 合法的单词或短语。短语中的单字母词只允许 a / i，
 * 以免把「abandon v. 放弃」这类带注释的行（去尾后为 abandon v）误判成短语。
 */
export function isValidWord(w: string): boolean {
  if (!w || w.length > MAX_WORD_LEN) return false;
  if (WORD_RE.test(w)) return true;
  if (!PHRASE_RE.test(w)) return false;
  return w.split(" ").every((t) => t.length > 1 || t === "a" || t === "i");
}

export type ImportRowStatus = "ok" | "dup" | "empty" | "bad";
export interface ImportRow { n: number; raw: string; word: string; status: ImportRowStatus }

/** 解析 txt（每行一个单词或短语）：去重、空行、非英文；末尾空行不计入 */
export function parseImportText(text: string): { rows: ImportRow[]; words: string[]; ok: number; skipped: number } {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const words: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    const w = normalizeWord(raw);
    let status: ImportRowStatus;
    if (!raw) status = "empty";
    else if (!isValidWord(w)) status = "bad";
    else if (seen.has(w)) status = "dup";
    else { seen.add(w); words.push(w); status = "ok"; }
    rows.push({ n: i + 1, raw, word: w, status });
  });
  while (rows.length && rows[rows.length - 1].status === "empty") rows.pop();
  const ok = words.length;
  return { rows, words, ok, skipped: rows.length - ok };
}

/** 手动添加：逗号 / 分号 / 换行分隔多个词条；短语内部用空格连接 */
export function splitManualInput(input: string): { words: string[]; bad: string[] } {
  const words: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(/[\r\n,，;；、]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    const w = normalizeWord(raw);
    if (!isValidWord(w)) { bad.push(raw); continue; }
    if (!seen.has(w)) { seen.add(w); words.push(w); }
  }
  return { words, bad };
}

/**
 * CSV 解析（RFC 4180：引号字段、双引号转义、字段内换行）。
 * 抽成独立模块是为了能单测：ECDICT 的 77 万行里有未加引号字段带孤立引号的行，
 * 早先的实现会把这种引号当成字段起始引号，从而把后面所有行吞进同一个字段（审计 F091）。
 */
export class CsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private afterQuote = false;

  /** 喂一段文本，返回其中已完整的行 */
  push(chunk: string): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.inQuotes) {
        if (c === '"') { this.inQuotes = false; this.afterQuote = true; } else this.field += c;
        continue;
      }
      if (this.afterQuote) {
        this.afterQuote = false;
        // 引号字段里的 "" 是一个转义的引号
        if (c === '"') { this.field += '"'; this.inQuotes = true; continue; }
      }
      // 只有字段开头的引号才开启引号字段；字段中间的引号是普通字符
      if (c === '"' && this.field === "") this.inQuotes = true;
      else if (c === '"') this.field += c;
      else if (c === ",") { this.row.push(this.field); this.field = ""; }
      else if (c === "\n") { this.row.push(this.field); this.field = ""; out.push(this.row); this.row = []; }
      else if (c !== "\r") this.field += c;
    }
    return out;
  }

  /** 文本结束：把最后一行（如果没有以换行结尾）吐出来 */
  end(): string[][] {
    if (!this.field && !this.row.length) return [];
    this.row.push(this.field);
    const last = this.row;
    this.field = ""; this.row = [];
    return [last];
  }
}

/** 把一段完整文本解析成行 */
export function parseCsv(text: string): string[][] {
  const p = new CsvParser();
  return [...p.push(text), ...p.end()];
}

import { describe, it, expect } from "vitest";
import { CsvParser, parseCsv } from "../src/lib/csv";

describe("CSV 解析", () => {
  it("基本字段、引号字段、转义引号、字段内换行", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv('1,"含, 逗号",3\n')).toEqual([["1", "含, 逗号", "3"]]);
    expect(parseCsv('1,"转义 ""引号""",3\n')).toEqual([["1", '转义 "引号"', "3"]]);
    expect(parseCsv('1,"跨\n行",3\n')).toEqual([["1", "跨\n行", "3"]]);
  });

  it("未加引号字段里的孤立引号不吞掉后续行（审计 F091）", () => {
    const rows = parseCsv('1,he said "hi,x\n2,normal,y\n3,ok,z\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["1", 'he said "hi', "x"]);
    expect(rows[1]).toEqual(["2", "normal", "y"]);
    expect(rows[2]).toEqual(["3", "ok", "z"]);
  });

  it("最后一行没有换行也会吐出来；\\r 忽略", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("分块喂入的结果与一次性解析一致", () => {
    const text = '1,"跨\n行",3\n2,he said "hi,y\n3,"a ""b""",z\n';
    const p = new CsvParser();
    const out: string[][] = [];
    for (let i = 0; i < text.length; i += 3) out.push(...p.push(text.slice(i, i + 3)));
    out.push(...p.end());
    expect(out).toEqual(parseCsv(text));
  });
});

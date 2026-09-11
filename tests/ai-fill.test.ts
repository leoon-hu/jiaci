import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { containsHeadword, extractJson, isDbError, isFatalApiError, isTransientApiError, repairJson, validateFill } from "../src/lib/ai/fill";

describe("AI 填充校验", () => {
  it("例句是否含本词或其变形（规则变形、不规则变形、词典 exchange、短语）", () => {
    expect(containsHeadword("They abandoned the car.", "abandon", "d:abandoned/p:abandoned")).toBe(true);
    expect(containsHeadword("She is abandoning hope.", "abandon", null)).toBe(true);
    expect(containsHeadword("He went home.", "go", "p:went/d:gone")).toBe(true);
    expect(containsHeadword("He went home.", "go", null)).toBe(true);
    expect(containsHeadword("Two hypotheses were tested.", "hypothesis", "s:hypotheses")).toBe(true);
    expect(containsHeadword("He gave up smoking last year.", "give up", null)).toBe(true);
    expect(containsHeadword("She gives up too easily.", "give up", null)).toBe(true);
    expect(containsHeadword("A good plan.", "abandon", null)).toBe(false);
    // 连字符、原形与变形互认、双写辅音（英美拼写）、短语
    expect(containsHeadword("These boots are waterproof.", "water-proof", null)).toBe(true);
    expect(containsHeadword("Many dropouts regret leaving school.", "drop-out", null)).toBe(true);
    expect(containsHeadword("She is a multi-talented musician.", "multi", null)).toBe(true);
    expect(containsHeadword("Use a keyword to find the article.", "keywords", null)).toBe(true);
    expect(containsHeadword("Our schedules overlap on Monday.", "overlapping", null)).toBe(true);
    expect(containsHeadword("The company distills its own whiskey.", "distil", null)).toBe(true);
    expect(containsHeadword("The water is cold.", "water-proof", null)).toBe(false);
    expect(containsHeadword("He dropped the ball.", "drop-out", null)).toBe(false);
    expect(containsHeadword("He gave it to me.", "give up", null)).toBe(false);
    // 短词不再被去后缀后的常见词误放行（审计 F095）
    expect(containsHeadword("This is for you.", "forest", null)).toBe(false);
    expect(containsHeadword("The new plan is good.", "news", null)).toBe(false);
    expect(containsHeadword("I can hear with my ear.", "early", null)).toBe(false);
    // 短语要按顺序且靠近，不能是散在句子两头的两个词
    expect(containsHeadword("Please look the word up in the dictionary.", "look up", null)).toBe(true);
    expect(containsHeadword("He gave the book to me and later stood up.", "give up", null)).toBe(false);
  });
  it("JSON 提取与核心字段校验", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    const w = { spelling: "abandon", kind: "word" as const, exchange: "d:abandoned" };
    const good = { core: "放弃", meanings: [{ pos: "v.", senses: [{ zh: "放弃" }] }], examples: [{ en: "They abandoned the car.", zh: "他们丢下了车。", level: 1 }, { en: "He abandoned his plan.", zh: "他放弃了计划。", level: 2 }, { en: "A good plan.", zh: "好计划。" }], collocations: "bad", phonetic_us: "əˈbændən" };
    const r = validateFill(good, w);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.examples).toHaveLength(2);
      expect(r.data.collocations).toEqual([]);
      expect(r.data.phoneticUs).toBeNull();
      expect(r.warnings.join(" ")).toContain("collocations");
    }
    const withDup = { ...good, mistakes: [{ wrong: "abandon to do", right: "abandon to do", note: "x" }, { wrong: "abandon to do", right: "abandon doing", note: "y" }] };
    const r2 = validateFill(withDup, w);
    expect(r2.ok && (r2.data.mistakes as unknown[]).length).toBe(1);
    // 词源：词根词缀写得太长时只保留来源，不整块丢掉；来源也不能用才置空
    const longPart = { ...good, etymology: { origin: "来自古英语 gietan，意为获得。", parts: [{ part: "ge-", meaning: "x".repeat(80) }] } };
    const r3 = validateFill(longPart, w);
    expect(r3.ok && r3.data.etymology).toEqual({ origin: "来自古英语 gietan，意为获得。", parts: [] });
    expect(r3.ok && r3.warnings.some((x) => x.includes("只保留了来源"))).toBe(true);
    const badEty = validateFill({ ...good, etymology: { parts: "nonsense" } }, w);
    expect(badEty.ok && badEty.data.etymology).toBeNull();
    expect(validateFill({ core: "放弃", meanings: [], examples: [] }, w).ok).toBe(false);
    expect(validateFill({ meanings: [{ pos: "v.", senses: [{ zh: "放弃" }] }], examples: [] }, w).ok).toBe(false);
  });
});

describe("填充脚本的错误分类", () => {
  it("数据库连不上：不再调接口，等恢复", () => {
    expect(isDbError(new Prisma.PrismaClientInitializationError("Can't reach database server at `127.0.0.1:5432`", "6.19.3"))).toBe(true);
    expect(isDbError(new Prisma.PrismaClientKnownRequestError("closed", { code: "P1017", clientVersion: "6.19.3" }))).toBe(true);
    expect(isDbError(new Error("Invalid `prisma.wordAiDeepseek.upsert()` invocation:\n\nCan't reach database server at `127.0.0.1:5432`"))).toBe(true);
    expect(isDbError(new Error("deepseek 接口 500: oops"))).toBe(false);
    expect(isDbError(new Error("JSON 解析失败"))).toBe(false);
  });
  it("密钥 / 余额问题致命，限流与超时可重试", () => {
    expect(isFatalApiError(new Error("deepseek 接口 401: Authentication Fails"))).toBe(true);
    expect(isFatalApiError(new Error("openai 接口 402: Insufficient credits"))).toBe(true);
    expect(isFatalApiError(new Error("deepseek 接口 429: rate limit"))).toBe(false);
    expect(isTransientApiError(new Error("deepseek 接口 429: rate limit"))).toBe(true);
    expect(isTransientApiError(new Error("deepseek 接口 503: busy"))).toBe(true);
    expect(isTransientApiError(new Error("JSON 解析失败"))).toBe(false);
  });
});

describe("JSON 修复", () => {
  it("对象里多出的裸字符串成员整行去掉（中间与末尾两种位置）", () => {
    const bad = `{
  "confusables": [
    {
      "w": "wind",
      "n. 风；v. 缠绕",
      "m": "拼写相近，读音不同"
    },
    {
      "w": "widow",
      "m": "少一个 n",
      "n. 寡妇"
    }
  ]
}`;
    expect(() => JSON.parse(bad)).toThrow();
    expect(extractJson(bad)).toEqual({ confusables: [{ w: "wind", m: "拼写相近，读音不同" }, { w: "widow", m: "少一个 n" }] });
  });
  it("键名后的全角冒号", () => {
    expect(extractJson('{"w"："wind", "m": "x"}')).toEqual({ w: "wind", m: "x" });
    // 字符串值里的全角冒号不动
    expect(extractJson('{"m": "例如：x"}')).toEqual({ m: "例如：x" });
  });
  it("合法 JSON 不经修复，真坏的仍报原错误", () => {
    expect(repairJson('{"a": "b",\n "c": 1}')).toBe('{"a": "b",\n "c": 1}');
    expect(() => extractJson("{\"a\": }")).toThrow();
  });
});

describe("英美拼写变体补充表", () => {
  it("本词是美式简写、例句用英式合字，仍算含本词", () => {
    expect(containsHeadword("The building has great aesthetic appeal.", "esthetic")).toBe(true);
    expect(containsHeadword("The foetus develops rapidly.", "fetus")).toBe(true);
    expect(containsHeadword("She studies archaeology at university.", "archeology")).toBe(true);
  });
  it("反过来也认", () => {
    expect(containsHeadword("Its esthetic value is high.", "aesthetic")).toBe(true);
  });
  it("认 -our / -ise / 双写辅音的派生形式", () => {
    expect(containsHeadword("It was a humorous remark.", "humourous")).toBe(true);
    expect(containsHeadword("They computerized the records.", "computerise")).toBe(true);
    expect(containsHeadword("She will fulfil her promise.", "fulfill")).toBe(true);
  });
  // 逐条列词表而不是按规则替换，就是为了不出现这些误配
  it("不误伤形近但不同义的词", () => {
    expect(containsHeadword("She went home.", "shoe")).toBe(false);
    expect(containsHeadword("He used a cane to walk.", "canoe")).toBe(false);
    expect(containsHeadword("The pet is sleeping.", "poet")).toBe(false);
    expect(containsHeadword("We are here.", "woe")).toBe(false);
    expect(containsHeadword("It is below the table.", "bellow")).toBe(false);
    expect(containsHeadword("She was filing the documents.", "filling")).toBe(false);
    expect(containsHeadword("He came forth quickly.", "fourth")).toBe(false);
    expect(containsHeadword("Good morning everyone.", "mourning")).toBe(false);
    expect(containsHeadword("The timber was expensive.", "timbre")).toBe(false);
    expect(containsHeadword("He spoke gravely about it.", "gravelly")).toBe(false);
  });
});

describe("短语与连字符词的例句比对", () => {
  it("短语里的不规则动词变形算含本词", () => {
    expect(containsHeadword("The fire broke out last night.", "break out")).toBe(true);
    expect(containsHeadword("He fell asleep during the movie.", "fall asleep")).toBe(true);
    expect(containsHeadword("The car broke down on the highway.", "break down")).toBe(true);
  });
  it("连字符词在例句里写成空格分隔也算", () => {
    expect(containsHeadword("We ate in the dining room.", "dining-room")).toBe(true);
    expect(containsHeadword("She used her cell phone.", "cell-phone")).toBe(true);
  });
  it("连字符词整体与去连字符形式仍然算", () => {
    expect(containsHeadword("The dining-room was full.", "dining-room")).toBe(true);
    expect(containsHeadword("He bought a new cellphone.", "cell-phone")).toBe(true);
  });
  it("本词分写、例句连写也算（head way ↔ headway）", () => {
    expect(containsHeadword("They made little headway in the talks.", "head way")).toBe(true);
  });
  it("本词连写、例句分写也算（babyboom ↔ baby boom）", () => {
    expect(containsHeadword("The baby boom changed the country.", "babyboom")).toBe(true);
  });
  it("不误判：各部分散落在句子两端不算含该短语", () => {
    expect(containsHeadword("The fall was sudden and everyone was asleep by then anyway.", "fall asleep")).toBe(false);
  });
});

describe("外来词的变音符号", () => {
  it("词条无符号、例句带符号也算含本词", () => {
    expect(containsHeadword("He works as a cultural attaché in Paris.", "attache")).toBe(true);
    expect(containsHeadword("She left her son at the crèche.", "creche")).toBe(true);
    expect(containsHeadword("His soigné appearance impressed everyone.", "soigne")).toBe(true);
  });
  it("反过来也认", () => {
    expect(containsHeadword("The attache carried the documents.", "attaché")).toBe(true);
  });
});

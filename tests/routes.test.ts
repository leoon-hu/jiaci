import { readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { classifyPath } from "../src/lib/routes";
import { middleware } from "../src/middleware";

describe("路径分类（中间件）", () => {
  it("公开页与静态资源不看会话", () => {
    for (const p of ["/", "/login", "/login?next=/home", "/legal/privacy", "/api/me", "/dict", "/dict/abandon", "/dict/book/ielts/2", "/robots.txt", "/sitemap.xml", "/sitemap/words-0.xml", "/og.png", "/wechat-qrcode.jpg", "/manifest.webmanifest", "/sw.js"]) {
      expect(classifyPath(p), p).toBe("public");
    }
  });
  it("登录后的页面匿名要跳登录", () => {
    for (const p of ["/home", "/home/", "/study", "/study/done", "/wordbooks", "/wordbooks/new", "/wordbooks/abc", "/word/abandon", "/word/give%20up", "/import", "/settings", "/run"]) {
      expect(classifyPath(p), p).toBe("app");
    }
  });
  it("其它路径直接 404，不跳登录（音标之类被爬虫当路径抓的字符串）", () => {
    for (const p of ["/ˈlæsi", "/ˈlæsi/", "/wɜːrld", "/&", "/homework", "/wordbook", "/word", "/dictionary", "/settingsx"]) {
      expect(classifyPath(p), p).toBe("unknown");
    }
  });
});

describe("中间件：末尾斜杠与匿名跳转", () => {
  const run = (path: string, headers: Record<string, string> = {}) =>
    middleware(new NextRequest(`http://localhost:3000${path}`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "jiaci.app", ...headers } }));

  it("不存在的路径带不带斜杠都直接放行给 Next 出 404，不重定向", () => {
    for (const p of ["/%CB%88l%C3%A6si", "/%CB%88l%C3%A6si/", "/homework/", "/sitemap/"]) {
      const res = run(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.headers.get("x-middleware-next"), p).toBe("1");
    }
  });
  it("存在的页面末尾多了斜杠：308 到不带斜杠的规范地址，保留查询串", () => {
    expect(run("/dict/world/").headers.get("location")).toBe("https://jiaci.app/dict/world");
    expect(run("/dict/world/").status).toBe(308);
    expect(run("/dict/give_up/?x=1").headers.get("location")).toBe("https://jiaci.app/dict/give_up?x=1");
    expect(run("/login/").headers.get("location")).toBe("https://jiaci.app/login");
    expect(run("/api/config/public/").headers.get("location")).toBe("https://jiaci.app/api/config/public");
    // 登录后的页面也先归到规范地址，下一跳再决定跳不跳登录
    expect(run("/home/").headers.get("location")).toBe("https://jiaci.app/home");
    expect(run("/word/give%20up/").headers.get("location")).toBe("https://jiaci.app/word/give%20up");
  });
  it("匿名访问登录后的页面跳登录带原路径，/word/ 转到公开词条页", () => {
    const home = run("/home");
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("https://jiaci.app/login?next=%2Fhome");
    expect(run("/word/give%20up").headers.get("location")).toBe("https://jiaci.app/dict/give_up");
    expect(run("/home", { cookie: "aiword_session=abc" }).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("拿拼写当路径的地方，同级不能有静态段", () => {
  // /api/words/<拼写>、/word/<拼写>、/dict/<拼写>：同级要是有静态段（原来的 /api/words/peek），Next 先匹配静态段，同名的那个词就打不开了
  const entries = (dir: string, kind: "dir" | "file") =>
    readdirSync(new URL(`../src/app/${dir}`, import.meta.url), { withFileTypes: true }).filter((e) => (kind === "dir" ? e.isDirectory() : e.isFile())).map((e) => e.name).sort();
  it("/api/words/ 与 /word/ 下面只有 [spelling]", () => {
    expect(entries("api/words", "dir")).toEqual(["[spelling]"]);
    expect(entries("api/words", "file")).toEqual([]);
    expect(entries("(app)/word", "dir")).toEqual(["[spelling]"]);
  });
  it("/dict/ 下面除了 [spelling] 只有 book/，book/ 本身没有页面（有了 /dict/book 这个词条页就被抢走）", () => {
    expect(entries("(public)/dict", "dir")).toEqual(["[spelling]", "book"]);
    expect(entries("(public)/dict/book", "file")).toEqual([]);
  });
});

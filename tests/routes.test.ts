import { describe, it, expect } from "vitest";
import { classifyPath } from "../src/lib/routes";

describe("路径分类（中间件）", () => {
  it("公开页与静态资源不看会话", () => {
    for (const p of ["/", "/login", "/login?next=/home", "/legal/privacy", "/api/me", "/dict", "/dict/abandon", "/dict/book/ielts/2", "/robots.txt", "/sitemap.xml", "/sitemap/words-0.xml", "/og.png", "/manifest.webmanifest", "/sw.js"]) {
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

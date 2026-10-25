import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { allow, clientIp, retryAfterMs } from "@/lib/rate-limit";
import { parseSearchQuery, type SearchResult } from "@/lib/search";
import { searchWords } from "@/lib/search-db";

/** 每个来访 IP 每分钟最多搜几次：边输边搜一个词要发好几次，正常用到不了；接口不用登录，防的是被拿去把词表整个扒走 */
const PER_MINUTE = 120;
const AiPref = z.enum(["auto", "deepseek", "openai"]).catch("auto");

/**
 * 单词搜索（需求 3.9）：不用登录（落地页与公开词典页的顶栏也有搜索），只查 word 表、只读不建。
 * `ai` = 词条资料来源，登录后的页面按用户设置传，结果里的核心义与单词列表同一口径；不传按「自动」
 */
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const q = parseSearchQuery(u.searchParams.get("q") ?? "");
  if (!q) return ok<SearchResult>({ hits: [], fuzzy: false });
  const key = `search:${clientIp(req)}`;
  if (!allow(key, PER_MINUTE, 60_000)) {
    const res = fail(429, "搜索太频繁，稍等一会儿再试", "rate_limited");
    res.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs(key, PER_MINUTE, 60_000) / 1000))));
    return res;
  }
  return ok(await searchWords(q, AiPref.parse(u.searchParams.get("ai") ?? "auto")));
});

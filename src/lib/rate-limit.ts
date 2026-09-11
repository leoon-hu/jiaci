/**
 * 进程内的滑动窗口限速（审计 F002 / F012）。
 * 单实例部署够用；将来多实例要换成 Redis 之类的共享计数。
 */
const buckets = new Map<string, number[]>();

/** 取客户端 IP：nginx 用 $proxy_add_x_forwarded_for 追加，客户端自带的值排在最前，所以只能信 X-Real-IP 或 XFF 的最后一跳 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : "local";
}

/**
 * 记一次命中并判断是否超限。key 建议带上用途前缀，windowMs 内最多 limit 次。
 * 返回 true 表示放行。
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  // 定期淘汰不活跃的键，避免无限增长（不能整表清零，那等于把所有人的计数一起抹掉）
  if (buckets.size > 5000) for (const [k, v] of buckets) { if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k); }
  return true;
}

/** 只看是否超限，不记命中 */
export function isOver(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  return (buckets.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
}

/** 测试用：清空计数 */
export function resetRateLimit() { buckets.clear(); }

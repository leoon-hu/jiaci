/** 学习日期以「YYYY-MM-DD」字符串表示；客户端可传本地日期（与服务器日期相差 ≤ 1 天时采用） */

/**
 * 客户端本地日期的 Cookie 名（性能优化 P1-1）。
 * 页面首屏改成服务端直出后，服务端也要知道用户的「今天」是哪一天，否则时区不同的用户第一眼看到的是
 * 按服务器 UTC 日期算的任务数。由 `NavTracker` 在每次路由变化时写入，服务端用 `resolveToday` 校验
 * （与接口的 date 参数同一套规则：相差 ≤ 1 天才采用），拿不到就退回服务器日期、由客户端再纠正一次。
 */
export const DATE_COOKIE = "aiword_date";
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}
export function resolveToday(clientDate?: string | null): string {
  const s = serverToday();
  if (!clientDate || !/^\d{4}-\d{2}-\d{2}$/.test(clientDate)) return s;
  const d = new Date(clientDate + "T00:00:00Z");
  // 2026-02-30 这类不存在的日期格式合法但会被 Date 顺延，直接按服务器日期算（审计 F161）
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== clientDate) return s;
  const diff = Math.abs(d.getTime() - new Date(s + "T00:00:00Z").getTime());
  return diff <= 86_400_000 ? clientDate : s;
}
export function toDate(ymd: string | null): Date | null {
  return ymd ? new Date(ymd + "T00:00:00Z") : null;
}
export function fromDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

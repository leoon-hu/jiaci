"use client";
/**
 * 站内路由深度：判断当前页面是站内跳进来的（可以安全地 history.back，回到来处并保留列表滚动位置），
 * 还是直接打开 / 刷新进来的（此时 back 会离开本站，改用兜底链接）。
 * 整页加载时归零，`AppShell` 在每次路由变化时登记一次：popstate 引起的（浏览器前进后退）减一，其余加一。
 */
let depth = -1;
let popped = false;
let last: string | null = null;
if (typeof window !== "undefined") window.addEventListener("popstate", () => { popped = true; });

/** 登记一次路由变化（同一路径重复登记忽略，兼容 React 严格模式下重复执行的副作用） */
export function markVisit(path: string) {
  // 同一路径重复登记只清掉 pop 标记，免得它留到下一次前进导航（会被误当成后退）
  if (path === last) { popped = false; return; }
  last = path;
  if (popped) { popped = false; depth = Math.max(0, depth - 1); } else depth++;
}
/** 当前页面之前还有站内页面，「返回」可以用 history.back */
export const canGoBack = () => depth > 0;
/**
 * 这次渲染是不是浏览器前进 / 后退过来的：popstate 已经触发、`markVisit` 还没登记。
 * 页面组件首渲染时读得到（`NavTracker` 的副作用在渲染之后才跑），用来决定要不要恢复上次的浏览状态。
 */
export const isPopNavigation = () => popped;

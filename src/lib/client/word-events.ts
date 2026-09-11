"use client";
/**
 * 详情浮层改了词的状态后，通知底层还挂着的页面同步。
 * 详情从整页跳转改成浮层（拦截路由）之后，返回不再重新挂载词库列表 / 学习页，
 * 它们也就不会自己重新请求——浮层里打的分要靠这里推一把（需求 3.2.5）。
 */
type Listener = (spelling: string) => void;
const listeners = new Set<Listener>();

/** 订阅：返回取消订阅的函数，直接用作 useEffect 的清理 */
export function onWordChanged(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emitWordChanged(spelling: string) {
  for (const fn of [...listeners]) fn(spelling);
}

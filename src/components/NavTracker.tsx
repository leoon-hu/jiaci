"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { markVisit } from "@/lib/client/nav";
import { localToday } from "@/lib/client/api";
import { DATE_COOKIE } from "@/lib/dates";

/** 挂在根布局里登记站内跳转（含登录页、法务页），供 BackLink 判断能否 history.back */
export default function NavTracker() {
  const pathname = usePathname();
  useEffect(() => { markVisit(pathname); }, [pathname]);
  // 把本地日期写进 Cookie，服务端直出首屏时按它算「今天」（见 lib/dates.ts 的 DATE_COOKIE）
  useEffect(() => {
    try { document.cookie = `${DATE_COOKIE}=${localToday()}; path=/; max-age=86400; samesite=lax`; } catch { /* 隐私模式等 */ }
  }, [pathname]);
  return null;
}

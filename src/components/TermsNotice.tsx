"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/useMe";

/**
 * 条款更新提示（审计 F171）：用户同意过的版本与 system_config 的 legal.version 不一致时，
 * 在应用内提示一次，点「我已阅读并同意」写回新版本与时间。
 */
export default function TermsNotice() {
  const { me, refresh } = useMe();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!me?.termsOutdated || done) return null;
  return (
    <div className="terms-notice" role="status">
      <span>服务条款与隐私政策已更新，请查看 <Link href="/legal/terms">服务条款</Link> 与 <Link href="/legal/privacy">隐私政策</Link>。</span>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api("/api/account/accept-terms", { method: "POST" }); setDone(true); refresh().catch(() => {}); }
        finally { setBusy(false); }
      }}>我已阅读并同意</button>
    </div>
  );
}

"use client";
import Logo from "@/components/Logo";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ClientApiError } from "@/lib/client/api";
import { resetMeCache } from "@/lib/client/useMe";
import { useToast } from "@/components/Toast";
import "./login.css";

/** next 只接受站内绝对路径：//evil.com、https://evil 这类值会被 router.replace 直接带出站（审计 F004） */
function safeNext(n: string | null): string {
  return n && /^\/(?![/\\])/.test(n) ? n : "/home";
}

/** 邮箱验证码登录（需求 3.1）：邮箱 → 6 位码 → 登录；60s 重发倒计时；错误 5 次作废 */
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [codeErr, setCodeErr] = useState("");
  const [dead, setDead] = useState(false);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  // 免登录天数是 system_config 里的 session.days，界面别写死（审计 F150）
  const [sessionDays, setSessionDays] = useState(90);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => { api<{ sessionDays: number }>("/api/config/public").then((c) => setSessionDays(c.sessionDays)).catch(() => {}); }, []);
  // 能走到登录页说明会话已失效，把残留的 Cookie 清掉，免得中间件继续放行再被页面弹回来（审计 NU09）
  useEffect(() => {
    if (typeof document === "undefined" || !document.cookie.includes("aiword_session=")) return;
    api("/api/auth/logout", { method: "POST" }).catch(() => {});
  }, []);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function send() {
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setEmailErr("请输入正确的邮箱地址"); return; }
    setEmailErr(""); setBusy(true);
    try {
      const r = await api<{ resendSeconds: number; devCode?: string }>("/api/auth/request-otp", { method: "POST", json: { email: v } });
      setStep(2); setLeft(r.resendSeconds); setDigits(Array(6).fill("")); setCodeErr(""); setDead(false);
      setDevCode(r.devCode ?? null);
      toast(r.devCode ? "开发模式：验证码已显示在页面上" : "验证码已发送，请查收邮件");
      setTimeout(() => boxes.current[0]?.focus(), 50);
    } catch (e) {
      const msg = e instanceof ClientApiError ? e.message : "发送失败，请稍后重试";
      if (step === 1) setEmailErr(msg); else toast(msg);
    } finally { setBusy(false); }
  }

  async function login(code: string) {
    if (code.length < 6 || dead) return;
    setBusy(true);
    try {
      await api("/api/auth/verify", { method: "POST", json: { email: email.trim(), code } });
      resetMeCache();
      router.replace(safeNext(params.get("next")));
    } catch (e) {
      const err = e as ClientApiError;
      setCodeErr(err.message);
      if (err.code === "too_many" || err.code === "expired" || err.code === "no_code") setDead(true);
      setDigits(Array(6).fill(""));
      setTimeout(() => boxes.current[0]?.focus(), 50);
    } finally { setBusy(false); }
  }

  function onDigit(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = digits.slice(); next[i] = d; setDigits(next);
    if (d && i < 5) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) login(next.join(""));
  }
  function onPaste(e: React.ClipboardEvent) {
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!t) return;
    e.preventDefault();
    const next = Array(6).fill("").map((_, k) => t[k] ?? "");
    setDigits(next); boxes.current[Math.min(t.length, 5)]?.focus();
    if (t.length === 6) login(t);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Logo size={56} /></div>
        <h1 className="login-title">AI加词</h1>
        <p className="login-sub">用邮箱验证码登录，首次登录自动注册</p>
        {step === 1 ? (
          <div>
            <div className="field">
              <label htmlFor="email">邮箱</label>
              <input className={"input" + (emailErr ? " error" : "")} id="email" type="email" placeholder="you@example.com" autoComplete="email" inputMode="email"
                value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
              {emailErr && <div className="err-msg">{emailErr}</div>}
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={send} disabled={busy}>{busy ? "发送中…" : "发送验证码"}</button>
            <p className="small muted center mt-12" style={{ marginBottom: 0 }}>无需密码，登录后 {sessionDays} 天内免登录</p>
          </div>
        ) : (
          <div>
            <div className="field">
              <label>验证码已发送至 <b style={{ color: "var(--text)" }}>{email.trim()}</b> <a href="#" className="small" onClick={(e) => { e.preventDefault(); setStep(1); }}>修改</a></label>
              <div className="hint">请输入邮件中的 6 位数字验证码</div>
            </div>
            {devCode && <div className="dev-code">开发模式（未配置邮件服务）：验证码 <b>{devCode}</b></div>}
            <div className={"code-boxes" + (codeErr ? " error" : "")} onPaste={onPaste}>
              {digits.map((d, i) => (
                <input key={i} ref={(el) => { boxes.current[i] = el; }} maxLength={1} inputMode="numeric" value={d} disabled={dead || busy}
                  onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus(); }} />
              ))}
            </div>
            {codeErr && <div className="err-msg">{codeErr}</div>}
            <button className="btn btn-primary btn-lg btn-block mt-16" disabled={busy || dead || digits.some((d) => !d)} onClick={() => login(digits.join(""))}>{busy ? "登录中…" : "同意并登录"}</button>
            <div className="center mt-12">
              <button className="btn btn-ghost btn-sm" disabled={left > 0 || busy} onClick={send}>{left > 0 ? `重新发送（${left}s）` : "重新发送验证码"}</button>
            </div>
          </div>
        )}
        <p className="legal">点击「同意并登录」即表示你已阅读并同意 <Link href="/legal/terms">服务条款</Link> 与 <Link href="/legal/privacy">隐私政策</Link></p>
      </div>
    </div>
  );
}

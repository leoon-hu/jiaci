"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { api, ClientApiError } from "@/lib/client/api";
import { resetMeCache } from "@/lib/client/useMe";
import "./login.css";

function safeNext(n: string | null): string {
  return n && /^\/(?![/\\])/.test(n) ? n : "/home";
}

export default function ApiKeyLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!apiKey || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/api-key-login", { method: "POST", json: { apiKey } });
      resetMeCache();
      setApiKey("");
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "登录失败，请稍后重试");
      setApiKey("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Logo size={56} /></div>
        <h1 className="login-title">AI加词</h1>
        <p className="login-sub">私有实例 · 使用访问密钥登录</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="access-key">访问密钥（API Key）</label>
            <input id="access-key" className="input" type="password"
              placeholder="粘贴私有访问密钥" autoComplete="off" autoFocus
              value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              disabled={busy} required maxLength={256} />
          </div>
          {error && <div className="err-msg" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" type="submit"
            disabled={busy || !apiKey}>{busy ? "登录中…" : "登录"}</button>
        </form>
      </div>
    </div>
  );
}

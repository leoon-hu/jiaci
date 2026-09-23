"use client";
import { useEffect, useRef, useState } from "react";
import { APP_VERSION, applyUpdate, checkVersion, noteUpdate, reinstall, takeUpdateNote, type UpdateOutcome } from "@/lib/version";

type State = "idle" | "checking" | "latest" | "found" | "slow" | "offline" | "failed" | "installFailed" | "updated" | "reinstalled" | "incomplete" | "reinstalling";

const TEXT: Record<Exclude<State, "idle" | "checking">, (v: string) => string> = {
  latest: () => "✓ 已是最新版本",
  updated: () => "✓ 已更新到最新版本",
  reinstalled: () => "✓ 已清除缓存并重新加载，现在是最新版本",
  found: (v) => `发现新版本 ${v}，正在更新，马上会自动刷新…`,
  slow: () => "新版本还在准备，好了会自动刷新",
  offline: () => "没有联网，连上网再检查",
  failed: () => "没检查成功，稍后再试",
  installFailed: () => "新版本没装上",
  incomplete: () => "更新没有完成，还是旧版本",
  reinstalling: () => "正在清除缓存…",
};
const BUSY: State[] = ["checking", "found", "slow", "reinstalling"];
const CAN_REINSTALL: State[] = ["latest", "failed", "installFailed", "incomplete", "slow"];

/** 重新载入后的结果只取一次（开发模式的 StrictMode 会把 effect 跑两遍，第二遍就取不到了） */
let pageOutcome: UpdateOutcome | null | undefined;

/**
 * 设置「关于」里的「版本」一行（需求 3.5，与另外三个站的版本卡片同一套逻辑，见 lib/version.ts）：
 * 当前版本（构建时刻）+ 「检查更新」；有新版本就让 SW 查一次新的并重新载入，重新载入后这一行滚到眼前说「已更新」或「更新没有完成」；
 * 检查过、慢、失败时多一行「还是旧版？清除缓存重新加载」（先确认连得上服务器再清）。
 */
export default function AppVersion() {
  const [state, setState] = useState<State>("idle");
  const [found, setFound] = useState("");
  const row = useRef<HTMLDivElement>(null);
  const busy = BUSY.includes(state);

  useEffect(() => {
    if (pageOutcome === undefined) pageOutcome = takeUpdateNote(APP_VERSION);
    const outcome = pageOutcome;
    if (!outcome) return;
    pageOutcome = null;
    setState(outcome);
    // 设置页很长、「关于」在最下面：重新载入后回到了顶上，滚过去让人看到结果
    const t = setTimeout(() => row.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    return () => clearTimeout(t);
  }, []);

  async function check() {
    if (busy) return;
    setState("checking");
    const r = await checkVersion(APP_VERSION);
    if (r.kind !== "newer") { setState(r.kind); return; }
    setFound(r.version);
    setState("found");
    noteUpdate("update", r.version);
    setState((await applyUpdate()) === "slow" ? "slow" : "installFailed");
  }

  /** 清缓存前先确认连得上服务器：没网时清了只会更糟 */
  async function redo() {
    if (busy) return;
    setState("reinstalling");
    const r = await checkVersion(APP_VERSION);
    if (r.kind === "offline" || r.kind === "failed") { setState(r.kind); return; }
    noteUpdate("reinstall", r.kind === "newer" ? r.version : APP_VERSION);
    await reinstall();
  }

  const message = state === "idle" || state === "checking" ? "" : TEXT[state](found);
  const tone = ["latest", "updated", "reinstalled"].includes(state) ? "ok" : ["offline", "failed", "installFailed", "incomplete"].includes(state) ? "warn" : "";
  return (
    <div ref={row} className="row setting app-version">
      <div className="main">
        <div className="title">版本</div>
        <div className="desc ver">{APP_VERSION || "开发版"}</div>
        {message && <div className={"ver-status " + tone} role="status">{message}</div>}
        {CAN_REINSTALL.includes(state) && <div className="ver-more">还是旧版？<button type="button" onClick={redo}>清除缓存重新加载</button></div>}
      </div>
      <div className="ctl"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={check}>{state === "checking" ? "检查中…" : busy ? "更新中…" : "检查更新"}</button></div>
    </div>
  );
}

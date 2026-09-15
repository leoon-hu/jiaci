"use client";
import { useEffect, useState } from "react";
import Logo from "./Logo";
import InstallGuide from "./InstallGuide";
import { IconX } from "./Icons";
import { useInstall } from "@/lib/client/install";

const KEY = "aiword.installTip";
const SNOOZE_DAYS = 30;

/**
 * 安装引导横幅（需求 4.1）：只在手机 / 平板上出现，Android 点「安装」直接调起系统安装框，iOS 点「怎么做」弹步骤说明。
 * 关掉（或看过步骤、答复过安装框）后本设备 30 天内不再出现，只记在本地、不随账号。
 */
export default function InstallTip() {
  const inst = useInstall();
  // 挂载前当作已关闭：服务端渲染时读不到 localStorage，首屏先不画、挂载后再决定
  const [snoozed, setSnoozed] = useState(true);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    try { setSnoozed(Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_DAYS * 864e5); } catch { setSnoozed(false); }
  }, []);
  if (snoozed || !inst.mobile || inst.mode === "none") return null;
  const snooze = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setSnoozed(true); };
  return (
    <>
      <div className="install-tip" role="note">
        <Logo size={40} className="logo" />
        <div className="main"><div className="title">把 AI加词 加到主屏幕</div><div className="desc">像 App 一样全屏打开，不用再找网址</div></div>
        {inst.mode === "prompt"
          ? <button type="button" className="btn btn-primary btn-sm" onClick={() => inst.install().finally(snooze)}>安装</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => setGuide(true)}>怎么做</button>}
        <button type="button" className="btn btn-icon sm btn-ghost" onClick={snooze} aria-label="关闭"><IconX /></button>
      </div>
      <InstallGuide open={guide} onClose={() => { setGuide(false); snooze(); }} safari={inst.iosSafari} />
    </>
  );
}

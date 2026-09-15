"use client";
import { useState } from "react";
import Logo from "./Logo";
import InstallGuide from "./InstallGuide";
import { IconX } from "./Icons";
import { useInstall } from "@/lib/client/install";

/**
 * 安装引导横幅（需求 4.1）：学习首页顶部的一条，没装成应用时第一次打开就有。
 * 四个站同一套结构：应用图标 + 粗体「安装 AI加词」+ 一句说明 + 主按钮（安装 / 怎么做）+ ×。
 * 「安装」直接调起系统安装框；「怎么做」弹步骤。关掉 / 关了步骤 / 系统框里拒绝后本设备 3 天内不再出现，只记在本地、不随账号。
 */
export default function InstallTip() {
  const inst = useInstall();
  const [guide, setGuide] = useState(false);
  if (!inst.kind || inst.snoozed) return null;
  const close = () => { setGuide(false); inst.snooze(); };
  return (
    <>
      <aside className="install-tip" role="note" aria-label="安装 AI加词">
        <Logo size={44} className="icon" />
        <div className="main"><div className="title">安装 AI加词</div><div className="desc">像 App 一样全屏打开，不用再找网址</div></div>
        {inst.kind === "prompt"
          ? <button type="button" className="btn btn-primary btn-sm" onClick={() => { void inst.install(); }}>安装</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => setGuide(true)}>怎么做</button>}
        <button type="button" className="btn btn-icon sm btn-ghost" onClick={close} aria-label="关闭安装提示"><IconX /></button>
      </aside>
      <InstallGuide open={guide} onClose={close} kind={inst.kind} iosSafari={inst.iosSafari} ipad={inst.ipad} />
    </>
  );
}

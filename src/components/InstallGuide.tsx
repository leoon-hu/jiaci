"use client";
import Modal from "./Modal";
import { IconShare } from "./Icons";
import { installSteps, type InstallKind } from "@/lib/install";

/**
 * 「怎么做」步骤弹窗（需求 4.1）：首页横幅与设置页共用，按环境列编号步骤——
 * 微信等内嵌浏览器先去浏览器打开；iOS 点分享 → 添加到主屏幕（不在 Safari 里先换 Safari）；其它浏览器走菜单。
 */
export default function InstallGuide({ open, onClose, kind, iosSafari, ipad }: { open: boolean; onClose: () => void; kind: InstallKind | null; iosSafari: boolean; ipad: boolean }) {
  const steps = kind ? installSteps(kind, { iosSafari, ipad, host: typeof location !== "undefined" ? location.host : "" }) : [];
  return (
    <Modal open={open} onClose={onClose}>
      <h3>添加到主屏幕</h3>
      <p>像 App 一样全屏打开，不用再找网址。</p>
      <ol className="install-steps">{steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span>{s.text}{s.share && <span className="ico"><IconShare /></span>}</span></li>)}</ol>
      <div className="actions"><button type="button" className="btn btn-primary" onClick={onClose}>知道了</button></div>
    </Modal>
  );
}

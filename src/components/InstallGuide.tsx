"use client";
import Modal from "./Modal";
import { IconPlusSquare, IconShare } from "./Icons";

/**
 * iOS 的安装步骤说明（需求 4.1）：系统没有安装接口，只能让用户在 Safari 里点分享 → 添加到主屏幕。
 * 不在 Safari 里（iOS 上的 Chrome、微信等）时第一步先让用户换 Safari 打开本站。
 */
export default function InstallGuide({ open, onClose, safari }: { open: boolean; onClose: () => void; safari: boolean }) {
  const steps: React.ReactNode[] = [];
  if (!safari) steps.push(<>先用 <b>Safari</b> 打开本站{typeof location !== "undefined" && <>（{location.host}）</>}</>);
  steps.push(
    <>点底部工具栏的分享按钮 <span className="ico"><IconShare /></span>（iPad 在右上角）</>,
    <>在菜单里向下找到 <span className="ico"><IconPlusSquare /></span>「添加到主屏幕」</>,
    <>点右上角「添加」，主屏幕上就会出现 AI加词 的图标</>,
  );
  return (
    <Modal open={open} onClose={onClose}>
      <h3>添加到主屏幕</h3>
      <p>加到主屏幕后会像 App 一样全屏打开，不用再找网址。</p>
      <ol className="install-steps">{steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>)}</ol>
      <div className="actions"><button type="button" className="btn btn-primary" onClick={onClose}>知道了</button></div>
    </Modal>
  );
}

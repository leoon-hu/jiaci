"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { copyText, shareMessage, shareWay, siteRoot, type ShareWay } from "@/lib/share";
import { SHARE_TEXT, SITE_URL } from "@/lib/sites";

interface Panel {
  way: Exclude<ShareWay, "native">;
  message: string;
  copied: boolean;
}

/**
 * 「分享给朋友」（需求 4.1「开源与分享」）：页脚、设置「关于」、学完页共用。
 * 有系统分享面板直接弹（用户取消不算错）；微信里弹窗教用右上角菜单；其它环境复制一段话 + 链接并弹窗。
 * text 不传就是站点的一句话介绍，传了就是这一刻的内容（比如今天学了多少），后面都跟着站点链接。
 */
export default function ShareButton({ text = SHARE_TEXT, className, children }: { text?: string; className?: string; children: React.ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null);

  async function share() {
    const way = shareWay({ ua: navigator.userAgent, canShare: typeof navigator.share === "function" });
    const url = siteRoot(location.href, SITE_URL);
    const message = shareMessage(text, url);
    if (way === "native") {
      try {
        await navigator.share({ title: "AI加词", text, url });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
      setPanel({ way: "copy", message, copied: await copyText(message) });
      return;
    }
    setPanel({ way, message, copied: way === "copy" ? await copyText(message) : false });
  }

  async function copy() {
    if (!panel) return;
    setPanel({ ...panel, copied: await copyText(panel.message) });
  }

  return (
    <>
      <button type="button" className={className} onClick={share}>{children}</button>
      <Modal open={!!panel} onClose={() => setPanel(null)}>
        <h3>分享给朋友</h3>
        <p>{panel?.way === "wechat" ? "点右上角的「···」，选「发送给朋友」或「分享到朋友圈」。" : panel?.copied ? "已经复制好了，粘贴给朋友就行：" : "把下面这段话发给朋友就行："}</p>
        <pre className="share-message">{panel?.message}</pre>
        <div className="actions">
          {panel?.way === "copy" && <button className="btn btn-primary" onClick={copy}>{panel.copied ? "已复制" : "复制"}</button>}
          <button className="btn btn-secondary" onClick={() => setPanel(null)}>知道了</button>
        </div>
      </Modal>
    </>
  );
}

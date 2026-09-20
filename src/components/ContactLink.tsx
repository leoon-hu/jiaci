"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { AUTHOR_CONTACT } from "@/lib/sites";

/** 「联系站长」弹窗（需求 4.1「站长联系方式」）：站长微信二维码 + 一句怎么加；页脚与设置「关于」共用 */
export function ContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h3>{AUTHOR_CONTACT.label}</h3>
      <p>{AUTHOR_CONTACT.hint}</p>
      <div className="contact-qr">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AUTHOR_CONTACT.qr} alt="站长微信二维码" width={220} height={302} loading="lazy" />
      </div>
      <div className="actions"><button className="btn btn-secondary" onClick={onClose}>知道了</button></div>
    </Modal>
  );
}

/** 页脚里的「联系站长」：长得像页脚其它链接的一个按钮，点了弹二维码 */
export default function ContactLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>{AUTHOR_CONTACT.label}</button>
      <ContactModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

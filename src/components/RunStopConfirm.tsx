"use client";
import Modal from "./Modal";
import { stop } from "@/lib/client/run-player";

/**
 * 跑步模式（需求 3.2.6）的停止二次确认：停止会丢掉这次准备好的整段音频，再听要重新下载，
 * 跑步中隔着口袋误触一下就前功尽弃，所以跑步页与主框架小条的「停止」都先问一句。
 */
export default function RunStopConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h3>停止跑步模式？</h3>
      <p>停止后这次准备好的音频会被清掉，再听要重新准备。只是暂时不想听的话，用暂停就可以。</p>
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
        <button type="button" className="btn btn-danger" onClick={() => { stop(); onClose(); }}>停止</button>
      </div>
    </Modal>
  );
}

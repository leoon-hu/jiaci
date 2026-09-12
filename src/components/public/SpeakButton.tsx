"use client";
import { speakSentence, speakWord } from "@/lib/client/speech";
import { IconSpeaker } from "@/components/Icons";

/**
 * 公开词条页的发音按钮：固定美音女声。走的还是 lib/client/speech 那条链（服务端音频 → 失败退到 Web Speech），
 * 音频接口需要登录时匿名访客自然落到 Web Speech，接口开放匿名读取后不用改这里。
 */
export default function SpeakButton({ text, sentence = false, className = "btn btn-icon sm btn-soft" }: { text: string; sentence?: boolean; className?: string }) {
  return (
    <button className={className} type="button" aria-label={sentence ? "朗读例句" : "发音"} onClick={() => (sentence ? speakSentence(text, "us_female") : speakWord(text, "us_female"))}>
      <IconSpeaker />
    </button>
  );
}

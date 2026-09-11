/** 常用功能词：点词弹框 / 着色不为其触发 AI 生成（控制成本），仅显示灰色「未加入」 */
const LIST = `a an the and or but if then else so as of at by for from in into on onto to with without about above across after against along among around before behind below beneath beside between beyond during except inside near off out outside over past since through throughout till toward towards under until up upon within
i me my mine myself we us our ours ourselves you your yours yourself yourselves he him his himself she her hers herself it its itself they them their theirs themselves who whom whose which what that this these those
am is are was were be been being have has had having do does did doing done will would shall should can could may might must ought
not no nor yes very too also just only even still yet again ever never always often sometimes here there where when why how all any both each few more most other some such than
s t re ve ll d m`;
const SET = new Set(LIST.split(/\s+/).filter(Boolean));
export const isStopword = (w: string) => SET.has(w.toLowerCase());

/**
 * 同一作者的另外三个学习站：落地页 / 公开页页脚与设置「关于」里互相链接（四个站各有一份同样的名单，改了要一起改）。
 * 顺序固定：AI加词 → 同步练 → 拼音学习机 → 识字卡片，本站不列自己。
 */
export interface SisterSite {
  name: string;
  /** 一句话说明，给不认识这个名字的人 */
  desc: string;
  url: string;
}

export const SISTER_SITES: SisterSite[] = [
  { name: "同步练", desc: "人教版小学同步练习", url: "https://tongbulian.jiaci.app" },
  { name: "拼音学习机", desc: "拼音点读、拼读、测验", url: "https://pinyin.jiaci.app" },
  { name: "识字卡片", desc: "2–4 岁看图听音认知卡片", url: "https://kapian.jiaci.app" },
];

/**
 * 站长联系方式（需求 4.1「站长联系方式」，2026-09-21 四个站统一）：一张微信二维码，
 * 页脚 / 设置「关于」里点「联系站长」弹出来看；图片在 public/，四个站各放一份同一张图。
 */
export const AUTHOR_CONTACT = {
  label: "联系站长",
  qr: "/wechat-qrcode.jpg",
  hint: "用微信扫一扫（手机上长按二维码识别）加站长微信，有问题、建议或想要的功能都欢迎直接说。",
} as const;

/** 本站的公开地址与源码仓库（需求 4.1「开源与分享」）：落地页 / 页脚「GitHub」、分享出去的链接兜底都用它 */
export const SITE_URL = "https://jiaci.app";
export const REPO_URL = "https://github.com/leoon-hu/jiaci";
/** 页脚与设置「关于」里的「开源」一句（落地页的开源声明是另一段更长的，文案与 README 同步） */
export const OPEN_CLAIM = "代码与数据结构全部以 MIT 开源，谁都能查、也能自己部署；免费、无广告、不卖数据，学习记录随时导出、账号随时注销。";
/** 「分享给朋友」发出去的一句话（后面跟站点链接） */
export const SHARE_TEXT = "AI加词：精简、高效的背单词网站——FSRS 间隔重复、AI 填充的词条资料、真人级发音，21 本内置词库。免费、开源、无广告。";

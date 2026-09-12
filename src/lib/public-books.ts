/**
 * 公开词库页（/dict/book/<slug>）用的内置词库清单：slug 与介绍文字。
 * 内置词库在库里只有名字（wordbooks:build 与内容同步都按名字对齐，主键两边各自生成），
 * 所以 slug 不进表、写在这里按名字对应；改名要同步改这里，构建脚本会提醒漏掉的词库。
 */
export type PublicBook = { slug: string; name: string; blurb: string };

const life = (slug: string, title: string, blurb: string): PublicBook => ({ slug: `life-${slug}`, name: `海外生活 · ${title}`, blurb });

export const PUBLIC_BOOKS: PublicBook[] = [
  { slug: "core", name: "高频核心", blurb: "按当代语料词频排出的最常用 1000 词，去掉了功能词、缩写、专名与规则变形，英美拼写只留美式。任何阶段都该先过一遍。" },
  { slug: "core-plus", name: "高频进阶", blurb: "词频第 1001–3000 位的常用词。掌握前 3000 词，日常阅读与对话的覆盖率就能过八成。" },
  { slug: "core-extended", name: "高频拓展", blurb: "词频第 3001 位起的常用词，并入牛津 3000 与柯林斯星级核心词。作为高频系列的最后一本。" },
  { slug: "zhongkao", name: "中考词汇", blurb: "ECDICT 中考标签与公开中考大纲词表的并集，按词频排序；另收常用国名地名。" },
  { slug: "gaokao", name: "高考词汇", blurb: "ECDICT 高考标签与公开高考大纲词表的并集，按词频排序；另收常用国名地名。" },
  { slug: "cet4", name: "四级词汇", blurb: "大学英语四级：ECDICT 标签与公开大纲词表的并集，按词频排序。" },
  { slug: "cet6", name: "六级词汇", blurb: "大学英语六级：ECDICT 标签与六级新增词表的并集，按词频排序。" },
  { slug: "kaoyan", name: "考研词汇", blurb: "考研英语：ECDICT 标签与公开考研大纲词表的并集，按词频排序。" },
  { slug: "toefl", name: "托福词汇", blurb: "托福：ECDICT 标签与公开托福词表，并入学术词表 AWL、NAWL 与通用核心词表 NGSL，按词频排序。" },
  { slug: "ielts-core", name: "雅思核心", blurb: "雅思词汇里最常用的部分：词频排名 8500 以内，或带牛津 3000 / 柯林斯 3 星以上标记，约 6000 词。先学这本，再学完整的雅思词汇。" },
  { slug: "ielts", name: "雅思词汇", blurb: "雅思：ECDICT 标签与公开雅思词表，并入 AWL、NAWL、NGSL 与雅思话题词，按词频排序，末尾附雅思常见短语。" },
  { slug: "gre", name: "GRE 词汇", blurb: "GRE：ECDICT 标签与公开 GRE 词表的并集，按词频排序。" },
  { slug: "academic", name: "学术词汇", blurb: "学术词表 AWL（570 词族按 sublist 顺序及其派生词）加 NAWL，留学与学术写作的基础词汇。" },
  { slug: "phrases", name: "常用短语", blurb: "常用动词短语与固定搭配，再加牛津标记或柯林斯 2 星以上的短语。" },
  { slug: "compounds", name: "常用词组", blurb: "带词典信号（考试标签、牛津、柯林斯）或出现在场景词表里的复合名词与词组。" },
  life("housing", "租房与家居", "在海外租房、签约、报修、家居用品与水电网络会用到的词。"),
  life("health", "看病与药房", "预约、症状描述、检查、处方与药房常见词。"),
  life("banking", "银行税务办事", "开户、转账、贷款、报税与政府办事窗口的词。"),
  life("work", "职场与邮件", "职场沟通、会议、绩效与英文邮件里的常用词。"),
  life("school", "孩子上学", "报名、家长会、作业、课外活动与学校通知里的词。"),
  life("digital", "数字生活", "账号、订阅、网购、外卖、社交与设备设置里的词。"),
];

const BY_SLUG = new Map(PUBLIC_BOOKS.map((b) => [b.slug, b]));
const BY_NAME = new Map(PUBLIC_BOOKS.map((b) => [b.name, b]));
export const bookBySlug = (slug: string): PublicBook | undefined => BY_SLUG.get(slug);
export const bookByName = (name: string): PublicBook | undefined => BY_NAME.get(name);

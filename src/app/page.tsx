import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Logo from "@/components/Logo";
import SiteFooter from "@/components/public/SiteFooter";
import { REPO_URL as REPO } from "@/lib/sites";
import "./landing.css";

/** 落地页的三张截图（public/shots/，由 `npm run readme:shots` 生成，README 也用同一批） */
const SHOTS = [
  { src: "/shots/study.png", caption: "学习卡片：点击显示答案，认识 / 模糊打分" },
  { src: "/shots/word.png", caption: "单词详情：释义 / 关联词 / 记忆 / 词频" },
  { src: "/shots/wordbook.png", caption: "单词列表：四色状态，拖动一行直接操作" },
  { src: "/shots/run.png", caption: "跑步模式：熄屏放口袋，循环听今天的词" },
];

/** 对外定位的五点（需求 1.1）：README 的「特点」一节与这里是同一套话 */
const PILLARS = [
  { title: "功能完整", text: "FSRS 间隔重复、21 本内置词库与导入 / 自建、学习卡与单词详情、列表拖拽与自测、跑步模式、公开词典、装成应用、深色模式、数据导出。" },
  { title: "数据完善", text: "2.8 万个单词与短语，每个词有词典字段与 AI 填充的十几个学习维度；单词、例句、中文释义与例句译文全部有真人级发音。" },
  { title: "操作易用", text: "邮箱验证码登录，每次只答「认识 / 模糊」，长按上滑已掌握，拖动一行直接操作；手机与桌面一套代码。" },
  { title: "免费开源", text: "MIT 许可，代码、数据库结构、词条字段、词表与离线脚本全部公开，谁都能查、也能自己部署；免费、无广告。" },
  { title: "干净安全", text: "不卖数据、没有社交与打卡、只收邮箱一项信息；学习记录随时导出，账号随时注销，运行时不调用任何 AI 接口。" },
];

const FEATURES = [
  { title: "FSRS 间隔重复", text: "按目标记忆保持率安排复习：难词密、简单词疏，间隔达到阈值自动转为已掌握。每次只需回答「认识」或「模糊」。" },
  { title: "21 本内置词库", text: "高频核心 / 进阶 / 拓展，中高考、四六级、考研、托福、雅思、GRE，学术词汇、常用短语与词组，以及租房、看病、银行、职场、孩子上学、数字生活六本海外场景词库；也可以导入 txt 或手动添加。" },
  { title: "AI 填充的词条资料", text: "核心义、义项、例句、搭配、句型、辨析、词族、助记、词源——离线生成、全局共用，浏览时不用等任何模型；词条与内置词库公开可查，不用登录。" },
  { title: "真人级发音", text: "英美口音 × 男女声四种组合，单词、例句、中文释义与例句译文都能朗读；学习卡片可自动朗读，缺失的发音按需合成。" },
  { title: "列表就是工具", text: "四色状态一眼看清进度；隐藏释义 / 隐藏英文两种自测；横向拖动一行就能打分或移出，长按多选，几秒内可撤销。" },
  { title: "手机与桌面一套", text: "加到手机主屏当应用用，桌面端有快捷键；深色模式、数据导出、随时注销。" },
];

/**
 * 站点入口：已登录直接进首页；未登录看到的是落地页——对搜索引擎与分享链接来说这是唯一能看到内容的一页，
 * 文案与 README 保持一致（需求 4.1「对外文案与落地页」：功能完整 / 数据完善 / 操作易用 / 免费开源 / 干净安全五点 + 跑步模式一节）。
 */
export default async function Index() {
  const user = await getCurrentUser();
  if (user) redirect("/home");
  return (
    <div className="land">
      <header className="land-top">
        <Link className="brand" href="/"><Logo size={28} />AI加词</Link>
        <nav className="land-nav">
          <Link href="/dict">词典</Link>
          <a href={REPO} target="_blank" rel="noopener">GitHub</a>
          <Link className="btn btn-primary btn-sm" href="/login">登录</Link>
        </nav>
      </header>

      <main>
        <section className="land-hero">
          <h1>功能完整、免费开源的背单词网站</h1>
          <p className="land-lead">FSRS 间隔重复安排复习，21 本内置词库，AI 填充的词条资料，真人级发音；跑步模式熄屏放口袋也能循环听今天的词。<br />数据完善、操作易用、无广告、不卖数据；仅中文界面，为海外的英语学习者而做。</p>
          <div className="land-cta">
            <Link className="btn btn-primary btn-lg" href="/login">邮箱登录，开始学习</Link>
            <a className="btn btn-secondary btn-lg" href={REPO} target="_blank" rel="noopener">查看源码</a>
          </div>
          <p className="land-open">
            <strong>代码与数据结构全部开源（MIT）</strong>：应用源码、数据库表结构、词条字段定义、内置词库词表与离线脚本都在 <a href={REPO} target="_blank" rel="noopener">GitHub</a> 上，谁都能查、可以自行部署一套。免费、无广告、不卖数据，学习记录随时导出、账号随时注销。
          </p>
          <p className="small muted">无需密码，邮箱验证码登录，首次登录自动注册。所有词条与内置词库<Link href="/dict">公开可查</Link>，不用登录</p>
        </section>

        <section className="land-pillars" aria-label="五个特点">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </section>

        <section className="land-shots" aria-label="界面截图">
          {SHOTS.map((s) => (
            <figure key={s.src}>
              {/* 截图是现成的 PNG，直接按原图发，不经图片优化器 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.caption} width={780} height={1688} loading="lazy" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </section>

        <section className="land-features">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </section>

        <section className="land-run card">
          <div className="land-run-text">
            <h2>跑步模式：熄屏放口袋，循环听今天的词</h2>
            <p>戴上耳机跑步、走路、通勤时打开跑步模式：把今天要学和已学的词（每轮 30 / 50 / 100 / 150 个可选）连同中文释义、1–3 条例句拼成一整段音频循环播放。开跑前一次下载好，之后不再碰网络；手机熄屏、切到别的应用都不停。</p>
            <ul>
              <li>例句中英对照、句中本词高亮；可只读英文，或英文后接中文译文</li>
              <li>锁屏与通知栏的媒体控件、耳机线控都能暂停、切上一个 / 下一个</li>
              <li>单词、音标、释义、例句撑满一屏，字大按钮大，跑步时看一眼就清楚；可保持屏幕常亮</li>
              <li>每个词读几遍、词间间隔、语速、例句读法随时改，改完接着播</li>
            </ul>
          </div>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shots/run.png" alt="跑步模式播放页" width={780} height={1688} loading="lazy" />
          </figure>
        </section>

        <section className="land-why card">
          <h2>为什么做这个</h2>
          <p>做一个边上班边学英语背单词的好工具。试过很多背单词应用，也开过会员，总有不满意的地方，于是自己动手做了一个：把背单词该有的功能做全、数据做完善，把复习交给算法，把词条资料一次做好给所有人共用，不放广告、不卖数据。</p>
          <p>词典数据来自 ECDICT，词表参照公开大纲与 NGSL / NAWL / AWL 整理，调度算法是 FSRS——代码与数据结构（数据库表、词条字段、词表）都以 MIT 许可放在 <a href={REPO} target="_blank" rel="noopener">GitHub</a> 上，欢迎自行部署或提意见。</p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

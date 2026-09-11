# AI加词

精简版背单词网站：内置 / 导入词库 → 每日按计划学习 → 认识 / 模糊打分 → 间隔重复安排复习。词条的核心义、义项、例句、搭配、辨析、词族、助记、词源由 AI 离线填充、全局共用；用户可以写备注和反馈问题，不修改词条本身。仅中文界面，面向海外英语学习者。

Next.js 15（App Router）+ TypeScript + Prisma + PostgreSQL 16，前后端同仓，应用就是仓库根目录。


## 设计初衷

做一个边上班边学英语背单词的好工具。
尝试过众多背单词应用，也开通过会员，不过或多或少都不太满意，所以手搓了一个，力求简洁高效，满足个人学习需求。
后期可能会尝试收取一些费用或加少量广告，作为服务器和 AI 费用的补贴。


## 功能概览

| 模块 | 内容 |
|---|---|
| 登录 | 邮箱验证码，首次登录自动注册；长期登录，活跃自动续期 |
| 学习 | 今日任务（新词 + 到期复习）→ 学习卡片（点击显示答案）→ 打分：认识 / 模糊，长按上滑 已掌握 / 重新记 → 今日完成、再学一组 |
| 单词详情 | 四个 Tab（释义 / 关联词 / 记忆 / 词频）；点词弹出发音与释义，备注、反馈、学习记录时间线、例句朗读、自动朗读 |
| 词库 | 三个 Tab（正在学习 / 我的词库 / 内置词库），内置 / 导入 / 自建三类；列表用进度饼图表示状态，左右滑动露出「取消 / 重新记 / 已掌握 / 移出」；导入 txt、手动添加 |
| 设置 | 每日新词量、复习上限、学习顺序、口音、声音、朗读、主题、词条资料来源、导出数据、注销 |

学习算法用 FSRS（`ts-fsrs`）：按目标记忆保持率安排复习，难词密、简单词疏，间隔达到阈值自动转为已掌握。

## 目录结构

```
prisma/          数据模型、迁移与种子
src/lib/         领域逻辑（scheduler.ts 调度、study.ts 队列与打分、dict.ts 词典、
                 word-view.ts 词条视图、ai/ 字段契约、tts/ 发音、auth.ts 登录）
src/app/         api/ 为 Route Handlers，(app)/ 为登录后页面
src/components/  共用组件
scripts/         离线脚本：词典导入、内置词库构建、AI 字段填充、发音音频生成、定期清理
lists/           内置词库的词表文件
tests/ e2e/      单元测试、端到端与截图脚本
```

## 本地开发

需要 Node.js 20+、Docker（或任意 PostgreSQL 16）。

```bash
# 1. 数据库
docker run -d --name aiword-pg \
  -e POSTGRES_PASSWORD=aiword -e POSTGRES_USER=aiword -e POSTGRES_DB=aiword \
  -p 127.0.0.1:5432:5432 postgres:16-alpine

# 2. 应用（在项目根目录）
cp .env.example .env        # 按需填写各项
npm install
npx prisma migrate deploy   # 建表
npm run db:seed             # 系统配置初始值
npm run dev                 # http://localhost:3000
```

| 命令 | 说明 |
|---|---|
| `npm run dev` / `build` / `start` | 开发 / 构建 / 生产启动 |
| `npm test` | 单元测试（算法、原形匹配、导入解析、状态判定） |
| `npm run typecheck` / `npm run lint` | 类型与代码检查 |
| `npm run e2e` | 端到端 UI 测试（需先 `npm run dev`，使用本机 Chrome） |
| `npm run e2e:shots [-- 1280 900]` | 全页面截图回归，默认手机视口 |

词典导入、内置词库构建、AI 字段填充、音频生成都是 `scripts/` 下的离线脚本，见 `package.json` 的 scripts。

## 设计要点

- **应用运行时不调用 AI**：词条的 AI 资料由离线脚本按学习维度拆成字段、经 zod 契约校验后写库，按模型厂商分表、全局共用；没有 AI 资料的词用词典字段兜底显示。
- **发音**：单词与例句播放服务端 MP3（预生成，缺失时按需合成），播放失败兜底浏览器 Web Speech。
- **可运营调整的参数集中在数据库配置表**，改库即生效，无需发版；密钥只放环境变量。
- **算法与状态是纯函数**：调度与四色状态判定都在 `src/lib/` 里，可单测覆盖。
- 样式是一套 CSS 变量体系（未用 Tailwind），支持浅色 / 深色主题、手机底部 Tab 与桌面顶部导航。

## 许可

[MIT](LICENSE)

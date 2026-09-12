import { Prisma, type StudySource } from "@prisma/client";
import { wordFreq, type WordFreq } from "./dict";
import { wordCore, wordView, type WordView, type DictPart } from "./word-view";
import { AI_CARD_SELECT, aiDetailSelect, aiProvidersWithData, aiRowOf, isFullAiRow, pickAi, type AiPreference, type WordAiRelations, AI_PROVIDERS, type AiProvider } from "./ai/providers";
import { prisma } from "./db";
import { ApiError } from "./api";
import { getConfig, getConfigInt } from "./config";
import { applyRating, doneTodayIds, isDone, NEW_PROGRESS, rateLabels, type ProgressState, type RateResult, type SchedulerOptions } from "./scheduler";
import { deriveStatus, pieProgress, type WordStatus } from "./status";
import { fromDate, toDate } from "./dates";
import { getSettings } from "./settings";

/** ---------- 通用查询 ---------- */

export async function getCurrentWordbookId(userId: string): Promise<string | null> {
  const c = await prisma.userCurrentWordbook.findUnique({ where: { userId } });
  return c?.wordbookId ?? null;
}

export function toProgressState(p: { interval: number; stability: number | null; difficulty: number | null; reps: number; lapses: number; status: ProgressState["status"]; dueDate: Date | null; lastReview: Date | null } | null): ProgressState {
  if (!p) return { ...NEW_PROGRESS };
  return { interval: p.interval, stability: p.stability, difficulty: p.difficulty, reps: p.reps, lapses: p.lapses, status: p.status, dueDate: fromDate(p.dueDate), lastReview: fromDate(p.lastReview) };
}

/** FSRS 参数（需求 3.2.4）：目标保持率、已掌握阈值、个性化权重，都在 system_config 里 */
export async function schedulerOptions(): Promise<SchedulerOptions> {
  const retention = Number(await getConfig("study.retention"));
  const master = await getConfigInt("study.master_interval");
  let w: number[] | undefined;
  try {
    const raw = await getConfig("study.fsrs_params");
    const arr: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length >= 17 && arr.every((x) => typeof x === "number")) w = arr as number[];
  } catch { /* 配置不合法就用默认参数 */ }
  return { retention: retention > 0 && retention < 1 ? retention : undefined, masterInterval: master > 0 ? master : undefined, w };
}

/** 单词在当前用户视角下的状态 */
export async function wordStatusFor(userId: string, wordId: string): Promise<{ status: WordStatus; progress: ProgressState; inCurrentBook: boolean }> {
  const bookId = await getCurrentWordbookId(userId);
  const [p, member] = await Promise.all([
    prisma.userWordProgress.findUnique({ where: { userId_wordId: { userId, wordId } } }),
    bookId ? prisma.wordbookWord.findUnique({ where: { wordbookId_wordId: { wordbookId: bookId, wordId } } }) : null,
  ]);
  const progress = toProgressState(p);
  const inCurrentBook = !!member;
  return { status: deriveStatus({ progressStatus: p?.status ?? null, inCurrentBook }), progress, inCurrentBook };
}

/** ---------- 单词详情（3.2.5） ---------- */

export type WordDetail = {
  id: string; spelling: string; display: string | null;
  /** 有本词资料的厂商（按 AI_PROVIDERS 顺序），详情页顶部的来源切换用 */
  aiAvailable: AiProvider[];
  /** 词条展示视图：词典字段 + AI 字段，含兜底 */
  view: WordView;
  /** 词频 Tab：当代语料 / BNC 排名、柯林斯星级、牛津 3000、考试标签 */
  freq: WordFreq;
  status: WordStatus; progress: ProgressState; labels: { know: string; fuzzy: string };
  note: string | null;
  history: Array<{ d: string; r: RateResult; i: number }>;
  bookName: string | null;
};

/** 洗牌（Fisher-Yates）：详情页的例句每次进入都换个顺序，自动朗读读到的那一条也就跟着变 */
function shuffled<T>(xs: readonly T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 详情：按用户设置的资料来源取该词的 AI 行（word_ai_*），没有就词典兜底 */
export async function buildWordDetail(userId: string, word: DictPart & { id: string; spelling: string; display?: string | null; frq?: number | null; bnc?: number | null; collins?: number | null; oxford?: boolean; tags?: string[] }, today?: string): Promise<WordDetail> {
  // 设置先取（走请求级缓存，不查库）：知道要看哪家，才能只取那一家的整行
  const settings = await getSettings(userId);
  const primary: AiProvider = settings.aiProvider === "auto" ? AI_PROVIDERS[0] : settings.aiProvider;
  const [st, note, logs, bookId, ai] = await Promise.all([
    wordStatusFor(userId, word.id),
    prisma.userWordNote.findUnique({ where: { userId_wordId: { userId, wordId: word.id } } }),
    prisma.studyLog.findMany({ where: { userId, wordId: word.id }, orderBy: [{ studyDate: "asc" }, { studiedAt: "asc" }], take: 200 }),
    getCurrentWordbookId(userId),
    prisma.word.findUnique({ where: { id: word.id }, select: aiDetailSelect(primary) }),
  ]);
  const aiAvailable = ai ? aiProvidersWithData(ai) : [];
  // 选中哪一家：与 pickAi 一致——auto 取第一家有资料的，指定厂商没资料就退回词典
  const provider = settings.aiProvider === "auto" ? aiAvailable[0] ?? null : aiAvailable.includes(settings.aiProvider) ? settings.aiProvider : null;
  let row = provider ? aiRowOf(ai!, provider) : null;
  // auto 且首选厂商没有这个词时才会走到（现在是 DeepSeek 优先，只有 OpenAI 独有的词才补这一次查询）
  if (provider && !isFullAiRow(row)) {
    const full = await prisma.word.findUnique({ where: { id: word.id }, select: aiDetailSelect(provider) });
    row = full ? aiRowOf(full, provider) : null;
  }
  const book = bookId ? await prisma.wordbook.findUnique({ where: { id: bookId }, select: { name: true } }) : null;
  const view = wordView(word, isFullAiRow(row) ? row : null, provider);
  // 例句每次请求随机排序：自动朗读只读第一条，换个顺序就等于换一条例句（需求 3.2.5）
  view.examples = shuffled(view.examples);
  return {
    id: word.id, spelling: word.spelling, display: word.display ?? null, view,
    aiAvailable,
    freq: wordFreq(word),
    // 打分按钮的天数按客户端日期算，否则和实际打分用的日期差一天（审计 F026）
    status: st.status, progress: st.progress, labels: rateLabels(st.progress, await schedulerOptions(), today),
    note: note?.note ?? null,
    history: logs.map((l) => ({ d: fromDate(l.studyDate)!, r: l.result, i: l.nextInterval })),
    bookName: book?.name ?? null,
  };
}

/** ---------- 打分（3.2.4） ---------- */

export type RateOutcome = Awaited<ReturnType<typeof rateWord>>;

/**
 * 打分：整段放在一个事务里，并按 (用户, 词) 加咨询锁——
 * 原来是「读进度 → 算 → 写」三步分开，同一个词的并发打分（离线补交、多标签页）会互相覆盖，
 * clientTs 幂等也是先查后插，并发时后到的那条撞唯一键变成 500（审计 F175）。
 * preview = true 时只算不写：守卫、调度都照常走，返回值与真打分一模一样，但进度与学习记录都不落库——
 * 单词列表的「加进度」靠它先拿到结果本地显示，撤销期过后再用同一个 clientTs 真正提交。
 */
export async function rateWord(userId: string, wordId: string, result: RateResult, today: string, clientTs?: string, source: StudySource = "study", preview = false) {
  const opts = await schedulerOptions();
  // 「今天」一律按客户端本地日期存的 study_date 算，不用服务器 UTC 时刻（审计 F035）
  const studyDate = toDate(today)!;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${wordId}`}))`;
      // 幂等：同一 clientTs 重复提交直接返回当前进度
      if (clientTs) {
        const dup = await tx.studyLog.findUnique({ where: { userId_clientTs: { userId, clientTs } } });
        if (dup) {
          const p = await tx.userWordProgress.findUnique({ where: { userId_wordId: { userId, wordId } } });
          return { progress: toProgressState(p), nextInterval: dup.nextInterval, requeueToday: dup.nextInterval === 0 && (dup.result === "fuzzy" || dup.result === "reset"), duplicate: true, skipped: null as string | null };
        }
      }
      const existing = await tx.userWordProgress.findUnique({ where: { userId_wordId: { userId, wordId } } });
      // 已移出 / 已掌握的词不能被一张过期的队列用「认识 / 模糊」悄悄拉回学习中（审计 F176）
      if ((result === "know" || result === "fuzzy") && (existing?.status === "removed" || existing?.status === "mastered")) {
        return { progress: toProgressState(existing), nextInterval: -1, requeueToday: false, duplicate: false, skipped: existing.status as string | null };
      }
      // 同一个词当天已经打过「认识 / 已掌握」，再打一次「认识」不重复记（多标签页、多设备用旧队列，审计 NU06）。
      // 只看今天最后一条记录：认识之后又「重新记」的词已经清成新卡，再打认识要照常记——
      // 原来只要今天有过一条认识就拦，重新记后的词在列表里是「未开始」，拖到「加进度」却被告知今天学过
      if (result === "know") {
        const last = await tx.studyLog.findFirst({ where: { userId, wordId, studyDate }, orderBy: { studiedAt: "desc" }, select: { result: true, nextInterval: true } });
        if (last && isDone(last.result)) {
          return { progress: toProgressState(existing), nextInterval: last.nextInterval, requeueToday: false, duplicate: true, skipped: null as string | null };
        }
      }
      // 补交上来的旧打分不能把更新的进度改回去：另一台设备已经在更晚的日期学过这个词了（审计 NU02）
      const lastReview = fromDate(existing?.lastReview ?? null);
      if ((result === "know" || result === "fuzzy") && lastReview && lastReview > today) {
        if (!preview) await tx.studyLog.create({ data: { userId, wordId, result, nextInterval: existing?.interval ?? 0, clientTs: clientTs ?? null, studyDate, source } });
        return { progress: toProgressState(existing), nextInterval: existing?.interval ?? 0, requeueToday: false, duplicate: false, skipped: "stale" as string | null };
      }
      const outcome = applyRating(toProgressState(existing), result, today, opts);
      const p = outcome.progress;
      if (!preview) {
        const fields = { interval: p.interval, stability: p.stability, difficulty: p.difficulty, reps: p.reps, lapses: p.lapses, status: p.status, dueDate: toDate(p.dueDate), lastReview: toDate(p.lastReview) };
        await tx.userWordProgress.upsert({ where: { userId_wordId: { userId, wordId } }, create: { userId, wordId, ...fields }, update: fields });
        await tx.studyLog.create({ data: { userId, wordId, result, nextInterval: outcome.nextInterval, clientTs: clientTs ?? null, studyDate, source } });
      }
      return { progress: p, nextInterval: outcome.nextInterval, requeueToday: outcome.requeueToday, duplicate: false, skipped: null as string | null };
    });
  } catch (e) {
    // wordId 不存在是外键错误，应当回 404 而不是 500（审计 F014）
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "";
    if (code === "P2003") throw new ApiError(404, "词条不存在或已被删除", "word_not_found");
    throw e;
  }
}

/**
 * 单词列表的批量状态操作（3.3.5）：已掌握 / 重新记 / 移出，一次最多 500 个词。
 * 与 rateWord 的区别只在「一次事务处理一批」（性能优化 P1-7）：
 * 原来逐词调 rateWord，每个词一个事务、一次咨询锁、五六次往返，500 个词就是三千多次往返，
 * 在单核服务器上要好几秒。这里改成一个事务：一次性把这批词的锁全拿到、一次读出已有进度、
 * 逐词用同一个 applyRating 算（调度规则仍然只有这一份实现），最后一条 createMany 写学习记录。
 * 三种结果都不经过 know / fuzzy 的那些守卫（F176 已移出/已掌握保护、NU06 当天重复、NU02 旧打分），
 * 那些判断在 rateWord 里本来就只对 know / fuzzy 生效。
 */
export async function rateWordsBatch(userId: string, wordIds: string[], result: Extract<RateResult, "master" | "reset" | "remove">, today: string) {
  const ids = Array.from(new Set(wordIds)).sort();
  if (!ids.length) return { done: 0 };
  const opts = await schedulerOptions();
  const studyDate = toDate(today)!;
  try {
    return await prisma.$transaction(async (tx) => {
      // 锁的粒度与单词打分保持一致（按用户 + 词），否则批量与单词打分并发时锁不到同一把（审计 F175）。
      // 排序后一次性获取，避免两个批量互相等对方的锁
      const keys = ids.map((w) => `${userId}:${w}`);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(k)) FROM unnest(${keys}::text[]) AS t(k)`;
      const existing = await tx.userWordProgress.findMany({ where: { userId, wordId: { in: ids } } });
      const byId = new Map(existing.map((p) => [p.wordId, p]));
      const logs: Prisma.StudyLogCreateManyInput[] = [];
      for (const wordId of ids) {
        const outcome = applyRating(toProgressState(byId.get(wordId) ?? null), result, today, opts);
        const p = outcome.progress;
        const fields = { interval: p.interval, stability: p.stability, difficulty: p.difficulty, reps: p.reps, lapses: p.lapses, status: p.status, dueDate: toDate(p.dueDate), lastReview: toDate(p.lastReview) };
        await tx.userWordProgress.upsert({ where: { userId_wordId: { userId, wordId } }, create: { userId, wordId, ...fields }, update: fields });
        logs.push({ userId, wordId, result, nextInterval: outcome.nextInterval, studyDate, source: "list" });
      }
      await tx.studyLog.createMany({ data: logs });
      return { done: ids.length };
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (e) {
    // 整批是一个事务：某个词被并发删掉时整批回滚，前端会重新同步列表（审计 F014）
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "";
    if (code === "P2003") throw new ApiError(404, "词条不存在或已被删除", "word_not_found");
    throw e;
  }
}

/** ---------- 今日队列（3.2.1 / 3.2.3 / 开发计划 6） ---------- */

/** 今日队列里的一项：卡片正面只要音标与例句英文，答案页另取详情 */
export type QueueItem = { wordId: string; spelling: string; display: string | null; kind: "review" | "new"; phonetic: { us: string; uk: string } | null; examples: string[] };
/** 队列只取音标与例句两列（AI_CARD_SELECT），所以这里的 AI 行是窄类型 */
type AiCardRow = { phoneticUs: string | null; phoneticUk: string | null; examples: Prisma.JsonValue };
const cardOf = (w: DictPart & WordAiRelations<AiCardRow>, pref: AiPreference) => { const p = pickAi(w, pref); const v = wordView(w, p?.row, p?.provider ?? null); return { phonetic: v.phonetic, examples: v.examples.map((e) => e.en) }; };

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 队列里带例句的卡片数：与学习页的详情预取深度（idx..idx+3）对齐 */
const QUEUE_EXAMPLES = 4;

/**
 * 今日队列。`statsOnly` 只算首页要的那几个数字，不把词取回来（性能优化 P1-6）：
 * 首页只显示「待学新词 / 待复习 / 今日已完成」，但原来要把整条队列（含每个词的音标、例句）都算出来，
 * 每日新词量设得大、又选了随机顺序时，服务端实测要 230–330 ms。走的是同一套 where 条件与同一套
 * 配额算法，数字与真正进队列的条数一致。
 */
export async function buildTodayQueue(userId: string, today: string, opts: { extra?: number; statsOnly?: boolean } = {}) {
  const settings = await getSettings(userId);
  const bookId = await getCurrentWordbookId(userId);
  // 今天 = study_date 等于客户端本地日期；用服务器 UTC 时刻切会让时区不同的用户错开一天（审计 F035）
  const studyDate = toDate(today)!;
  const todayLogs = await prisma.studyLog.findMany({ where: { userId, studyDate }, orderBy: { studiedAt: "asc" }, select: { wordId: true, result: true, source: true } });
  // 队列排除：今天已经打过认识 / 已掌握的词都不再出现（不论来源）；
  // 按每个词今天最后一条记录算，与 rateWord 的守卫一致——认识之后又「重新记」的词按新词重新进队列
  const doneToday = doneTodayIds(todayLogs);
  // 首页的「今日已完成」只算学习卡上完成的：在单词列表里批量标已掌握不是「学过」（审计 F024）
  const doneStudying = new Set(todayLogs.filter((l) => l.source === "study" && (l.result === "know" || l.result === "master")).map((l) => l.wordId));
  // 只有学习卡上的打分才算「今天学过」：列表页的已掌握 / 移出 / 重新记也写 study_log，
  // 一起算进去的话批量整理词库会把当天的新词配额吃光（审计 F024）
  const startedToday = new Set(todayLogs.filter((l) => l.source === "study" && (l.result === "know" || l.result === "fuzzy")).map((l) => l.wordId));

  // 复习：到期 learning 词，按 due 升序，受每日复习上限
  const dueWhere = Prisma.validator<Prisma.UserWordProgressWhereInput>()({ userId, status: "learning", dueDate: { lte: toDate(today)! }, wordId: { notIn: Array.from(doneToday) } });
  const reviewsRaw = opts.statsOnly ? [] : await prisma.userWordProgress.findMany({
    where: dueWhere,
    orderBy: { dueDate: "asc" }, take: settings.reviewLimit, include: { word: { include: AI_CARD_SELECT } },
  });
  const reviewCount = opts.statsOnly ? Math.min(settings.reviewLimit, await prisma.userWordProgress.count({ where: dueWhere })) : reviewsRaw.length;
  const reviewDeferred = await prisma.userWordProgress.count({ where: { userId, status: "learning", dueDate: { lte: toDate(today)! } } }) - reviewCount;

  // 新词：当前词库中无 progress 的词（或 status=new，如重新记后），按 sort_order / 随机，补足配额
  let newsRaw: Array<{ wordId: string; word: DictPart & WordAiRelations<AiCardRow> & { spelling: string; display: string | null } }> = [];
  let newRemaining = 0;
  let newCount = 0;
  if (bookId) {
    const quota = opts.extra ?? settings.newWords;
    // 今天已开始的新词占用配额（extra 模式忽略）
    // 今天首次学习的词（今天有记录、今天之前没有记录）占用新词配额
    let startedNewToday = 0;
    if (!opts.extra && startedToday.size) {
      const earlier = await prisma.studyLog.findMany({ where: { userId, wordId: { in: Array.from(startedToday) }, source: "study", result: { in: ["know", "fuzzy"] }, studyDate: { lt: studyDate } }, distinct: ["wordId"], select: { wordId: true } });
      startedNewToday = startedToday.size - earlier.length;
    }
    const need = Math.max(0, quota - startedNewToday);
    const memberWhere = Prisma.validator<Prisma.WordbookWordWhereInput>()({ wordbookId: bookId, word: { progress: { none: { userId, status: { in: ["learning", "mastered", "removed"] } } } } });
    let pickedIds: string[];
    if (opts.statsOnly) {
      // 只要条数：候选数就是 newRemaining——今天学过的词状态已经变成 learning / mastered，
      // memberWhere 本来就把它们排除在外，不必再按 doneToday 过一遍
      newRemaining = await prisma.wordbookWord.count({ where: memberWhere });
      newCount = Math.min(need, newRemaining);
      pickedIds = [];
    } else if (settings.newOrder === "random") {
      // 先只取 id 在整本里随机，再按 id 取回内容：原来按 sort_order 取前 500 再洗牌，
      // 大词库里等于「高频前 500 内随机」（审计 F032）
      const ids = await prisma.wordbookWord.findMany({ where: memberWhere, select: { wordId: true } });
      pickedIds = shuffle(ids.map((i) => i.wordId).filter((id) => !doneToday.has(id))).slice(0, need);
    } else {
      const rows = await prisma.wordbookWord.findMany({ where: memberWhere, orderBy: { sortOrder: "asc" }, take: need + doneToday.size + 50, select: { wordId: true } });
      pickedIds = rows.map((r) => r.wordId).filter((id) => !doneToday.has(id)).slice(0, need);
    }
    if (!opts.statsOnly) {
      const picked = pickedIds.length
        ? await prisma.wordbookWord.findMany({ where: { wordbookId: bookId, wordId: { in: pickedIds } }, include: { word: { include: AI_CARD_SELECT } } })
        : [];
      const orderIndex = new Map(pickedIds.map((id, i) => [id, i]));
      newsRaw = picked.sort((a, b) => orderIndex.get(a.wordId)! - orderIndex.get(b.wordId)!);
      newCount = newsRaw.length;
      newRemaining = await prisma.wordbookWord.count({ where: memberWhere });
    }
  }

  let items: QueueItem[] = [
    ...reviewsRaw.map((r) => ({ wordId: r.wordId, spelling: r.word.spelling, display: r.word.display, kind: "review" as const, ...cardOf(r.word, settings.aiProvider) })),
    ...newsRaw.map((n) => ({ wordId: n.wordId, spelling: n.word.spelling, display: n.word.display, kind: "new" as const, ...cardOf(n.word, settings.aiProvider) })),
  ];
  if (settings.order === "mixed") items = shuffle(items);
  // 例句只发前几条卡片的：整条队列都带例句时，200 词的队列有一多半字节是例句（实测 78 KB 里 44 KB），
  // 而例句只有当前这张卡的正面用得到。学习页本来就会预取后面几个词的详情，翻到时例句已经在手上
  // （拿不到详情的极端情况下正面暂时不显示例句区，答案页不受影响）（性能优化 P1-5）
  for (let i = QUEUE_EXAMPLES; i < items.length; i++) items[i].examples = [];

  // 已在今天进入过队列但打了「模糊(今日)」的词也会再次出现：由客户端重排，这里不重复计算
  return {
    items,
    stats: { newCount, reviewCount, doneToday: doneStudying.size, reviewDeferred, newRemaining, startedToday: startedToday.size },
    settings,
    hasBook: !!bookId,
  };
}

/** 首页数字：累计已学 / 已掌握 */
export async function totals(userId: string) {
  const [learned, mastered] = await Promise.all([
    prisma.userWordProgress.count({ where: { userId, status: { in: ["learning", "mastered"] } } }),
    prisma.userWordProgress.count({ where: { userId, status: "mastered" } }),
  ]);
  return { learned, mastered };
}

/** ---------- 词库进度 / 单词列表（3.3.1 / 3.3.5） ---------- */

/**
 * 一次算出多本词库的已学 / 已掌握数：原来每本发两个 count，词库多了就是 2N 条并发查询（审计 F018）。
 */
/** 一本词库的进度：learned = 学习中 + 已掌握；removed 是移出学习的词，词库列表按四色状态分列数量时要用（其余 = 未开始 / 未加入） */
export type BookProgress = { learned: number; mastered: number; removed: number };

export async function wordbookProgressMany(userId: string, wordbookIds: string[]): Promise<Map<string, BookProgress>> {
  const out = new Map(wordbookIds.map((id) => [id, { learned: 0, mastered: 0, removed: 0 }]));
  if (!wordbookIds.length) return out;
  // 代价随「要算几本」增长：线上实测一本约 6 ms、22 本 17–25 ms（规划器顺序扫 wordbook_word，
  // 改写成小表驱动的嵌套循环实测并不更快，索引查找同样要读那 21 MB）。所以首页只问当前那一本，
  // 不要为了拿一本的进度把全部词库都算一遍（性能优化 P1-6）
  const rows = await prisma.$queryRaw<Array<{ wordbook_id: string; status: string; n: bigint }>>`
    SELECT ww.wordbook_id, p.status::text AS status, count(*) AS n
    FROM user_word_progress p
    JOIN wordbook_word ww ON ww.word_id = p.word_id
    WHERE p.user_id = ${userId} AND p.status IN ('learning', 'mastered', 'removed') AND ww.wordbook_id IN (${Prisma.join(wordbookIds)})
    GROUP BY 1, 2`;
  for (const r of rows) {
    const cur = out.get(r.wordbook_id);
    if (!cur) continue;
    if (r.status === "removed") { cur.removed += Number(r.n); continue; }
    cur.learned += Number(r.n);
    if (r.status === "mastered") cur.mastered += Number(r.n);
  }
  return out;
}

export async function wordbookProgress(userId: string, wordbookId: string): Promise<BookProgress> {
  return (await wordbookProgressMany(userId, [wordbookId])).get(wordbookId)!;
}

/** 单词列表一行：pos 是主释义的词性（没有就是空串），def 不再内嵌词性 */
export type ListRow = { id: string; spelling: string; display: string | null; pos: string; def: string; status: WordStatus; pie: number; due: string | null };

/** 列表查询与书签定位共用的 SQL 片段：状态表达式、按厂商取的主释义、筛选条件、排序 */
function listQuery(userId: string, wordbookId: string, isCurrent: boolean, pref: AiPreference, q: { status?: string; search?: string; sort?: string }) {
  // 四色状态：与 lib/status.ts 的 deriveStatus 一一对应
  const statusExpr = Prisma.sql`CASE
    WHEN p.status = 'mastered' THEN 'mastered'
    WHEN p.status = 'learning' THEN 'learning'
    WHEN p.status = 'removed' THEN 'none'
    WHEN ${Prisma.raw(isCurrent ? "TRUE" : "FALSE")} THEN 'new'
    ELSE 'none' END`;
  // 主释义取哪家：与 pickAi 一致——「自动」是挑第一家有行的（DeepSeek 优先），
  // 挑中的那家 core 为空也不再看另一家，只退回词典释义
  const col = (name: string) =>
    pref === "deepseek" ? Prisma.raw(`d.${name}`)
      : pref === "openai" ? Prisma.raw(`o.${name}`)
        : Prisma.raw(`CASE WHEN d.word_id IS NOT NULL THEN d.${name} ELSE o.${name} END`);
  const coreExpr = col("core");
  const aiJoin = Prisma.sql`
    LEFT JOIN word_ai_deepseek d ON d.word_id = ww.word_id
    LEFT JOIN word_ai_openai o ON o.word_id = ww.word_id`;
  const bookJoin = Prisma.sql`
    FROM wordbook_word ww
    JOIN word w ON w.id = ww.word_id
    LEFT JOIN user_word_progress p ON p.word_id = ww.word_id AND p.user_id = ${userId}`;

  // 搜索：拼写与显示词头按前缀，释义按包含。LIKE 的通配符用 ! 转义，避免 % _ 被当成模式
  const kw = q.search?.trim().toLowerCase();
  const esc = kw ? kw.replace(/[!%_]/g, (c) => `!${c}`) : "";
  const like = `%${esc}%`;
  /**
   * 核心义的匹配单独放进一个物化 CTE（性能优化 P1-4）：原来写成 `LEFT JOIN 两张 AI 表 … OR core ILIKE`，
   * 规划器会把整张 word_ai_deepseek（线上 8968 行 / 49 MB）拉进内存哈希，一次搜索 90–105 ms、读盘 14 MB，
   * 而且分页与总数两条查询各来一遍。物化之后这一步走 core 上的 trigram 索引，主查询只判断 word_id 在不在这个小集合里。
   * 命中哪家与 pickAi 一致：指定厂商只看那一家；auto 是「DeepSeek 优先，没有 DeepSeek 行才看 OpenAI」。
   */
  const aiHit = pref === "deepseek"
    ? Prisma.sql`SELECT word_id FROM word_ai_deepseek WHERE core ILIKE ${like} ESCAPE '!'`
    : pref === "openai"
      ? Prisma.sql`SELECT word_id FROM word_ai_openai WHERE core ILIKE ${like} ESCAPE '!'`
      : Prisma.sql`SELECT word_id FROM word_ai_deepseek WHERE core ILIKE ${like} ESCAPE '!'
          UNION
          SELECT o.word_id FROM word_ai_openai o WHERE o.core ILIKE ${like} ESCAPE '!'
            AND NOT EXISTS (SELECT 1 FROM word_ai_deepseek d2 WHERE d2.word_id = o.word_id)`;
  // 有搜索词时放在语句最前面；没有搜索就是空片段
  const cte = kw ? Prisma.sql`WITH ai_hit AS MATERIALIZED (${aiHit}) ` : Prisma.empty;
  const searchCond = kw
    ? Prisma.sql` AND (w.spelling LIKE ${`${esc}%`} ESCAPE '!' OR lower(w.display) LIKE ${`${esc}%`} ESCAPE '!'
        OR w.translation ILIKE ${like} ESCAPE '!' OR ww.word_id IN (SELECT word_id FROM ai_hit))`
    : Prisma.empty;
  const hasStatus = !!q.status && q.status !== "all";
  const statusCond = hasStatus ? Prisma.sql` AND (${statusExpr}) = ${q.status}` : Prisma.empty;
  const where = Prisma.sql` WHERE ww.wordbook_id = ${wordbookId}${statusCond}${searchCond}`;

  // 排序：字母 / 词频 / 下次复习都补上 spelling 兜底，翻页时同一批词不会因为并列而漂移
  // 随机排序（需求 3.3）：种子编码在 sort 里（random:<种子>），同一种子顺序固定——
  // 分页、书签定位（wordIndexIn 用的是同一段 orderBy）都要求顺序可复现，
  // 直接用 random() 每次结果都变，翻页会重复漏词。
  // 用 hashtext 而不是 md5：它产出 int4，整数排序比 32 字符的字符串排序快一倍，
  // 实测 9654 词的词库翻到第 100 页 6.7ms，比按字母排序（13.3ms）还快。
  // 倒序：排序值带 -desc 后缀（order-desc / alpha-desc / freq-desc / due-desc）。
  // 词频与下次复习时间两种倒序里，没有词频、没有到期日的词仍然排在最后（NULLS LAST 不跟着翻），
  // 否则「低频优先」第一屏全是词典没给词频的词。随机没有倒序，重选一次随机就是重新洗牌。
  const randomSeed = q.sort?.startsWith("random:") ? q.sort.slice(7) : null;
  const desc = !!q.sort?.endsWith("-desc");
  const key = desc ? q.sort!.slice(0, -5) : q.sort;
  const dir = Prisma.raw(desc ? "DESC" : "ASC");
  const orderBy = key === "alpha" ? Prisma.sql`w.spelling ${dir}`
    : key === "due" ? Prisma.sql`(CASE WHEN (${statusExpr}) = 'learning' THEN p.due_date END) ${dir} NULLS LAST, w.spelling ${dir}`
      : key === "freq" ? Prisma.sql`COALESCE(w.frq, w.bnc) ${dir} NULLS LAST, w.spelling ${dir}`
        : randomSeed ? Prisma.sql`hashtext(w.id || ${randomSeed}) ASC, w.id ASC`
          : Prisma.sql`ww.sort_order ${dir}, w.spelling ${dir}`;
  return { statusExpr, col, coreExpr, aiJoin, bookJoin, cte, where, orderBy, hasStatus, kw };
}

/**
 * 单词列表（3.3.5）：筛选、搜索、排序、分页与状态计数全部下推到数据库（审计 F017）。
 * 原来把整本词库读进内存再过滤排序，近万词的内置词库每翻一页、每切一次筛选都要重来一遍。
 */
export async function listWordbookWords(userId: string, wordbookId: string, q: { status?: string; search?: string; sort?: string; cursor?: number; limit?: number }) {
  const [currentId, settings] = await Promise.all([getCurrentWordbookId(userId), getSettings(userId)]);
  const isCurrent = currentId === wordbookId;
  const limit = Math.min(1000, q.limit ?? 100);
  const cursor = Math.max(0, q.cursor ?? 0);
  const master = await getConfigInt("study.master_interval");
  const { statusExpr, col, coreExpr, aiJoin, bookJoin, cte, where, orderBy, hasStatus, kw } = listQuery(userId, wordbookId, isCurrent, settings.aiProvider, q);

  type PageRow = { id: string; spelling: string; display: string | null; translation: string | null; core: string | null; core_pos: string | null; status: WordStatus; interval: number | null; due_date: Date | null };
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<PageRow[]>`
      ${cte}SELECT ww.word_id AS id, w.spelling, w.display, w.translation, ${coreExpr} AS core, ${col("core_pos")} AS core_pos,
             (${statusExpr}) AS status, p.interval, p.due_date
      ${bookJoin}${aiJoin}${where}
      ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${cursor}`,
    // 状态计数按整本词库算，不受搜索与筛选影响（审计 F022）
    prisma.$queryRaw<Array<{ status: WordStatus; n: bigint }>>`
      SELECT (${statusExpr}) AS status, count(*)::bigint AS n
      FROM wordbook_word ww LEFT JOIN user_word_progress p ON p.word_id = ww.word_id AND p.user_id = ${userId}
      WHERE ww.wordbook_id = ${wordbookId} GROUP BY 1`,
  ]);

  const counts: Record<string, number> = { all: 0, new: 0, learning: 0, mastered: 0, none: 0 };
  for (const c of countRows) { counts[c.status] = Number(c.n); counts.all += Number(c.n); }
  /**
   * 总数（列表底部的「共 N 词」与翻页判断）：
   * - 没有筛选也没有搜索：就是整本的计数，前面那条查询已经算好；
   * - 这一页没取满：说明已经到结果末尾，cursor + 本页行数就是准确总数；
   * - 其余情况才真去数一遍（宽泛搜索的第一页、筛选后的中间页）。
   * 服务器只有一个核，这条与分页查询并行发也不会更快，所以按需串行执行（性能优化 P1-4）。
   */
  const total = !hasStatus && !kw ? counts.all
    : rows.length < limit ? cursor + rows.length
      : Number((await prisma.$queryRaw<Array<{ n: bigint }>>`${cte}SELECT count(*)::bigint AS n ${bookJoin}${where}`)[0]?.n ?? 0);
  const out: ListRow[] = rows.map((r) => {
    const core = wordCore({ translation: r.translation }, { core: r.core, corePos: r.core_pos });
    return {
      id: r.id, spelling: r.spelling, display: r.display, pos: core.pos, def: core.def ?? "暂无释义", status: r.status,
      pie: pieProgress(r.status, r.interval ?? 0, master),
      due: r.status === "learning" ? fromDate(r.due_date) : null,
    };
  });
  return { rows: out, total, counts, nextCursor: cursor + limit < total ? cursor + limit : null, isCurrent };
}

/**
 * 某个词在「给定筛选 + 排序」下排第几（0 开始）；不在结果里返回 null。
 * 书签用它算出要从第几行开始加载，与列表用的是同一套条件与排序，不会错位。
 */
export async function wordIndexIn(userId: string, wordbookId: string, wordId: string, q: { status?: string; search?: string; sort?: string }): Promise<number | null> {
  const [currentId, settings] = await Promise.all([getCurrentWordbookId(userId), getSettings(userId)]);
  const { bookJoin, cte, where, orderBy } = listQuery(userId, wordbookId, currentId === wordbookId, settings.aiProvider, q);
  const rows = await prisma.$queryRaw<Array<{ idx: bigint }>>`
    ${cte}SELECT idx FROM (
      SELECT ww.word_id AS wid, row_number() OVER (ORDER BY ${orderBy}) - 1 AS idx
      ${bookJoin}${where}
    ) t WHERE wid = ${wordId}`;
  return rows.length ? Number(rows[0].idx) : null;
}

/** ---------- 词库书签（3.3.5） ---------- */

/** 书签记下的浏览条件：状态筛选、搜索词、排序、显示模式 */
export type BookmarkView = { filter: string; q: string; sort: string; mode: string };
export type Bookmark = BookmarkView & {
  wordId: string; spelling: string; display: string | null;
  /** 在书签条件下排第几（0 开始）；条件变了导致这个词不在结果里时为 null */
  index: number | null;
  updatedAt: string;
};

/** 读书签：一并算出它在自己记下的那套条件里排第几，前端据此决定从哪一行开始加载 */
export async function getBookmark(userId: string, wordbookId: string): Promise<Bookmark | null> {
  const b = await prisma.wordbookBookmark.findUnique({
    where: { userId_wordbookId: { userId, wordbookId } },
    include: { word: { select: { spelling: true, display: true } } },
  });
  if (!b) return null;
  const view = { filter: b.filter, q: b.q, sort: b.sort, mode: b.mode };
  const index = await wordIndexIn(userId, wordbookId, b.wordId, { status: b.filter, search: b.q, sort: b.sort });
  return { ...view, wordId: b.wordId, spelling: b.word.spelling, display: b.word.display, index, updatedAt: b.updatedAt.toISOString() };
}

/** 设书签：一本词库只有一个，新的覆盖旧的 */
export async function setBookmark(userId: string, wordbookId: string, wordId: string, view: BookmarkView): Promise<Bookmark> {
  const inBook = await prisma.wordbookWord.findUnique({ where: { wordbookId_wordId: { wordbookId, wordId } }, select: { wordId: true } });
  if (!inBook) throw new ApiError(404, "这个词不在该词库里");
  const data = { filter: view.filter, q: view.q, sort: view.sort, mode: view.mode };
  await prisma.wordbookBookmark.upsert({
    where: { userId_wordbookId: { userId, wordbookId } },
    create: { userId, wordbookId, wordId, ...data },
    update: { wordId, ...data },
  });
  return (await getBookmark(userId, wordbookId))!;
}

export async function clearBookmark(userId: string, wordbookId: string) {
  await prisma.wordbookBookmark.deleteMany({ where: { userId, wordbookId } });
}

export const wordbookInclude = Prisma.validator<Prisma.WordbookDefaultArgs>()({ select: { id: true, name: true, type: true, wordCount: true, createdAt: true } });

/** 导出：词库、进度、备注、日志 */
export async function exportUserData(userId: string) {
  const [user, wordbooks, progress, notes, logs, feedback, bookmarks, settings, currentId] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, createdAt: true } }),
    prisma.wordbook.findMany({ where: { ownerId: userId }, include: { words: { include: { word: { select: { spelling: true } } }, orderBy: { sortOrder: "asc" } } } }),
    prisma.userWordProgress.findMany({ where: { userId }, include: { word: { select: { spelling: true } } } }),
    prisma.userWordNote.findMany({ where: { userId }, include: { word: { select: { spelling: true } } } }),
    prisma.studyLog.findMany({ where: { userId }, include: { word: { select: { spelling: true } } }, orderBy: [{ studyDate: "asc" }, { studiedAt: "asc" }] }),
    prisma.wordFeedback.findMany({ where: { userId }, include: { word: { select: { spelling: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.wordbookBookmark.findMany({ where: { userId }, include: { word: { select: { spelling: true } }, wordbook: { select: { name: true } } } }),
    getSettings(userId),
    getCurrentWordbookId(userId),
  ]);
  const currentBook = currentId ? await prisma.wordbook.findUnique({ where: { id: currentId }, select: { name: true } }) : null;
  return {
    // 导出的是生效后的设置（含默认值），不是库里那份可能残缺的原始 JSON；并补上当前学习词库与建库时间（审计 F170）
    exportedAt: new Date().toISOString(),
    user: { ...user, settings },
    currentWordbook: currentBook?.name ?? null,
    wordbooks: wordbooks.map((b) => ({ name: b.name, type: b.type, createdAt: b.createdAt, words: b.words.map((w) => w.word.spelling) })),
    progress: progress.map((p) => ({ word: p.word.spelling, interval: p.interval, stability: p.stability, difficulty: p.difficulty, reps: p.reps, lapses: p.lapses, status: p.status, dueDate: fromDate(p.dueDate), lastReview: fromDate(p.lastReview) })),
    notes: notes.map((n) => ({ word: n.word.spelling, note: n.note, updatedAt: n.updatedAt })),
    studyLog: logs.map((l) => ({ word: l.word.spelling, result: l.result, nextInterval: l.nextInterval, studyDate: fromDate(l.studyDate), studiedAt: l.studiedAt })),
    feedback: feedback.map((f) => ({ word: f.word.spelling, content: f.content, createdAt: f.createdAt })),
    bookmarks: bookmarks.map((b) => ({ wordbook: b.wordbook.name, word: b.word.spelling, filter: b.filter, q: b.q, sort: b.sort, mode: b.mode, updatedAt: b.updatedAt })),
  };
}

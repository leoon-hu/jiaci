import { withUser, ok, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { candidateLemmas, lemmaBase } from "@/lib/lemma";
import { pickLemma } from "@/lib/dict";
import { dictLemmas, lookupDictFields } from "@/lib/dict-db";
import { scopeOfBook, wordStatusFor } from "@/lib/study";
import { isStopword } from "@/lib/stopwords";
import { isValidWord } from "@/lib/words";
import { lemmaHint, wordView, type WordView } from "@/lib/word-view";
import { AI_PEEK_SELECT, pickAi } from "@/lib/ai/providers";
import { getSettings } from "@/lib/settings";
import type { WordStatus } from "@/lib/status";

const peek = (spelling: string, display: string | null, status: WordStatus, v: WordView, exchange: string | null | undefined) => ({
  spelling, display, status, phonetic: v.phonetic, core: v.core,
  meanings: v.meanings.map((m) => ({ pos: m.pos, defs: m.senses.map((s) => s.zh) })),
  lemmaOf: lemmaHint(spelling, exchange, v.core),
});
const empty = (spelling: string, stopword = false) => ({ spelling, display: null, status: "none" as const, phonetic: null, core: null, meanings: [], ...(stopword ? { stopword: true } : {}) });

/**
 * 点词弹框（3.2.5）：按原形候选查词，只查不建——这里不校验拼写就 getOrCreateWord 的话，
 * 任何登录用户都能把任意字符串写进全局 word 表（审计 F010 / F011）。
 * 不放在 /api/words/ 下面：那里的静态段会抢走 /api/words/[spelling] 里同名的词（原来的 /api/words/peek 让 peek 这个词的详情一直 400）。
 */
export const GET = withUser(async (req, _ctx, user) => {
  const u = new URL(req.url);
  const raw = u.searchParams.get("w") ?? "";
  // 从哪本词库的详情里点的词：状态按那本的进度作用域算；没带就按当前学习词库
  const book = u.searchParams.get("book") || null;
  const cands = candidateLemmas(raw).filter(isValidWord);
  if (!cands.length) throw new ApiError(400, "参数不正确");
  const base = lemmaBase(raw);
  // 挑哪个候选见 pickLemma：数据库的 in 查询不保留顺序，token 本身必须优先于去后缀的候选（审计 F080），
  // 去后缀有歧义时听词典的（plumes 是 plume 的复数，不是 plum）
  // 只取弹框要用的几列：整行 include 会把例句 / 搭配 / 词源等 JSONB 一起拉出来（单行平均 3.3 KB × 两家 × 候选数），
  // 而这个接口的返回体只有几百字节
  const [hits, lemmas] = await Promise.all([
    prisma.word.findMany({ where: { spelling: { in: cands } }, include: AI_PEEK_SELECT }),
    dictLemmas([base]),
  ]);
  const bySpelling = new Map(hits.map((h) => [h.spelling, h]));
  const dictLemma = lemmas.get(base);
  // 词典写的原形不在去后缀的候选里（easier → easy、men → man）就补查一次
  if (dictLemma && !bySpelling.has(base) && !cands.includes(dictLemma) && isValidWord(dictLemma)) {
    for (const h of await prisma.word.findMany({ where: { spelling: dictLemma }, include: AI_PEEK_SELECT })) bySpelling.set(h.spelling, h);
  }
  const pick = pickLemma(raw, cands, (s) => bySpelling.has(s), { dictLemma, exchangeOf: (s) => bySpelling.get(s)?.exchange });
  const found = pick ? bySpelling.get(pick) : undefined;
  if (found) {
    const [st, settings] = await Promise.all([scopeOfBook(user.id, book).then((scope) => wordStatusFor(user.id, found.id, scope)), getSettings(user.id)]);
    const picked = pickAi(found, settings.aiProvider);
    return ok(peek(found.spelling, found.display, st.status, wordView(found, picked?.row, picked?.provider ?? null), found.exchange));
  }
  if (isStopword(cands[0])) return ok(empty(cands[0], true));
  // 词表里没有就用词典兜底展示，同样不建行
  const dict = await lookupDictFields(cands);
  const hit = cands.map((c) => [c, dict.get(c)] as const).find(([, d]) => d);
  if (!hit) return ok(empty(cands[0]));
  return ok(peek(hit[0], hit[1]!.display, "none", wordView({ spelling: hit[0], ...hit[1]! }, null), hit[1]!.exchange));
});

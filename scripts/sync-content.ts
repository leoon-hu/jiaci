/**
 * 把本机的「内容数据」同步到线上库（审计 NO03）。
 *
 * 为什么不能按主键 upsert：word.id / wordbook.id 是 Prisma 的 cuid()，两个库各自生成。
 * 线上用户查一个本机没有的词，getOrCreateWord 就会在线上造出同拼写、不同 id 的行；
 * 之后本机对这个词跑 ai:fill，word_ai_*.word_id 指向的是本机 id，按主键同步必然撞
 * spelling 唯一键或外键。所以这里一律以**业务键**同步：
 *   word           → spelling
 *   word_ai_*      → 拼写（写入前按 spelling 查回线上的 word_id）
 *   audio_text     → text_hash（内容哈希，两边天然一致）
 *   audio_clip     → (text_hash, voice)
 *   wordbook(内置) → name
 *   wordbook_word  → (词库名, 拼写)
 *
 * 只同步内容，绝不碰用户数据：user_*、session、study_log、otp_code、system_config 都不在范围内。
 * word 只增不改删（线上用户查出来的词保留）；内置词库的成员按本机为准增删，这与本机
 * wordbooks:build 的「按名称整表刷新」一致——学习进度挂在 word 上，不受影响。
 * 内置词库本身只增不删：删词库会级联清掉用户的「当前词库」，要删请人工确认。
 *
 * 用法（TARGET_DATABASE_URL 指向线上库，通常经 SSH 隧道访问）：
 *   npm run sync:content                      只比对、打印差异，不写（默认）
 *   npm run sync:content -- --apply           实际写入
 *   npm run sync:content -- --only ai,audio   只同步部分：word / ai / audio / books
 *
 * 比对方式：两边各算一遍「可比较列」的 md5 签名（不含 id、不含 created_at / updated_at），
 * 只把签名不同或线上没有的行取全量发过去；重复执行不会产生无谓的写入。
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = (args.find((a) => a.startsWith("--only="))?.slice(7) ?? (args.includes("--only") ? args[args.indexOf("--only") + 1] : "") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const want = (name: string) => !ONLY.length || ONLY.includes(name);
/** 一条 INSERT 里最多带多少行：Postgres 单条语句最多 65535 个参数 */
const CHUNK = { word: 400, ai: 150, text: 800, clip: 500, member: 2000 };

function log(...a: unknown[]) { console.log(...a); }
function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
/** ROW(...)::text 的 md5：判断两边的行内容是否一致 */
function sigSql(cols: string[]) {
  return `md5(ROW(${cols.join(", ")})::text)`;
}
/** 多行 VALUES：每列的类型转换按下标给（参数不带类型时 Postgres 无法从 VALUES 推断） */
function buildValues(rows: unknown[][], cast: string[]) {
  const params: unknown[] = [];
  const parts = rows.map((r) => `(${r.map((v, i) => { params.push(v); return `$${params.length}${cast[i]}`; }).join(", ")})`);
  return { sql: parts.join(", "), params };
}
/** 执行一批 upsert，返回真正插入 / 更新的行数（xmax = 0 即新插入） */
async function upsert(db: Db, sql: string, params: unknown[]) {
  const rows = await db.$queryRawUnsafe<Array<{ inserted: boolean }>>(sql, ...params);
  return { ins: rows.filter((r) => r.inserted).length, upd: rows.filter((r) => !r.inserted).length };
}

/* ---------------- word ---------------- */

const WORD_COLS = ["kind", "phonetic", "translation", "definition", "collins", "oxford", "tags", "bnc", "frq", "exchange", "display", "dict_source"];
const WORD_SIG = ["kind::text", "phonetic", "translation", "definition", "collins", "oxford", "tags::text", "bnc", "frq", "exchange", "display", "dict_source"];
const WORD_CAST = ["::text", "::text", '::"WordKind"', "::text", "::text", "::text", "::int", "::boolean", "::jsonb", "::int", "::int", "::text", "::text", "::text", "::timestamp"];

/** 值得同步的词：有词典字段、或有 AI 资料、或在某本内置词库里。本机 dev 查词 / 测试导入造出来的孤词不发。 */
const WORD_WHERE = `(w.dict_source IS NOT NULL
  OR EXISTS (SELECT 1 FROM word_ai_openai a WHERE a.word_id = w.id)
  OR EXISTS (SELECT 1 FROM word_ai_deepseek a WHERE a.word_id = w.id)
  OR EXISTS (SELECT 1 FROM wordbook_word m JOIN wordbook b ON b.id = m.wordbook_id AND b.type = 'builtin' WHERE m.word_id = w.id))`;

async function syncWords(local: Db, remote: Db) {
  const [ls, rs] = await Promise.all([
    local.$queryRawUnsafe<Array<{ spelling: string; sig: string }>>(`SELECT w.spelling, ${sigSql(WORD_SIG)} AS sig FROM word w WHERE ${WORD_WHERE}`),
    remote.$queryRawUnsafe<Array<{ spelling: string; sig: string }>>(`SELECT w.spelling, ${sigSql(WORD_SIG)} AS sig FROM word w`),
  ]);
  const rmap = new Map(rs.map((r) => [r.spelling, r.sig]));
  const todo = ls.filter((l) => rmap.get(l.spelling) !== l.sig).map((l) => l.spelling);
  const added = todo.filter((s) => !rmap.has(s)).length;
  log(`word：本机可同步 ${ls.length}，线上 ${rs.length}，需要写入 ${todo.length}（新增 ${added}，内容有变 ${todo.length - added}）`);
  if (!todo.length || !APPLY) return;
  let ins = 0, upd = 0;
  for (const part of chunks(todo, CHUNK.word)) {
    const rows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT w.id, w.spelling, w.kind::text AS kind, w.phonetic, w.translation, w.definition, w.collins, w.oxford,
              to_jsonb(w.tags)::text AS tags, w.bnc, w.frq, w.exchange, w.display, w.dict_source, w.dict_updated_at
       FROM word w WHERE w.spelling = ANY($1::text[])`, part);
    const v = buildValues(
      rows.map((r) => [r.id, r.spelling, r.kind, r.phonetic, r.translation, r.definition, r.collins, r.oxford, r.tags, r.bnc, r.frq, r.exchange, r.display, r.dict_source, r.dict_updated_at]),
      WORD_CAST,
    );
    const sql = `INSERT INTO word (id, spelling, kind, phonetic, translation, definition, collins, oxford, tags, bnc, frq, exchange, display, dict_source, dict_updated_at)
      SELECT id, spelling, kind, phonetic, translation, definition, collins, oxford,
             ARRAY(SELECT jsonb_array_elements_text(tags)),
             bnc, frq, exchange, display, dict_source, dict_updated_at
      FROM (VALUES ${v.sql}) AS t(id, spelling, kind, phonetic, translation, definition, collins, oxford, tags, bnc, frq, exchange, display, dict_source, dict_updated_at)
      ON CONFLICT (spelling) DO UPDATE SET ${WORD_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, dict_updated_at = EXCLUDED.dict_updated_at
      WHERE (${WORD_SIG.map((c) => `word.${c}`).join(", ")}) IS DISTINCT FROM (${WORD_SIG.map((c) => `EXCLUDED.${c}`).join(", ")})
      RETURNING (xmax = 0) AS inserted`;
    const r = await upsert(remote, sql, v.params);
    ins += r.ins; upd += r.upd;
  }
  log(`  → 新增 ${ins}，更新 ${upd}`);
}

/* ---------------- word_ai_* ---------------- */

const AI_COLS = ["phonetic_us", "phonetic_uk", "core", "core_pos", "meanings", "examples", "collocations", "phrases", "patterns", "usage",
  "synonyms", "antonyms", "confusables", "mistakes", "family", "cognates", "mnemonic", "etymology", "generated_at", "source"];
const AI_JSON = new Set(["meanings", "examples", "collocations", "phrases", "patterns", "synonyms", "antonyms", "confusables", "mistakes", "family", "cognates", "etymology"]);
const AI_SIG = AI_COLS.filter((c) => c !== "generated_at").map((c) => (AI_JSON.has(c) ? `a.${c}::text` : `a.${c}`));
const AI_CAST = ["::text", ...AI_COLS.map((c) => (AI_JSON.has(c) ? "::jsonb" : c === "generated_at" ? "::timestamp" : "::text"))];

async function syncAi(local: Db, remote: Db, table: string) {
  const sel = `SELECT w.spelling, ${sigSql(AI_SIG)} AS sig FROM ${table} a JOIN word w ON w.id = a.word_id`;
  const [ls, rs] = await Promise.all([
    local.$queryRawUnsafe<Array<{ spelling: string; sig: string }>>(sel),
    remote.$queryRawUnsafe<Array<{ spelling: string; sig: string }>>(sel),
  ]);
  const rmap = new Map(rs.map((r) => [r.spelling, r.sig]));
  const todo = ls.filter((l) => rmap.get(l.spelling) !== l.sig).map((l) => l.spelling);
  const added = todo.filter((s) => !rmap.has(s)).length;
  log(`${table}：本机 ${ls.length}，线上 ${rs.length}，需要写入 ${todo.length}（新增 ${added}，内容有变 ${todo.length - added}）`);
  if (!todo.length || !APPLY) return;
  let ins = 0, upd = 0, skipped = 0;
  for (const part of chunks(todo, CHUNK.ai)) {
    const rows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT w.spelling, ${AI_COLS.map((c) => `a."${c}"`).join(", ")} FROM ${table} a JOIN word w ON w.id = a.word_id WHERE w.spelling = ANY($1::text[])`, part);
    const v = buildValues(
      rows.map((r) => [r.spelling, ...AI_COLS.map((c) => (AI_JSON.has(c) ? (r[c] == null ? null : JSON.stringify(r[c])) : r[c]))]),
      AI_CAST,
    );
    // 线上没有这个拼写就跳过（word 那一步没同步到，多半是被 WORD_WHERE 排除的孤词）
    const sql = `INSERT INTO ${table} (word_id, ${AI_COLS.map((c) => `"${c}"`).join(", ")})
      SELECT w.id, ${AI_COLS.map((c) => `t."${c}"`).join(", ")}
      FROM (VALUES ${v.sql}) AS t(spelling, ${AI_COLS.map((c) => `"${c}"`).join(", ")}) JOIN word w ON w.spelling = t.spelling
      ON CONFLICT (word_id) DO UPDATE SET ${AI_COLS.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")}
      WHERE (${AI_SIG.map((c) => c.replace("a.", `${table}.`)).join(", ")}) IS DISTINCT FROM (${AI_SIG.map((c) => c.replace("a.", "EXCLUDED.")).join(", ")})
      RETURNING (xmax = 0) AS inserted`;
    const r = await upsert(remote, sql, v.params);
    ins += r.ins; upd += r.upd; skipped += rows.length - r.ins - r.upd;
  }
  log(`  → 新增 ${ins}，更新 ${upd}${skipped ? `，跳过 ${skipped}（线上无此拼写）` : ""}`);
}

/* ---------------- 音频登记 ---------------- */

const CLIP_SIG = ["provider", "path", "bytes", "status::text", "error"];

async function syncAudio(local: Db, remote: Db) {
  const [lt, rt] = await Promise.all([
    local.$queryRawUnsafe<Array<{ text_hash: string; kind: string; text: string }>>(`SELECT text_hash, kind::text AS kind, text FROM audio_text`),
    remote.$queryRawUnsafe<Array<{ text_hash: string }>>(`SELECT text_hash FROM audio_text`),
  ]);
  const have = new Set(rt.map((r) => r.text_hash));
  const newText = lt.filter((r) => !have.has(r.text_hash));
  log(`audio_text：本机 ${lt.length}，线上 ${rt.length}，需要新增 ${newText.length}`);
  if (APPLY && newText.length) {
    for (const part of chunks(newText, CHUNK.text)) {
      const v = buildValues(part.map((r) => [r.text_hash, r.kind, r.text]), ["::text", '::"AudioKind"', "::text"]);
      await remote.$executeRawUnsafe(`INSERT INTO audio_text (text_hash, kind, text) VALUES ${v.sql} ON CONFLICT (text_hash) DO NOTHING`, ...v.params);
    }
  }

  const sel = `SELECT text_hash, voice, ${sigSql(CLIP_SIG)} AS sig FROM audio_clip`;
  const [lc, rc] = await Promise.all([
    local.$queryRawUnsafe<Array<{ text_hash: string; voice: string; sig: string }>>(sel),
    remote.$queryRawUnsafe<Array<{ text_hash: string; voice: string; sig: string }>>(sel),
  ]);
  const rmap = new Map(rc.map((r) => [`${r.text_hash} ${r.voice}`, r.sig]));
  const todo = lc.filter((l) => rmap.get(`${l.text_hash} ${l.voice}`) !== l.sig);
  log(`audio_clip：本机 ${lc.length}，线上 ${rc.length}，需要写入 ${todo.length}`);
  if (!APPLY || !todo.length) return;
  let ins = 0, upd = 0;
  for (const part of chunks(todo, CHUNK.clip)) {
    const rows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT text_hash, voice, provider, path, bytes, status::text AS status, error FROM audio_clip
       WHERE text_hash || ' ' || voice = ANY($1::text[])`, part.map((r) => `${r.text_hash} ${r.voice}`));
    const v = buildValues(rows.map((r) => [r.text_hash, r.voice, r.provider, r.path, r.bytes, r.status, r.error]),
      ["::text", "::text", "::text", "::text", "::int", '::"AudioStatus"', "::text"]);
    // audio_clip 的外键指向 audio_text，上一步没登记的文本会被这里的 EXISTS 挡掉
    // updated_at 是 Prisma 的 @updatedAt，数据库端没有默认值也没有触发器，裸 INSERT 必须自己给
    const sql = `INSERT INTO audio_clip (text_hash, voice, provider, path, bytes, status, error, updated_at)
      SELECT t.*, now() FROM (VALUES ${v.sql}) AS t(text_hash, voice, provider, path, bytes, status, error)
      WHERE EXISTS (SELECT 1 FROM audio_text x WHERE x.text_hash = t.text_hash)
      ON CONFLICT (text_hash, voice) DO UPDATE SET provider = EXCLUDED.provider, path = EXCLUDED.path, bytes = EXCLUDED.bytes,
        status = EXCLUDED.status, error = EXCLUDED.error, updated_at = now()
      RETURNING (xmax = 0) AS inserted`;
    const r = await upsert(remote, sql, v.params);
    ins += r.ins; upd += r.upd;
  }
  log(`  → 新增 ${ins}，更新 ${upd}`);
}

/* ---------------- 内置词库 ---------------- */

async function syncBooks(local: Db, remote: Db) {
  const sel = `SELECT id, name, sort_order FROM wordbook WHERE type = 'builtin'`;
  const [lb, rb] = await Promise.all([
    local.$queryRawUnsafe<Array<{ id: string; name: string; sort_order: number }>>(`${sel} ORDER BY sort_order`),
    remote.$queryRawUnsafe<Array<{ id: string; name: string; sort_order: number }>>(sel),
  ]);
  const rmap = new Map(rb.map((b) => [b.name, b]));
  const lnames = new Set(lb.map((b) => b.name));
  const gone = rb.filter((b) => !lnames.has(b.name));
  log(`wordbook(内置)：本机 ${lb.length}，线上 ${rb.length}，新增 ${lb.filter((b) => !rmap.has(b.name)).length}`);
  if (gone.length) log(`  ! 线上多出 ${gone.length} 本本机已没有的词库：${gone.map((b) => b.name).join("、")}。不自动删除（会级联清掉用户的「当前词库」），要删请人工执行 SQL`);
  if (APPLY) {
    for (const b of lb) {
      await remote.$executeRawUnsafe(
        `INSERT INTO wordbook (id, name, type, sort_order, word_count)
         SELECT $1::text, $2::text, 'builtin', $3::int, 0 WHERE NOT EXISTS (SELECT 1 FROM wordbook WHERE type = 'builtin' AND name = $2::text)`,
        b.id, b.name, b.sort_order);
      await remote.$executeRawUnsafe(`UPDATE wordbook SET sort_order = $2::int WHERE type = 'builtin' AND name = $1::text AND sort_order <> $2::int`, b.name, b.sort_order);
    }
  }
  // 成员：按 (词库名, 拼写) 比对，本机为准
  const memSel = `SELECT b.name, w.spelling, m.sort_order FROM wordbook_word m
    JOIN wordbook b ON b.id = m.wordbook_id AND b.type = 'builtin' JOIN word w ON w.id = m.word_id`;
  const [lm, rm] = await Promise.all([
    local.$queryRawUnsafe<Array<{ name: string; spelling: string; sort_order: number }>>(memSel),
    remote.$queryRawUnsafe<Array<{ name: string; spelling: string; sort_order: number }>>(memSel),
  ]);
  const key = (r: { name: string; spelling: string }) => `${r.name}${r.spelling}`;
  const rmem = new Map(rm.map((r) => [key(r), r.sort_order]));
  const lkeys = new Set(lm.map(key));
  const put = lm.filter((r) => rmem.get(key(r)) !== r.sort_order);
  const del = rm.filter((r) => !lkeys.has(key(r)) && lnames.has(r.name));
  log(`wordbook_word(内置)：本机 ${lm.length}，线上 ${rm.length}，写入 ${put.length}，删除 ${del.length}`);
  if (!APPLY) return;
  for (const part of chunks(put, CHUNK.member)) {
    const v = buildValues(part.map((r) => [r.name, r.spelling, r.sort_order]), ["::text", "::text", "::int"]);
    await remote.$executeRawUnsafe(
      `INSERT INTO wordbook_word (wordbook_id, word_id, sort_order)
       SELECT b.id, w.id, t.sort_order FROM (VALUES ${v.sql}) AS t(name, spelling, sort_order)
       JOIN wordbook b ON b.type = 'builtin' AND b.name = t.name JOIN word w ON w.spelling = t.spelling
       ON CONFLICT (wordbook_id, word_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`, ...v.params);
  }
  for (const part of chunks(del, CHUNK.member)) {
    const v = buildValues(part.map((r) => [r.name, r.spelling]), ["::text", "::text"]);
    await remote.$executeRawUnsafe(
      `DELETE FROM wordbook_word m USING wordbook b, word w, (VALUES ${v.sql}) AS t(name, spelling)
       WHERE b.id = m.wordbook_id AND w.id = m.word_id AND b.type = 'builtin' AND b.name = t.name AND w.spelling = t.spelling`, ...v.params);
  }
  const n = await remote.$executeRawUnsafe(
    `UPDATE wordbook b SET word_count = c.n FROM (SELECT wordbook_id, count(*) n FROM wordbook_word GROUP BY 1) c
     WHERE c.wordbook_id = b.id AND b.type = 'builtin' AND b.word_count <> c.n`);
  log(`  → 词数订正 ${n} 本`);
}

/* ---------------- 入口 ---------------- */

async function main() {
  const target = process.env.TARGET_DATABASE_URL;
  const source = process.env.DATABASE_URL;
  if (!target) throw new Error("请设置 TARGET_DATABASE_URL（线上库地址，通常经 ssh -L 隧道访问）");
  if (!source) throw new Error("请设置 DATABASE_URL（本机库）");
  if (target === source) throw new Error("TARGET_DATABASE_URL 与 DATABASE_URL 相同，拒绝执行");
  const local = new PrismaClient({ datasourceUrl: source });
  const remote = new PrismaClient({ datasourceUrl: target });
  try {
    const done = `SELECT count(*) n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const [[lv], [rv]] = await Promise.all([
      local.$queryRawUnsafe<Array<{ n: bigint }>>(done),
      remote.$queryRawUnsafe<Array<{ n: bigint }>>(done),
    ]);
    if (lv.n !== rv.n) throw new Error(`迁移版本不一致：本机 ${lv.n} 条、线上 ${rv.n} 条。先对线上跑 prisma migrate deploy，再同步内容`);
    log(APPLY ? "== 实际写入线上库 ==" : "== 只比对，不写入（加 --apply 才真的写）==");
    if (want("word")) await syncWords(local, remote);
    if (want("ai")) { await syncAi(local, remote, "word_ai_deepseek"); await syncAi(local, remote, "word_ai_openai"); }
    if (want("audio")) await syncAudio(local, remote);
    if (want("books")) await syncBooks(local, remote);
    log(APPLY
      ? "\n完成。音频文件要另外用 rsync 传到线上的 AUDIO_DIR"
      : "\n以上都没有写入。确认无误后加 --apply 重跑。");
  } finally {
    await local.$disconnect();
    await remote.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

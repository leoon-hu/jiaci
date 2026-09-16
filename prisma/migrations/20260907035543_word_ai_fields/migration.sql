-- word 表：删掉旧的 ai_data 与生成状态列，改为按学习维度拆分的 ai_* 字段；wordbook 表删掉只为生成进度存在的 status
-- AlterTable
ALTER TABLE "word" DROP COLUMN "ai_data",
DROP COLUMN "ai_version",
DROP COLUMN "gen_error",
DROP COLUMN "gen_status",
DROP COLUMN "generating_at",
ADD COLUMN     "ai_antonyms" JSONB,
ADD COLUMN     "ai_cognates" JSONB,
ADD COLUMN     "ai_collocations" JSONB,
ADD COLUMN     "ai_confusables" JSONB,
ADD COLUMN     "ai_core" TEXT,
ADD COLUMN     "ai_etymology" JSONB,
ADD COLUMN     "ai_examples" JSONB,
ADD COLUMN     "ai_family" JSONB,
ADD COLUMN     "ai_generated_at" TIMESTAMP(3),
ADD COLUMN     "ai_meanings" JSONB,
ADD COLUMN     "ai_mistakes" JSONB,
ADD COLUMN     "ai_mnemonic" TEXT,
ADD COLUMN     "ai_patterns" JSONB,
ADD COLUMN     "ai_phonetic_uk" TEXT,
ADD COLUMN     "ai_phonetic_us" TEXT,
ADD COLUMN     "ai_phrases" JSONB,
ADD COLUMN     "ai_source" TEXT,
ADD COLUMN     "ai_synonyms" JSONB,
ADD COLUMN     "ai_usage" TEXT;

-- AlterTable
ALTER TABLE "wordbook" DROP COLUMN "status";

-- DropEnum
DROP TYPE "GenStatus";

-- DropEnum
DROP TYPE "WordbookStatus";

-- CreateIndex
CREATE INDEX "word_ai_generated_at_idx" ON "word"("ai_generated_at");


COMMENT ON COLUMN "word"."ai_phonetic_us" IS 'AI：美式音标，/ / 包裹';
COMMENT ON COLUMN "word"."ai_phonetic_uk" IS 'AI：英式音标';
COMMENT ON COLUMN "word"."ai_core" IS 'AI：一句话核心义（≤ 30 字）';
COMMENT ON COLUMN "word"."ai_meanings" IS 'AI：按词性分组的义项 [{pos, senses: [{zh, en, ex: {en, zh} | null}]}]';
COMMENT ON COLUMN "word"."ai_examples" IS 'AI：分级例句 [{en, zh, level 1–3}]，3–5 条';
COMMENT ON COLUMN "word"."ai_collocations" IS 'AI：搭配 [{en, zh}]，4–8 条';
COMMENT ON COLUMN "word"."ai_phrases" IS 'AI：短语与习语 [{en, zh}]，0–6 条';
COMMENT ON COLUMN "word"."ai_patterns" IS 'AI：句型 [{en, zh, ex: {en, zh}}]，0–4 条';
COMMENT ON COLUMN "word"."ai_usage" IS 'AI：语域与场景（≤ 150 字）';
COMMENT ON COLUMN "word"."ai_synonyms" IS 'AI：近义词辨析 [{w, m}]，0–6 条，m 为一句区别';
COMMENT ON COLUMN "word"."ai_antonyms" IS 'AI：反义词 [{w, zh}]，0–5 条';
COMMENT ON COLUMN "word"."ai_confusables" IS 'AI：易混词 [{w, m}]，0–4 条';
COMMENT ON COLUMN "word"."ai_mistakes" IS 'AI：常见错误 [{wrong, right, note}]，0–4 条';
COMMENT ON COLUMN "word"."ai_family" IS 'AI：词族（派生词）[{w, pos, zh}]，0–8 条';
COMMENT ON COLUMN "word"."ai_cognates" IS 'AI：同根词 [{w, pos, zh}]，0–6 条';
COMMENT ON COLUMN "word"."ai_mnemonic" IS 'AI：助记（≤ 120 字）';
COMMENT ON COLUMN "word"."ai_etymology" IS 'AI：词源与构词 {origin, parts: [{part, meaning}]}；构词不透明的词为空';
COMMENT ON COLUMN "word"."ai_generated_at" IS 'AI 字段最近一次填充时间；空 = 未填充';
COMMENT ON COLUMN "word"."ai_source" IS 'AI 字段来源：模型@提示词版本（如 deepseek-chat@1），运营手改为 manual';
COMMENT ON TABLE "word" IS '全局单词表：同一拼写只有一条；词典字段来自 ECDICT，ai_* 字段由运营脚本填充，所有用户共用';
COMMENT ON TABLE "wordbook" IS '词库表：内置 / 导入 / 自建';

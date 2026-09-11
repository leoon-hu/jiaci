-- AI 字段从 word 表移到按模型厂商分的 word_ai_openai / word_ai_deepseek 表：每词一行，有行即已填充，用户可选择看哪个模型的数据
-- DropIndex
DROP INDEX "word_ai_generated_at_idx";

-- AlterTable
ALTER TABLE "word" DROP COLUMN "ai_antonyms",
DROP COLUMN "ai_cognates",
DROP COLUMN "ai_collocations",
DROP COLUMN "ai_confusables",
DROP COLUMN "ai_core",
DROP COLUMN "ai_etymology",
DROP COLUMN "ai_examples",
DROP COLUMN "ai_family",
DROP COLUMN "ai_generated_at",
DROP COLUMN "ai_meanings",
DROP COLUMN "ai_mistakes",
DROP COLUMN "ai_mnemonic",
DROP COLUMN "ai_patterns",
DROP COLUMN "ai_phonetic_uk",
DROP COLUMN "ai_phonetic_us",
DROP COLUMN "ai_phrases",
DROP COLUMN "ai_source",
DROP COLUMN "ai_synonyms",
DROP COLUMN "ai_usage";

-- CreateTable
CREATE TABLE "word_ai_openai" (
    "word_id" TEXT NOT NULL,
    "phonetic_us" TEXT,
    "phonetic_uk" TEXT,
    "core" TEXT,
    "meanings" JSONB,
    "examples" JSONB,
    "collocations" JSONB,
    "phrases" JSONB,
    "patterns" JSONB,
    "usage" TEXT,
    "synonyms" JSONB,
    "antonyms" JSONB,
    "confusables" JSONB,
    "mistakes" JSONB,
    "family" JSONB,
    "cognates" JSONB,
    "mnemonic" TEXT,
    "etymology" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "word_ai_openai_pkey" PRIMARY KEY ("word_id")
);

-- CreateTable
CREATE TABLE "word_ai_deepseek" (
    "word_id" TEXT NOT NULL,
    "phonetic_us" TEXT,
    "phonetic_uk" TEXT,
    "core" TEXT,
    "meanings" JSONB,
    "examples" JSONB,
    "collocations" JSONB,
    "phrases" JSONB,
    "patterns" JSONB,
    "usage" TEXT,
    "synonyms" JSONB,
    "antonyms" JSONB,
    "confusables" JSONB,
    "mistakes" JSONB,
    "family" JSONB,
    "cognates" JSONB,
    "mnemonic" TEXT,
    "etymology" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "word_ai_deepseek_pkey" PRIMARY KEY ("word_id")
);

-- AddForeignKey
ALTER TABLE "word_ai_openai" ADD CONSTRAINT "word_ai_openai_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_ai_deepseek" ADD CONSTRAINT "word_ai_deepseek_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMENT ON TABLE "word_ai_openai" IS 'OpenAI 填充的词条 AI 字段：每词一行，有行即已填充';
COMMENT ON COLUMN "word_ai_openai"."word_id" IS '单词 ID';
COMMENT ON COLUMN "word_ai_openai"."phonetic_us" IS '美式音标，/ / 包裹';
COMMENT ON COLUMN "word_ai_openai"."phonetic_uk" IS '英式音标';
COMMENT ON COLUMN "word_ai_openai"."core" IS '一句话核心义（≤ 30 字）';
COMMENT ON COLUMN "word_ai_openai"."meanings" IS '按词性分组的义项 [{pos, senses: [{zh, en, ex: {en, zh} | null}]}]';
COMMENT ON COLUMN "word_ai_openai"."examples" IS '分级例句 [{en, zh, level 1–3}]，3–5 条';
COMMENT ON COLUMN "word_ai_openai"."collocations" IS '搭配 [{en, zh}]，4–8 条';
COMMENT ON COLUMN "word_ai_openai"."phrases" IS '短语与习语 [{en, zh}]，0–6 条';
COMMENT ON COLUMN "word_ai_openai"."patterns" IS '句型 [{en, zh, ex: {en, zh}}]，0–4 条';
COMMENT ON COLUMN "word_ai_openai"."usage" IS '语域与场景（≤ 150 字）';
COMMENT ON COLUMN "word_ai_openai"."synonyms" IS '近义词辨析 [{w, m}]，0–6 条，m 为一句区别';
COMMENT ON COLUMN "word_ai_openai"."antonyms" IS '反义词 [{w, zh}]，0–5 条';
COMMENT ON COLUMN "word_ai_openai"."confusables" IS '易混词 [{w, m}]，0–4 条';
COMMENT ON COLUMN "word_ai_openai"."mistakes" IS '常见错误 [{wrong, right, note}]，0–4 条';
COMMENT ON COLUMN "word_ai_openai"."family" IS '词族（派生词）[{w, pos, zh}]，0–8 条';
COMMENT ON COLUMN "word_ai_openai"."cognates" IS '同根词 [{w, pos, zh}]，0–6 条';
COMMENT ON COLUMN "word_ai_openai"."mnemonic" IS '助记（≤ 120 字）';
COMMENT ON COLUMN "word_ai_openai"."etymology" IS '词源与构词 {origin, parts: [{part, meaning}]}；构词不透明的词为空';
COMMENT ON COLUMN "word_ai_openai"."generated_at" IS '填充时间';
COMMENT ON COLUMN "word_ai_openai"."source" IS '来源：模型@提示词版本，运营手改为 manual';

COMMENT ON TABLE "word_ai_deepseek" IS 'DeepSeek 填充的词条 AI 字段：每词一行，有行即已填充';
COMMENT ON COLUMN "word_ai_deepseek"."word_id" IS '单词 ID';
COMMENT ON COLUMN "word_ai_deepseek"."phonetic_us" IS '美式音标，/ / 包裹';
COMMENT ON COLUMN "word_ai_deepseek"."phonetic_uk" IS '英式音标';
COMMENT ON COLUMN "word_ai_deepseek"."core" IS '一句话核心义（≤ 30 字）';
COMMENT ON COLUMN "word_ai_deepseek"."meanings" IS '按词性分组的义项 [{pos, senses: [{zh, en, ex: {en, zh} | null}]}]';
COMMENT ON COLUMN "word_ai_deepseek"."examples" IS '分级例句 [{en, zh, level 1–3}]，3–5 条';
COMMENT ON COLUMN "word_ai_deepseek"."collocations" IS '搭配 [{en, zh}]，4–8 条';
COMMENT ON COLUMN "word_ai_deepseek"."phrases" IS '短语与习语 [{en, zh}]，0–6 条';
COMMENT ON COLUMN "word_ai_deepseek"."patterns" IS '句型 [{en, zh, ex: {en, zh}}]，0–4 条';
COMMENT ON COLUMN "word_ai_deepseek"."usage" IS '语域与场景（≤ 150 字）';
COMMENT ON COLUMN "word_ai_deepseek"."synonyms" IS '近义词辨析 [{w, m}]，0–6 条，m 为一句区别';
COMMENT ON COLUMN "word_ai_deepseek"."antonyms" IS '反义词 [{w, zh}]，0–5 条';
COMMENT ON COLUMN "word_ai_deepseek"."confusables" IS '易混词 [{w, m}]，0–4 条';
COMMENT ON COLUMN "word_ai_deepseek"."mistakes" IS '常见错误 [{wrong, right, note}]，0–4 条';
COMMENT ON COLUMN "word_ai_deepseek"."family" IS '词族（派生词）[{w, pos, zh}]，0–8 条';
COMMENT ON COLUMN "word_ai_deepseek"."cognates" IS '同根词 [{w, pos, zh}]，0–6 条';
COMMENT ON COLUMN "word_ai_deepseek"."mnemonic" IS '助记（≤ 120 字）';
COMMENT ON COLUMN "word_ai_deepseek"."etymology" IS '词源与构词 {origin, parts: [{part, meaning}]}；构词不透明的词为空';
COMMENT ON COLUMN "word_ai_deepseek"."generated_at" IS '填充时间';
COMMENT ON COLUMN "word_ai_deepseek"."source" IS '来源：模型@提示词版本，运营手改为 manual';

COMMENT ON TABLE "word" IS '全局单词表：同一拼写只有一条；词典字段来自 ECDICT，AI 字段按模型厂商分表存放（word_ai_*）';

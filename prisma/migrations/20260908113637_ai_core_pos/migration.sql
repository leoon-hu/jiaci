-- 单词列表行显示词性：厂商表加 core_pos（核心义的词性），存量行从已填充的 meanings 第一组回填，不调用模型接口

-- AlterTable
ALTER TABLE "word_ai_deepseek" ADD COLUMN     "core_pos" TEXT;

-- AlterTable
ALTER TABLE "word_ai_openai" ADD COLUMN     "core_pos" TEXT;

-- 字段注释
COMMENT ON COLUMN "word_ai_deepseek"."core_pos" IS '核心义的词性（取 meanings 第一组的 pos，列表行显示用）';
COMMENT ON COLUMN "word_ai_openai"."core_pos" IS '核心义的词性（取 meanings 第一组的 pos，列表行显示用）';

-- 回填：meanings 是 [{pos, senses}]，取第一组的 pos（空串按无处理）
UPDATE "word_ai_deepseek" SET "core_pos" = NULLIF(("meanings" -> 0 ->> 'pos'), '')
  WHERE jsonb_typeof("meanings") = 'array' AND jsonb_array_length("meanings") > 0;
UPDATE "word_ai_openai" SET "core_pos" = NULLIF(("meanings" -> 0 ->> 'pos'), '')
  WHERE jsonb_typeof("meanings") = 'array' AND jsonb_array_length("meanings") > 0;

-- AlterEnum
ALTER TYPE "AudioKind" ADD VALUE 'definition';

-- 注释同步（CLAUDE.md：枚举与字段的中文注释在 schema 的 /// 与这里两处都要有）
COMMENT ON TYPE "AudioKind" IS '发音音频文本类型：word 单词 / sentence 例句 / definition 中文释义（列表点词时跟在单词后朗读）';
COMMENT ON COLUMN "audio_text"."kind" IS '类型：word 单词 / sentence 例句 / definition 中文释义';
COMMENT ON COLUMN "audio_text"."text" IS '原文（单词拼写、例句或中文释义）';

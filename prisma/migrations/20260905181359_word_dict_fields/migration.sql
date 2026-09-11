-- CreateEnum
CREATE TYPE "WordKind" AS ENUM ('word', 'phrase');

-- AlterTable
ALTER TABLE "word" ADD COLUMN     "bnc" INTEGER,
ADD COLUMN     "collins" INTEGER,
ADD COLUMN     "definition" TEXT,
ADD COLUMN     "dict_source" TEXT,
ADD COLUMN     "dict_updated_at" TIMESTAMP(3),
ADD COLUMN     "exchange" TEXT,
ADD COLUMN     "frq" INTEGER,
ADD COLUMN     "kind" "WordKind" NOT NULL DEFAULT 'word',
ADD COLUMN     "oxford" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phonetic" TEXT,
ADD COLUMN     "pos" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "translation" TEXT;

-- CreateTable
CREATE TABLE "dict_entry" (
    "word" TEXT NOT NULL,
    "spelling" TEXT NOT NULL,
    "phonetic" TEXT,
    "definition" TEXT,
    "translation" TEXT,
    "pos" TEXT,
    "collins" INTEGER,
    "oxford" BOOLEAN NOT NULL DEFAULT false,
    "tag" TEXT,
    "bnc" INTEGER,
    "frq" INTEGER,
    "exchange" TEXT,
    "detail" TEXT,
    "audio" TEXT,

    CONSTRAINT "dict_entry_pkey" PRIMARY KEY ("word")
);

-- CreateIndex
CREATE INDEX "dict_entry_spelling_idx" ON "dict_entry"("spelling");

-- CreateIndex
CREATE INDEX "dict_entry_frq_idx" ON "dict_entry"("frq");

-- CreateIndex
CREATE INDEX "word_kind_idx" ON "word"("kind");

-- CreateIndex
CREATE INDEX "word_frq_idx" ON "word"("frq");

-- CreateIndex
CREATE INDEX "word_tags_idx" ON "word" USING GIN ("tags");

-- 中文注释（新增枚举、字段与表）
COMMENT ON TYPE "WordKind" IS '词条类型：word 单词 / phrase 短语（含空格）';
COMMENT ON TABLE "word" IS '全局词条表（单词与短语）：同一拼写只有一条；词典字段来自外部数据（ECDICT 等），ai_data 为 AI 生成资料缓存，供所有用户共用';
COMMENT ON COLUMN "word"."spelling" IS '拼写（小写，唯一；短语以单个空格分隔）';
COMMENT ON COLUMN "word"."kind" IS '词条类型：word 单词 / phrase 短语';
COMMENT ON COLUMN "word"."phonetic" IS '音标（IPA，来自词典数据）';
COMMENT ON COLUMN "word"."translation" IS '中文释义（来自词典数据，多行，每行「词性. 释义」）';
COMMENT ON COLUMN "word"."definition" IS '英文释义（来自词典数据，多行）';
COMMENT ON COLUMN "word"."pos" IS '词性及占比，如 n:52/v:48（来自词典数据）';
COMMENT ON COLUMN "word"."collins" IS '柯林斯星级 1–5；空为无';
COMMENT ON COLUMN "word"."oxford" IS '是否牛津 3000 核心词';
COMMENT ON COLUMN "word"."tags" IS '标签数组：考试 zk 中考 / gk 高考 / cet4 / cet6 / ky 考研 / toefl / ielts / gre，后续可加词表标签';
COMMENT ON COLUMN "word"."bnc" IS 'BNC 语料词频排名（越小越常用；空为无数据）';
COMMENT ON COLUMN "word"."frq" IS '当代语料词频排名（越小越常用；空为无数据）';
COMMENT ON COLUMN "word"."exchange" IS '词形变化：p 过去式 / d 过去分词 / i 现在分词 / 3 三单 / r 比较级 / t 最高级 / s 复数 / 0 原形 / 1 变形类型，如 p:took/d:taken';
COMMENT ON COLUMN "word"."dict_source" IS '词典字段来源：ecdict / manual；空表示尚无词典数据';
COMMENT ON COLUMN "word"."dict_updated_at" IS '词典字段更新时间';
COMMENT ON COLUMN "word"."ai_data" IS 'AI 生成的词条资料 JSON：phonetic、meanings、examples、mnemonic、collocations、confusables、meta（后续拆分为独立字段）';

COMMENT ON TABLE "dict_entry" IS 'ECDICT 词典原始数据（MIT 协议，github.com/skywind3000/ECDICT），字段与 ecdict.csv 一致；供运营筛选写入 word 表及查词兜底，应用核心流程不依赖';
COMMENT ON COLUMN "dict_entry"."word" IS '词头（保留原大小写，唯一）';
COMMENT ON COLUMN "dict_entry"."spelling" IS '小写拼写（与 word.spelling 同规则，用于匹配）';
COMMENT ON COLUMN "dict_entry"."phonetic" IS '音标（IPA）';
COMMENT ON COLUMN "dict_entry"."definition" IS '英文释义（多行）';
COMMENT ON COLUMN "dict_entry"."translation" IS '中文释义（多行，每行「词性. 释义」）';
COMMENT ON COLUMN "dict_entry"."pos" IS '词性及占比，如 n:52/v:48';
COMMENT ON COLUMN "dict_entry"."collins" IS '柯林斯星级 1–5；空为无';
COMMENT ON COLUMN "dict_entry"."oxford" IS '是否牛津 3000 核心词';
COMMENT ON COLUMN "dict_entry"."tag" IS '考试标签（空格分隔）：zk 中考 / gk 高考 / cet4 四级 / cet6 六级 / ky 考研 / toefl 托福 / ielts 雅思 / gre';
COMMENT ON COLUMN "dict_entry"."bnc" IS 'BNC 语料词频排名（越小越常用；空为无）';
COMMENT ON COLUMN "dict_entry"."frq" IS '当代语料词频排名（越小越常用；空为无）';
COMMENT ON COLUMN "dict_entry"."exchange" IS '词形变化：p 过去式 / d 过去分词 / i 现在分词 / 3 三单 / r 比较级 / t 最高级 / s 复数 / 0 原形 / 1 变形类型';
COMMENT ON COLUMN "dict_entry"."detail" IS '例句等扩展信息（JSON 文本，多为空）';
COMMENT ON COLUMN "dict_entry"."audio" IS '发音音频地址（多为空）';

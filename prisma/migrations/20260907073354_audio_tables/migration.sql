-- CreateEnum
CREATE TYPE "AudioKind" AS ENUM ('word', 'sentence');

-- CreateEnum
CREATE TYPE "AudioStatus" AS ENUM ('ok', 'failed');

-- CreateTable
CREATE TABLE "audio_text" (
    "text_hash" TEXT NOT NULL,
    "kind" "AudioKind" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_text_pkey" PRIMARY KEY ("text_hash")
);

-- CreateTable
CREATE TABLE "audio_clip" (
    "text_hash" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "status" "AudioStatus" NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audio_clip_pkey" PRIMARY KEY ("text_hash","voice")
);

-- CreateIndex
CREATE INDEX "audio_clip_voice_status_idx" ON "audio_clip"("voice", "status");

-- AddForeignKey
ALTER TABLE "audio_clip" ADD CONSTRAINT "audio_clip_text_hash_fkey" FOREIGN KEY ("text_hash") REFERENCES "audio_text"("text_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- 中文注释
COMMENT ON TYPE "AudioKind" IS '发音音频文本类型：word 单词 / sentence 例句';
COMMENT ON TYPE "AudioStatus" IS '发音音频状态：ok 已生成 / failed 合成失败';
COMMENT ON TABLE "audio_text" IS '允许合成发音音频的文本登记表：单词拼写或例句原文；按需合成接口只接受这里登记过的例句，也是批量生成脚本的待办清单';
COMMENT ON COLUMN "audio_text"."text_hash" IS '规范化文本（去首尾空白、合并连续空格）的 SHA-1';
COMMENT ON COLUMN "audio_text"."kind" IS '类型：word 单词 / sentence 例句';
COMMENT ON COLUMN "audio_text"."text" IS '原文（单词拼写或例句）';
COMMENT ON COLUMN "audio_text"."created_at" IS '登记时间';
COMMENT ON TABLE "audio_clip" IS '已合成的发音音频记录：每个文本 × 音色一行，文件在 AUDIO_DIR 下';
COMMENT ON COLUMN "audio_clip"."text_hash" IS '文本哈希，关联 audio_text';
COMMENT ON COLUMN "audio_clip"."voice" IS '音色名（Edge 如 en-US-AriaNeural，Kokoro 如 af_heart）';
COMMENT ON COLUMN "audio_clip"."provider" IS '合成引擎：edge / kokoro';
COMMENT ON COLUMN "audio_clip"."path" IS '相对 AUDIO_DIR 的文件路径';
COMMENT ON COLUMN "audio_clip"."bytes" IS '文件大小（字节）';
COMMENT ON COLUMN "audio_clip"."status" IS '状态：ok 已生成 / failed 合成失败';
COMMENT ON COLUMN "audio_clip"."error" IS '失败原因';
COMMENT ON COLUMN "audio_clip"."created_at" IS '首次生成时间';
COMMENT ON COLUMN "audio_clip"."updated_at" IS '最近更新时间';

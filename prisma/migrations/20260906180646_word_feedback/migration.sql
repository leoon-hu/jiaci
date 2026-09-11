-- CreateTable
CREATE TABLE "word_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "word_feedback_word_id_idx" ON "word_feedback"("word_id");

-- CreateIndex
CREATE INDEX "word_feedback_user_id_created_at_idx" ON "word_feedback"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "word_feedback" ADD CONSTRAINT "word_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_feedback" ADD CONSTRAINT "word_feedback_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "word_feedback" IS '用户对词条的问题反馈：只记录，运营方用 SQL 查看处理';
COMMENT ON COLUMN "word_feedback"."id" IS '反馈 ID';
COMMENT ON COLUMN "word_feedback"."user_id" IS '提交人';
COMMENT ON COLUMN "word_feedback"."word_id" IS '反馈的单词';
COMMENT ON COLUMN "word_feedback"."content" IS '反馈内容，最多 500 字';
COMMENT ON COLUMN "word_feedback"."created_at" IS '提交时间';

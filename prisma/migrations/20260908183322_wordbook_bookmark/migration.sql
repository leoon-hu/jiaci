-- CreateTable
CREATE TABLE "wordbook_bookmark" (
    "user_id" TEXT NOT NULL,
    "wordbook_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "filter" TEXT NOT NULL DEFAULT 'all',
    "q" TEXT NOT NULL DEFAULT '',
    "sort" TEXT NOT NULL DEFAULT 'order',
    "mode" TEXT NOT NULL DEFAULT 'both',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wordbook_bookmark_pkey" PRIMARY KEY ("user_id","wordbook_id")
);

-- CreateIndex
CREATE INDEX "wordbook_bookmark_wordbook_id_idx" ON "wordbook_bookmark"("wordbook_id");

-- CreateIndex
CREATE INDEX "wordbook_bookmark_word_id_idx" ON "wordbook_bookmark"("word_id");

-- AddForeignKey
ALTER TABLE "wordbook_bookmark" ADD CONSTRAINT "wordbook_bookmark_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wordbook_bookmark" ADD CONSTRAINT "wordbook_bookmark_wordbook_id_fkey" FOREIGN KEY ("wordbook_id") REFERENCES "wordbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wordbook_bookmark" ADD CONSTRAINT "wordbook_bookmark_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 中文注释（与 schema.prisma 的 /// 保持一致）
COMMENT ON TABLE "wordbook_bookmark" IS '词库书签（需求 3.3.5）：一个用户在一本词库里只有一个书签，新的覆盖旧的；除了停在哪个词，还记下当时的浏览条件';
COMMENT ON COLUMN "wordbook_bookmark"."user_id" IS '用户 ID';
COMMENT ON COLUMN "wordbook_bookmark"."wordbook_id" IS '词库 ID';
COMMENT ON COLUMN "wordbook_bookmark"."word_id" IS '书签停在哪个词';
COMMENT ON COLUMN "wordbook_bookmark"."filter" IS '当时的状态筛选：all 全部 / new 未开始 / learning 学习中 / mastered 已掌握 / none 未加入';
COMMENT ON COLUMN "wordbook_bookmark"."q" IS '当时的搜索词；空串表示没有搜索';
COMMENT ON COLUMN "wordbook_bookmark"."sort" IS '当时的排序：order 添加顺序 / alpha 字母 / freq 词频 / due 下次复习时间';
COMMENT ON COLUMN "wordbook_bookmark"."mode" IS '当时的列表显示模式：both 英文 + 释义 / en 隐藏释义 / zh 隐藏英文';
COMMENT ON COLUMN "wordbook_bookmark"."updated_at" IS '最近一次设置书签的时间';

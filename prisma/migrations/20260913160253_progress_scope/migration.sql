-- 词库「独立进度」：进度与学习记录加 scope 列（空串 = 全局进度，否则 = 开了独立进度的词库 id），
-- user_word_progress 主键扩成 (user_id, word_id, scope)。现有行全部落在全局，不动数据。
-- 新表 user_wordbook_setting 存每个用户对每本词库的开关（内置词库共用，所以按用户存）。
-- AlterTable
ALTER TABLE "study_log" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "user_word_progress" DROP CONSTRAINT "user_word_progress_pkey",
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "user_word_progress_pkey" PRIMARY KEY ("user_id", "word_id", "scope");

-- CreateTable
CREATE TABLE "user_wordbook_setting" (
    "user_id" TEXT NOT NULL,
    "wordbook_id" TEXT NOT NULL,
    "own_progress" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_wordbook_setting_pkey" PRIMARY KEY ("user_id","wordbook_id")
);

-- CreateIndex
CREATE INDEX "user_wordbook_setting_wordbook_id_idx" ON "user_wordbook_setting"("wordbook_id");

-- AddForeignKey
ALTER TABLE "user_wordbook_setting" ADD CONSTRAINT "user_wordbook_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_wordbook_setting" ADD CONSTRAINT "user_wordbook_setting_wordbook_id_fkey" FOREIGN KEY ("wordbook_id") REFERENCES "wordbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "user_word_progress"."scope" IS '进度作用域：空串 = 全局进度（默认，所有词库共用）；否则 = 开了「独立进度」的词库 id，该词库里的词单独一套记录。不建外键，删词库时显式清理';
COMMENT ON COLUMN "user_word_progress"."status" IS '状态：new 未开始 / learning 学习中 / mastered 已掌握 / removed 已移出';
COMMENT ON COLUMN "study_log"."scope" IS '进度作用域，与 user_word_progress.scope 同义：这条记录属于全局进度（空串）还是某本词库的独立进度';
COMMENT ON TABLE "user_wordbook_setting" IS '用户对某本词库的设置表：目前只有「独立进度」开关。内置词库大家共用，所以按用户分开存；没有行 = 默认（全局进度）';
COMMENT ON COLUMN "user_wordbook_setting"."user_id" IS '用户 ID';
COMMENT ON COLUMN "user_wordbook_setting"."wordbook_id" IS '词库 ID';
COMMENT ON COLUMN "user_wordbook_setting"."own_progress" IS '独立进度：开着时这本词库里的词读写 scope = 词库 id 的那套进度，关掉回到全局进度；两套都保留，来回切换互不影响';
COMMENT ON COLUMN "user_wordbook_setting"."updated_at" IS '最近修改时间';

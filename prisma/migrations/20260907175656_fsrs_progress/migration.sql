-- 调度算法换成 FSRS：进度表加稳定性、难度、最近打分日期，去掉 SM-2 的难度因子
ALTER TABLE "user_word_progress" ADD COLUMN "stability" DOUBLE PRECISION, ADD COLUMN "difficulty" DOUBLE PRECISION, ADD COLUMN "last_review" DATE;
-- 已有进度：稳定性按当前间隔，难度取中值，最近打分按更新时间
UPDATE "user_word_progress" SET "stability" = "interval", "difficulty" = 5, "last_review" = ("updated_at" AT TIME ZONE 'UTC')::date WHERE "interval" > 0;
ALTER TABLE "user_word_progress" DROP COLUMN "ease";
COMMENT ON TABLE "user_word_progress" IS '用户单词学习进度表（FSRS 调度）：无记录 = 未学过';
COMMENT ON COLUMN "user_word_progress"."interval" IS '当前安排的复习间隔（天，FSRS 的 scheduled_days）；0 表示新词';
COMMENT ON COLUMN "user_word_progress"."stability" IS 'FSRS 记忆稳定性（天）；新词为空';
COMMENT ON COLUMN "user_word_progress"."difficulty" IS 'FSRS 难度 1–10；新词为空';
COMMENT ON COLUMN "user_word_progress"."last_review" IS '最近一次打分的日期，用于按实际间隔计算';
COMMENT ON COLUMN "user_word_progress"."lapses" IS '遗忘次数（复习时打「模糊」的次数）';

-- word 表：加显示用词头 display，删掉 ECDICT 中全空的 pos 列
ALTER TABLE "word" DROP COLUMN "pos";
ALTER TABLE "word" ADD COLUMN "display" TEXT;
COMMENT ON COLUMN "word"."display" IS '显示用词头（保留原大小写，如 Monday、China）；空表示与 spelling 相同';

-- 同类词（需求 3.4 I7）：两张新表，类别 + 成员；内容由脚本按仓库里的分类词表整表刷新，不动任何已有的表与数据。

-- CreateTable
CREATE TABLE "word_category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "word_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_category_member" (
    "category_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "gloss" TEXT,

    CONSTRAINT "word_category_member_pkey" PRIMARY KEY ("category_id","word_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "word_category_name_key" ON "word_category"("name");

-- CreateIndex
CREATE INDEX "word_category_member_word_id_idx" ON "word_category_member"("word_id");

-- AddForeignKey
ALTER TABLE "word_category_member" ADD CONSTRAINT "word_category_member_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "word_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_category_member" ADD CONSTRAINT "word_category_member_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "word_category" IS '同类词类别（需求 3.4 I7）：「家庭成员」「水果」「学科」这类语义类别，名字就是界面上显示的；内容来自仓库里手工整理的分类词表，由 scripts/categories.ts 整表刷新，不是 AI 字段，没有用户数据挂在上面';
COMMENT ON COLUMN "word_category"."id" IS '类别 ID';
COMMENT ON COLUMN "word_category"."name" IS '类别名（中文，界面上直接显示），唯一';
COMMENT ON COLUMN "word_category"."sort_order" IS '展示顺序（词表里的先后）';
COMMENT ON TABLE "word_category_member" IS '同类词类别的成员：一个词可以属于多个类别（orange 既是水果也是颜色）';
COMMENT ON COLUMN "word_category_member"."category_id" IS '类别 ID';
COMMENT ON COLUMN "word_category_member"."word_id" IS '单词 ID';
COMMENT ON COLUMN "word_category_member"."sort_order" IS '在类别里的顺序（词表里的先后，常用的在前）';
COMMENT ON COLUMN "word_category_member"."gloss" IS '这个词在本类别里显示的释义：多义词按类别该取的那个义项（词表里写「词=释义」）；空 = 用词条自己的主释义';

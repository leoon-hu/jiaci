-- CreateEnum
CREATE TYPE "WordbookType" AS ENUM ('builtin', 'import', 'custom');

-- CreateEnum
CREATE TYPE "WordbookStatus" AS ENUM ('ready', 'generating');

-- CreateEnum
CREATE TYPE "GenStatus" AS ENUM ('none', 'generating', 'ok', 'failed');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('new', 'learning', 'mastered', 'removed');

-- CreateEnum
CREATE TYPE "StudyResult" AS ENUM ('know', 'fuzzy', 'master', 'reset', 'remove');

-- CreateTable
CREATE TABLE "user_profile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_code" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wordbook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WordbookType" NOT NULL,
    "owner_id" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "status" "WordbookStatus" NOT NULL DEFAULT 'ready',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wordbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word" (
    "id" TEXT NOT NULL,
    "spelling" TEXT NOT NULL,
    "ai_data" JSONB,
    "ai_version" INTEGER NOT NULL DEFAULT 0,
    "gen_status" "GenStatus" NOT NULL DEFAULT 'none',
    "gen_error" TEXT,
    "generating_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wordbook_word" (
    "wordbook_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "wordbook_word_pkey" PRIMARY KEY ("wordbook_id","word_id")
);

-- CreateTable
CREATE TABLE "user_word_note" (
    "user_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "note" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_word_note_pkey" PRIMARY KEY ("user_id","word_id")
);

-- CreateTable
CREATE TABLE "user_word_progress" (
    "user_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "due_date" DATE,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "status" "ProgressStatus" NOT NULL DEFAULT 'new',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_word_progress_pkey" PRIMARY KEY ("user_id","word_id")
);

-- CreateTable
CREATE TABLE "study_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "word_id" TEXT NOT NULL,
    "result" "StudyResult" NOT NULL,
    "next_interval" INTEGER NOT NULL DEFAULT 0,
    "client_ts" TEXT,
    "studied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_current_wordbook" (
    "user_id" TEXT NOT NULL,
    "wordbook_id" TEXT NOT NULL,

    CONSTRAINT "user_current_wordbook_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_email_key" ON "user_profile"("email");

-- CreateIndex
CREATE INDEX "otp_code_email_created_at_idx" ON "otp_code"("email", "created_at");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "wordbook_owner_id_idx" ON "wordbook"("owner_id");

-- CreateIndex
CREATE INDEX "wordbook_type_idx" ON "wordbook"("type");

-- CreateIndex
CREATE UNIQUE INDEX "word_spelling_key" ON "word"("spelling");

-- CreateIndex
CREATE INDEX "wordbook_word_wordbook_id_sort_order_idx" ON "wordbook_word"("wordbook_id", "sort_order");

-- CreateIndex
CREATE INDEX "wordbook_word_word_id_idx" ON "wordbook_word"("word_id");

-- CreateIndex
CREATE INDEX "user_word_progress_user_id_due_date_idx" ON "user_word_progress"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "user_word_progress_user_id_status_idx" ON "user_word_progress"("user_id", "status");

-- CreateIndex
CREATE INDEX "study_log_user_id_studied_at_idx" ON "study_log"("user_id", "studied_at");

-- CreateIndex
CREATE INDEX "study_log_user_id_word_id_studied_at_idx" ON "study_log"("user_id", "word_id", "studied_at");

-- CreateIndex
CREATE UNIQUE INDEX "study_log_user_id_client_ts_key" ON "study_log"("user_id", "client_ts");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wordbook" ADD CONSTRAINT "wordbook_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wordbook_word" ADD CONSTRAINT "wordbook_word_wordbook_id_fkey" FOREIGN KEY ("wordbook_id") REFERENCES "wordbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wordbook_word" ADD CONSTRAINT "wordbook_word_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_note" ADD CONSTRAINT "user_word_note_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_note" ADD CONSTRAINT "user_word_note_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_progress" ADD CONSTRAINT "user_word_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_progress" ADD CONSTRAINT "user_word_progress_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_log" ADD CONSTRAINT "study_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_log" ADD CONSTRAINT "study_log_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_current_wordbook" ADD CONSTRAINT "user_current_wordbook_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_current_wordbook" ADD CONSTRAINT "user_current_wordbook_wordbook_id_fkey" FOREIGN KEY ("wordbook_id") REFERENCES "wordbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "theme_messages" ADD COLUMN "metrics" TEXT;

-- CreateTable
CREATE TABLE "vision_config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "base_url" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "api_key" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL
);
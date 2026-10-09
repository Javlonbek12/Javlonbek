-- CreateEnum
CREATE TYPE "ContentTopic" AS ENUM ('PRICES', 'NEW_PRODUCTS', 'PROMO', 'TRAINING', 'RESEARCH', 'MOTIVATION', 'COMPANY_NEWS', 'SERVICE');

-- CreateEnum
CREATE TYPE "ContentBrand" AS ENUM ('ESSE', 'BOHEM', 'PINE', 'BLOOMING', 'SIMPLE', 'GENERAL');

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "brand" "ContentBrand",
ADD COLUMN     "tagPending" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tagSource" TEXT,
ADD COLUMN     "topic" "ContentTopic";

-- CreateIndex
CREATE INDEX "ContentPost_tagPending_idx" ON "ContentPost"("tagPending");

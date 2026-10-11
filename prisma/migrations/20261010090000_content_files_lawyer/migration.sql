-- CreateEnum
CREATE TYPE "ContentLang" AS ENUM ('RU', 'UZ');

-- CreateEnum
CREATE TYPE "ContentFileKind" AS ENUM ('PHOTO', 'VIDEO', 'FILE');

-- AlterEnum
ALTER TYPE "ContentStatus" ADD VALUE 'LEGAL_REVIEW';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'LAWYER';

-- CreateTable
CREATE TABLE "ContentFile" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "lang" "ContentLang" NOT NULL,
    "kind" "ContentFileKind" NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentFile_postId_lang_sortOrder_idx" ON "ContentFile"("postId", "lang", "sortOrder");

-- AddForeignKey
ALTER TABLE "ContentFile" ADD CONSTRAINT "ContentFile_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The old single visual becomes the first photo of both languages (one file on disk, two rows).
INSERT INTO "ContentFile" ("id", "postId", "lang", "kind", "path", "name", "mime", "size")
SELECT gen_random_uuid()::text, p."id", l."lang"::"ContentLang", 'PHOTO', p."imagePath",
       COALESCE(p."imageName", 'image'),
       CASE lower(substring(p."imagePath" from '\.([a-z]+)$'))
         WHEN 'png' THEN 'image/png'
         WHEN 'webp' THEN 'image/webp'
         WHEN 'gif' THEN 'image/gif'
         ELSE 'image/jpeg'
       END,
       0
FROM "ContentPost" p
CROSS JOIN (VALUES ('RU'), ('UZ')) AS l("lang")
WHERE p."imagePath" IS NOT NULL;

-- AlterTable
ALTER TABLE "ContentPost" DROP COLUMN "imageName",
DROP COLUMN "imagePath";

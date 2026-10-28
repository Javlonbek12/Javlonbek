-- AlterEnum
ALTER TYPE "PosmType" ADD VALUE 'SHELFTALKER';

-- AlterTable
ALTER TABLE "Planogram" ADD COLUMN     "shelftalkers" JSONB NOT NULL DEFAULT '{}';


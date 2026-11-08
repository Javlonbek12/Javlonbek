-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "finishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConnectRecord" ADD COLUMN     "asOf" TEXT;

-- AlterTable
ALTER TABLE "ConnectImport" ADD COLUMN     "kept" INTEGER NOT NULL DEFAULT 0;


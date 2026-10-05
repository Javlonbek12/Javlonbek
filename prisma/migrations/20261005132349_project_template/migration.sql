-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "anchorDate" DATE,
ADD COLUMN     "planSections" JSONB,
ADD COLUMN     "template" TEXT;

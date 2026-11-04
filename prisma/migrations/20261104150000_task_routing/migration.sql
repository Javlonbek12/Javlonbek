-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "deciderIds" TEXT[],
ADD COLUMN     "historical" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labels" TEXT[],
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "DeletedTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "deletedById" TEXT NOT NULL,
    "reason" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedTask_deletedAt_idx" ON "DeletedTask"("deletedAt");


-- Existing tasks: the status changed no later than the last edit.
UPDATE "Task" SET "statusChangedAt" = "updatedAt";

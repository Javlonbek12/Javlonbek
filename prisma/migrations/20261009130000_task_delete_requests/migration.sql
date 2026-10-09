-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deleteRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deleteRequestedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_deleteRequestedAt_idx" ON "Task"("deleteRequestedAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_deleteRequestedById_fkey" FOREIGN KEY ("deleteRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


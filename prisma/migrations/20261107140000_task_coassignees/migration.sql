-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "coAssigneeIds" TEXT[];

-- CreateTable
CREATE TABLE "TaskCoAssigneeRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "deciderIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCoAssigneeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskCoAssigneeRequest_taskId_userId_key" ON "TaskCoAssigneeRequest"("taskId", "userId");

-- AddForeignKey
ALTER TABLE "TaskCoAssigneeRequest" ADD CONSTRAINT "TaskCoAssigneeRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCoAssigneeRequest" ADD CONSTRAINT "TaskCoAssigneeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCoAssigneeRequest" ADD CONSTRAINT "TaskCoAssigneeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


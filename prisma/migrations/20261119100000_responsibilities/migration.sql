-- CreateEnum
CREATE TYPE "ResponsibilityStatus" AS ENUM ('CONFIRMED', 'SUGGESTED');

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT,
    "positionId" TEXT,
    "deputyId" TEXT,
    "module" TEXT,
    "status" "ResponsibilityStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Responsibility_userId_idx" ON "Responsibility"("userId");

-- CreateIndex
CREATE INDEX "Responsibility_positionId_idx" ON "Responsibility"("positionId");

-- CreateIndex
CREATE INDEX "Responsibility_deputyId_idx" ON "Responsibility"("deputyId");

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_deputyId_fkey" FOREIGN KEY ("deputyId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


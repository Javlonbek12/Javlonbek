-- CreateEnum
CREATE TYPE "SopKind" AS ENUM ('OURS', 'HQ_DRAFT', 'HQ_FINAL');

-- CreateEnum
CREATE TYPE "SopMarkStatus" AS ENUM ('CHECKED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "SopUpload" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "fileName" TEXT NOT NULL,
    "fileDate" TEXT,
    "cycle" TEXT NOT NULL,
    "kind" "SopKind" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "market" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "dataSize" INTEGER NOT NULL,
    "skuCount" INTEGER NOT NULL,

    CONSTRAINT "SopUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopCycle" (
    "id" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopMark" (
    "id" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "SopMarkStatus" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopUpload_cycle_createdAt_idx" ON "SopUpload"("cycle", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SopCycle_cycle_key" ON "SopCycle"("cycle");

-- CreateIndex
CREATE UNIQUE INDEX "SopMark_cycle_key_key" ON "SopMark"("cycle", "key");

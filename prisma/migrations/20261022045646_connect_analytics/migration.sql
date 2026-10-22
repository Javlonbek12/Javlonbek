-- CreateEnum
CREATE TYPE "ConnectKind" AS ENUM ('OOS', 'ORDER', 'PAYMENT', 'VISIT');

-- CreateTable
CREATE TABLE "ConnectRecord" (
    "id" TEXT NOT NULL,
    "kind" "ConnectKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "storeCode" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "city" TEXT,
    "channel" TEXT,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "person" TEXT,
    "data" JSONB NOT NULL,
    "importId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "kinds" TEXT NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectRecord_kind_month_idx" ON "ConnectRecord"("kind", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectRecord_kind_externalId_key" ON "ConnectRecord"("kind", "externalId");

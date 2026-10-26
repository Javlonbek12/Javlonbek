-- POSM orders become versions: every item belongs to an order. Items uploaded before go into
-- a first order ("Заказ 1"). Installed equipment now comes unit by unit (DistUnit) with the
-- responsible TSM from the outlet base (DistOutlet).

-- DropIndex
DROP INDEX "DistPosm_name_key";

-- AlterTable
ALTER TABLE "DistEquipmentCount" ALTER COLUMN "count" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DistUnit" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "tsm" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DistUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistOutlet" (
    "outletId" TEXT NOT NULL,
    "region" TEXT,
    "tsm" TEXT,

    CONSTRAINT "DistOutlet_pkey" PRIMARY KEY ("outletId")
);

-- CreateTable
CREATE TABLE "DistOrder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderedOn" DATE NOT NULL,
    "note" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistOrder_pkey" PRIMARY KEY ("id")
);

-- The first order for the items already there.
INSERT INTO "DistOrder" ("id", "name", "orderedOn", "createdById")
SELECT 'distorder-first', 'Заказ 1', CURRENT_DATE,
       (SELECT "id" FROM "User" ORDER BY ("role" = 'OWNER') DESC, "createdAt" ASC LIMIT 1)
WHERE EXISTS (SELECT 1 FROM "DistPosm") AND EXISTS (SELECT 1 FROM "User");

-- AlterTable
ALTER TABLE "DistPosm" ADD COLUMN "orderId" TEXT;
UPDATE "DistPosm" SET "orderId" = 'distorder-first';
ALTER TABLE "DistPosm" ALTER COLUMN "orderId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DistUnit_outletId_idx" ON "DistUnit"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "DistPosm_orderId_name_key" ON "DistPosm"("orderId", "name");

-- AddForeignKey
ALTER TABLE "DistOrder" ADD CONSTRAINT "DistOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistPosm" ADD CONSTRAINT "DistPosm_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "DistUnit" DROP COLUMN "tsm",
ADD COLUMN     "outletKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "posName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tin" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "outletId" SET DEFAULT '';

-- CreateTable
CREATE TABLE "DistSeenOutlet" (
    "outletId" TEXT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posName" TEXT NOT NULL DEFAULT '',
    "tin" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DistSeenOutlet_pkey" PRIMARY KEY ("outletId")
);

-- CreateTable
CREATE TABLE "DistSkippedRow" (
    "id" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DistSkippedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPurchase" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "document" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPendingImport" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistPendingImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DistPurchase_type_idx" ON "DistPurchase"("type");

-- AddForeignKey
ALTER TABLE "DistPurchase" ADD CONSTRAINT "DistPurchase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Units already loaded: their outlet key is their ID, and their IDs count as seen now.
UPDATE "DistUnit" SET "outletKey" = "outletId";
INSERT INTO "DistSeenOutlet" ("outletId")
SELECT DISTINCT "outletId" FROM "DistUnit" WHERE "outletId" <> ''
ON CONFLICT DO NOTHING;

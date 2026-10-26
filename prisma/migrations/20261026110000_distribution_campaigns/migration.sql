-- POSM orders become campaigns: concept, key visual files, the elements ordered on which equipment,
-- the printer's prices, and replacement in the shops. The order date is set when POSM is ordered.

-- CreateEnum
CREATE TYPE "DistFileKind" AS ENUM ('CONCEPT', 'KEY_VISUAL', 'QUOTE', 'EAS', 'OTHER');

-- AlterTable
ALTER TABLE "DistOrder" ADD COLUMN     "conceptApprovedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "kvFinalAt" TIMESTAMP(3),
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "reservePct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
ADD COLUMN     "withStock" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "orderedOn" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DistPosm" ADD COLUMN     "elementId" TEXT,
ADD COLUMN     "price" DOUBLE PRECISION,
ADD COLUMN     "priceConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "quoteNo" TEXT,
ADD COLUMN     "supplier" TEXT;

-- CreateTable
CREATE TABLE "DistCampaignFile" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "DistFileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistCampaignFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistCampaignElement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "perUnit" JSONB,

    CONSTRAINT "DistCampaignElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPriceQuote" (
    "id" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "supplier" TEXT,
    "quoteNo" TEXT,
    "quotedOn" DATE NOT NULL,
    "orderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistPriceQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistReplacement" (
    "orderId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "replaced" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistReplacement_pkey" PRIMARY KEY ("orderId","outletId")
);

-- CreateIndex
CREATE INDEX "DistCampaignFile_orderId_idx" ON "DistCampaignFile"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DistCampaignElement_orderId_elementId_key" ON "DistCampaignElement"("orderId", "elementId");

-- CreateIndex
CREATE INDEX "DistPriceQuote_elementId_type_idx" ON "DistPriceQuote"("elementId", "type");

-- AddForeignKey
ALTER TABLE "DistOrder" ADD CONSTRAINT "DistOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistCampaignFile" ADD CONSTRAINT "DistCampaignFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistCampaignFile" ADD CONSTRAINT "DistCampaignFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistCampaignElement" ADD CONSTRAINT "DistCampaignElement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistCampaignElement" ADD CONSTRAINT "DistCampaignElement_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "DistElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistPriceQuote" ADD CONSTRAINT "DistPriceQuote_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "DistElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistPriceQuote" ADD CONSTRAINT "DistPriceQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistReplacement" ADD CONSTRAINT "DistReplacement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


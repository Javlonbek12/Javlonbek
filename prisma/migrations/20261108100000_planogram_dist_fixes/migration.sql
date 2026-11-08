-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "mandatorySkuIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "DistPurchase" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "DistOrder" ADD COLUMN     "frozenBase" JSONB;


-- AlterTable
ALTER TABLE "DistShipment" ADD COLUMN "waybill" INTEGER;

-- CreateIndex
CREATE INDEX "DistShipment_waybill_idx" ON "DistShipment"("waybill");

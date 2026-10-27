-- A purchase covers one equipment type or a group bought as one.
ALTER TABLE "DistPurchase" ADD COLUMN "types" TEXT[];
UPDATE "DistPurchase" SET "types" = ARRAY["type"];
ALTER TABLE "DistPurchase" ALTER COLUMN "types" SET NOT NULL;
DROP INDEX "DistPurchase_type_idx";
ALTER TABLE "DistPurchase" DROP COLUMN "type";

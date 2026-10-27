-- AlterTable
ALTER TABLE "DistOrder" ADD COLUMN     "reserveByType" JSONB;


-- The old «Shelftalker» element (from the first POSM list) is replaced by «Shelftalker №1…4»
-- (by shelf). Removed only where no campaign or quote uses it.
DELETE FROM "DistElement"
WHERE "name" = 'Shelftalker'
  AND NOT EXISTS (SELECT 1 FROM "DistCampaignElement" c WHERE c."elementId" = "DistElement"."id")
  AND NOT EXISTS (SELECT 1 FROM "DistPriceQuote" q WHERE q."elementId" = "DistElement"."id");

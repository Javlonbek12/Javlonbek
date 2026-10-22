-- AlterTable
ALTER TABLE "ContentSection" ADD COLUMN     "nameEn" TEXT;

-- English names of the built-in sections.
UPDATE "ContentSection" SET "nameEn" = CASE "id"
  WHEN 'PRICES' THEN 'Prices'
  WHEN 'NEW_PRODUCTS' THEN 'New products'
  WHEN 'PROMO' THEN 'Promotions and mechanics'
  WHEN 'TRAINING' THEN 'Training'
  WHEN 'RESEARCH' THEN 'Surveys and research'
  WHEN 'MOTIVATION' THEN 'Motivation and contests'
  WHEN 'COMPANY_NEWS' THEN 'Company news'
  WHEN 'SERVICE' THEN 'Service and support'
END
WHERE "id" IN ('PRICES', 'NEW_PRODUCTS', 'PROMO', 'TRAINING', 'RESEARCH', 'MOTIVATION', 'COMPANY_NEWS', 'SERVICE');

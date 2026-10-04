-- CreateEnum
CREATE TYPE "PriceLabelStyle" AS ENUM ('NUMBER', 'MING');

-- CreateEnum
CREATE TYPE "PosmType" AS ENUM ('HEADER', 'BANNER', 'STICKER');

-- CreateEnum
CREATE TYPE "PlanogramStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SlotKind" AS ENUM ('SKU', 'POSM', 'EMPTY');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('MANDATORY_SKUS', 'FACINGS', 'BRAND_BLOCKS', 'BRAND_ORDER', 'NEW_ITEMS', 'ALL_SLOTS_DECIDED');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('CRITICAL', 'WARNING');

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT,
    "imagePath" TEXT,
    "defaultBadges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "newSince" DATE,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "priceStyle" "PriceLabelStyle" NOT NULL DEFAULT 'NUMBER',
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuPrice" (
    "priceListId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "SkuPrice_pkey" PRIMARY KEY ("priceListId","skuId")
);

-- CreateTable
CREATE TABLE "Posm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PosmType" NOT NULL,
    "slotSpan" INTEGER NOT NULL DEFAULT 1,
    "imagePath" TEXT,
    "color" TEXT NOT NULL DEFAULT '#16a34a',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Posm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Planogram" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "project" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "status" "PlanogramStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "previousVersionId" TEXT,
    "priceListId" TEXT,
    "headerPosmId" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "shareToken" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Planogram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanogramSlot" (
    "planogramId" TEXT NOT NULL,
    "shelf" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SlotKind" NOT NULL,
    "skuId" TEXT,
    "posmId" TEXT,
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PlanogramSlot_pkey" PRIMARY KEY ("planogramId","shelf","position")
);

-- CreateTable
CREATE TABLE "PlanogramRule" (
    "id" TEXT NOT NULL,
    "planogramId" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PlanogramRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_code_key" ON "Equipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Planogram_shareToken_key" ON "Planogram"("shareToken");

-- CreateIndex
CREATE INDEX "Planogram_rootId_idx" ON "Planogram"("rootId");

-- CreateIndex
CREATE INDEX "Planogram_status_idx" ON "Planogram"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanogramRule_planogramId_kind_key" ON "PlanogramRule"("planogramId", "kind");

-- AddForeignKey
ALTER TABLE "SkuPrice" ADD CONSTRAINT "SkuPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuPrice" ADD CONSTRAINT "SkuPrice_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planogram" ADD CONSTRAINT "Planogram_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planogram" ADD CONSTRAINT "Planogram_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planogram" ADD CONSTRAINT "Planogram_headerPosmId_fkey" FOREIGN KEY ("headerPosmId") REFERENCES "Posm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planogram" ADD CONSTRAINT "Planogram_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Planogram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanogramSlot" ADD CONSTRAINT "PlanogramSlot_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "Planogram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanogramSlot" ADD CONSTRAINT "PlanogramSlot_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanogramSlot" ADD CONSTRAINT "PlanogramSlot_posmId_fkey" FOREIGN KEY ("posmId") REFERENCES "Posm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanogramRule" ADD CONSTRAINT "PlanogramRule_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "Planogram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

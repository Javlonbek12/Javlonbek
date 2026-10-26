-- CreateEnum
CREATE TYPE "DistCountKind" AS ENUM ('INSTALLED', 'STOCK');

-- CreateEnum
CREATE TYPE "DistBase" AS ENUM ('UNITS', 'SLOTS', 'PLANOGRAM');

-- CreateTable
CREATE TABLE "DistEquipmentCount" (
    "id" TEXT NOT NULL,
    "kind" "DistCountKind" NOT NULL,
    "region" TEXT NOT NULL,
    "tsm" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "DistEquipmentCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPosm" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "equipmentLabel" TEXT,
    "size" TEXT,
    "material" TEXT,
    "orderedFor" INTEGER NOT NULL DEFAULT 0,
    "inStock" INTEGER NOT NULL DEFAULT 0,
    "ordered" INTEGER NOT NULL DEFAULT 0,
    "reservePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "base" "DistBase" NOT NULL DEFAULT 'UNITS',
    "norm" DOUBLE PRECISION,
    "normReserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistPosm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistShipment" (
    "id" TEXT NOT NULL,
    "posmId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shippedOn" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DistEquipmentCount_kind_region_tsm_type_key" ON "DistEquipmentCount"("kind", "region", "tsm", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DistPosm_name_key" ON "DistPosm"("name");

-- CreateIndex
CREATE INDEX "DistShipment_posmId_idx" ON "DistShipment"("posmId");

-- CreateIndex
CREATE INDEX "DistShipment_destination_idx" ON "DistShipment"("destination");

-- AddForeignKey
ALTER TABLE "DistShipment" ADD CONSTRAINT "DistShipment_posmId_fkey" FOREIGN KEY ("posmId") REFERENCES "DistPosm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistShipment" ADD CONSTRAINT "DistShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The order builder's catalog: equipment dimensions by type, POSM elements and their print sizes
-- on each equipment type. Seeded with the KT&G equipment sizes sheet and the sizes of the first
-- POSM list (marked unconfirmed: print sizes can differ by equipment).

-- CreateTable
CREATE TABLE "DistTypeSize" (
    "type" TEXT NOT NULL,
    "heightMm" DOUBLE PRECISION,
    "widthMm" DOUBLE PRECISION,
    "depthMm" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "DistTypeSize_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "DistElement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "material" TEXT,

    CONSTRAINT "DistElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistElementSize" (
    "id" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "heightMm" DOUBLE PRECISION,
    "widthMm" DOUBLE PRECISION,
    "perUnit" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "material" TEXT,
    "note" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DistElementSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DistElement_name_key" ON "DistElement"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DistElementSize_elementId_type_key" ON "DistElementSize"("elementId", "type");

-- AddForeignKey
ALTER TABLE "DistElementSize" ADD CONSTRAINT "DistElementSize_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "DistElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Equipment dimensions (KT&G «Общая таблица размеров»).
INSERT INTO "DistTypeSize" ("type", "heightMm", "widthMm", "depthMm", "note") VALUES
  ('MW24_L', 2175, 690, 400, 'Zarrez L (10x9), 10C9T'),
  ('MW24_M', 2174, 450, 380, 'Zarrez M (6x9), 6C9T'),
  ('MW24_S', 357, 810, 330, 'Zarrez S (10x2), 10C2T'),
  ('MW25_L', 2210, 780, 405, 'Metawerk L (10x10), 10C10T'),
  ('MW25_M', 2238, 469, 405, 'Metawerk M (6x10), 6C10T'),
  ('DG_L', 2220, 719, 425, 'Display Group L (10x10), 10C10T'),
  ('DG_M', 2220, 479, 425, 'Display Group M (6x10), 6C10T'),
  ('DG_C', 1165, 706, 400, 'Display Group C (10x6), 10C6T'),
  ('POSI_XL', 2265, 815, 400, 'POSI XL (12x10), 12C10T'),
  ('POSI_L', 2180, 690, 365, 'POSI L (10x9), 10C9T'),
  ('POSI_M', 2180, 434, 365, 'POSI M (6x9), 6C9T'),
  ('POSI_C', 1135, 690, 365, 'POSI C (10x6), 10C6T');

-- Elements.
INSERT INTO "DistElement" ("id", "name", "position", "material") VALUES
  ('distel-header', 'Header', 1, NULL),
  ('distel-shelftalker', 'Shelftalker', 2, 'Backprint with UV print'),
  ('distel-divider', 'Divider', 3, 'PET plastic'),
  ('distel-pricetag', 'Ценник', 4, 'Backprint with UV print');

-- Print sizes from the first POSM list: to be confirmed for each equipment.
INSERT INTO "DistElementSize" ("id", "elementId", "type", "heightMm", "widthMm", "perUnit") VALUES
  ('distel-shelftalker-dg_l', 'distel-shelftalker', 'DG_L', 38, 625, 1),
  ('distel-shelftalker-mw25_l', 'distel-shelftalker', 'MW25_L', 38, 625, 1),
  ('distel-shelftalker-mw24_l', 'distel-shelftalker', 'MW24_L', 38, 625, 1),
  ('distel-shelftalker-dg_m', 'distel-shelftalker', 'DG_M', 38, 382, 1),
  ('distel-shelftalker-mw25_m', 'distel-shelftalker', 'MW25_M', 38, 382, 1),
  ('distel-shelftalker-mw24_m', 'distel-shelftalker', 'MW24_M', 38, 382, 1),
  ('distel-shelftalker-posi_xl', 'distel-shelftalker', 'POSI_XL', 28, 760, 1),
  ('distel-shelftalker-posi_l', 'distel-shelftalker', 'POSI_L', 28, 640, 1),
  ('distel-shelftalker-posi_m', 'distel-shelftalker', 'POSI_M', 28, 385, 1),
  ('distel-divider-posi_xl', 'distel-divider', 'POSI_XL', 105, 120, NULL),
  ('distel-divider-posi_l', 'distel-divider', 'POSI_L', 105, 120, NULL),
  ('distel-divider-posi_m', 'distel-divider', 'POSI_M', 105, 120, NULL),
  ('distel-divider-posi_c', 'distel-divider', 'POSI_C', 105, 120, NULL),
  ('distel-divider-dg_l', 'distel-divider', 'DG_L', 105, 120, NULL),
  ('distel-divider-dg_m', 'distel-divider', 'DG_M', 105, 120, NULL),
  ('distel-divider-dg_c', 'distel-divider', 'DG_C', 105, 120, NULL),
  ('distel-divider-mw25_l', 'distel-divider', 'MW25_L', 105, 120, NULL),
  ('distel-divider-mw25_m', 'distel-divider', 'MW25_M', 105, 120, NULL),
  ('distel-divider-mw24_l', 'distel-divider', 'MW24_L', 105, 120, NULL),
  ('distel-divider-mw24_m', 'distel-divider', 'MW24_M', 105, 120, NULL),
  ('distel-divider-mw24_s', 'distel-divider', 'MW24_S', 105, 120, NULL),
  ('distel-pricetag-posi_xl', 'distel-pricetag', 'POSI_XL', 28, 60, NULL),
  ('distel-pricetag-posi_l', 'distel-pricetag', 'POSI_L', 28, 60, NULL),
  ('distel-pricetag-posi_m', 'distel-pricetag', 'POSI_M', 28, 60, NULL),
  ('distel-pricetag-posi_c', 'distel-pricetag', 'POSI_C', 28, 60, NULL),
  ('distel-pricetag-dg_l', 'distel-pricetag', 'DG_L', 28, 60, NULL),
  ('distel-pricetag-dg_m', 'distel-pricetag', 'DG_M', 28, 60, NULL),
  ('distel-pricetag-dg_c', 'distel-pricetag', 'DG_C', 28, 60, NULL),
  ('distel-pricetag-mw25_l', 'distel-pricetag', 'MW25_L', 28, 60, NULL),
  ('distel-pricetag-mw25_m', 'distel-pricetag', 'MW25_M', 28, 60, NULL),
  ('distel-pricetag-mw24_l', 'distel-pricetag', 'MW24_L', 28, 60, NULL),
  ('distel-pricetag-mw24_m', 'distel-pricetag', 'MW24_M', 28, 60, NULL),
  ('distel-pricetag-mw24_s', 'distel-pricetag', 'MW24_S', 28, 60, NULL);

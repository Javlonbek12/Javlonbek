-- POSM print sizes from the «BOM Matrix» of the ESSE Change 1mg launch template (POSM_ESSE_Change_1):
-- each element's print size and pieces per unit on each equipment type. Display Group and
-- Metawerk of one size share the POSM (code L = DG L + MW-25 L + MW-24 L, M likewise); POSI has
-- its own sizes. Shelftalkers go by shelf (№3-4 = two shelves). Confirmed sizes.

-- Elements (an existing one keeps its id and position).
INSERT INTO "DistElement" ("id", "name", "position", "material")
VALUES
  ('distel-esse-header', 'Header', 10, 'Backprint UV'),
  ('distel-esse-combo-box', 'Combo Box', 11, 'Backprint UV'),
  ('distel-esse-display-box', 'Display Box', 12, 'Backprint UV'),
  ('distel-esse-shelftalker-n1', 'Shelftalker №1', 13, 'Backprint UV'),
  ('distel-esse-shelftalker-n2', 'Shelftalker №2', 14, 'Backprint UV'),
  ('distel-esse-shelftalker-n3', 'Shelftalker №3', 15, 'Backprint UV'),
  ('distel-esse-shelftalker-n4', 'Shelftalker №4', 16, 'Backprint UV'),
  ('distel-esse-divider', 'Divider', 17, 'PET plastic')
ON CONFLICT ("name") DO UPDATE SET "material" = COALESCE("DistElement"."material", EXCLUDED."material");

-- Sizes by element and type (replacing what was there for these pairs).
INSERT INTO "DistElementSize" ("id", "elementId", "type", "heightMm", "widthMm", "perUnit", "material", "verified")
SELECT v."id", e."id", v."type", v."h", v."w", v."pu", v."material", true
FROM (VALUES
  ('distsz-header-dg_l', 'Header', 'DG_L', 230, 600, 1, 'Backprint UV'),
  ('distsz-header-mw25_l', 'Header', 'MW25_L', 230, 600, 1, 'Backprint UV'),
  ('distsz-header-mw24_l', 'Header', 'MW24_L', 230, 600, 1, 'Backprint UV'),
  ('distsz-header-dg_m', 'Header', 'DG_M', 230, 360, 1, 'Backprint UV'),
  ('distsz-header-mw25_m', 'Header', 'MW25_M', 230, 360, 1, 'Backprint UV'),
  ('distsz-header-mw24_m', 'Header', 'MW24_M', 230, 360, 1, 'Backprint UV'),
  ('distsz-header-dg_c', 'Header', 'DG_C', 128, 619, 1, 'Backprint UV'),
  ('distsz-header-mw24_s', 'Header', 'MW24_S', 338, 128, 1, 'Backprint UV'),
  ('distsz-header-posi_xl', 'Header', 'POSI_XL', 294, 706, 1, 'Backprint UV'),
  ('distsz-header-posi_l', 'Header', 'POSI_L', 294, 578, 1, 'Backprint UV'),
  ('distsz-header-posi_m', 'Header', 'POSI_M', 294, 326, 1, 'Backprint UV'),
  ('distsz-header-posi_c', 'Header', 'POSI_C', 105, 588, 1, 'Backprint UV'),
  ('distsz-combo-box-dg_l', 'Combo Box', 'DG_L', 230, 288, 1, 'Backprint UV'),
  ('distsz-combo-box-mw25_l', 'Combo Box', 'MW25_L', 230, 288, 1, 'Backprint UV'),
  ('distsz-combo-box-mw24_l', 'Combo Box', 'MW24_L', 230, 288, 1, 'Backprint UV'),
  ('distsz-display-box-dg_m', 'Display Box', 'DG_M', 109, 360, 1, 'Backprint UV'),
  ('distsz-display-box-mw25_m', 'Display Box', 'MW25_M', 109, 360, 1, 'Backprint UV'),
  ('distsz-display-box-mw24_m', 'Display Box', 'MW24_M', 109, 360, 1, 'Backprint UV'),
  ('distsz-display-box-posi_xl', 'Display Box', 'POSI_XL', 105, 714, 1, 'Backprint UV'),
  ('distsz-display-box-posi_l', 'Display Box', 'POSI_L', 104, 588, 1, 'Backprint UV'),
  ('distsz-display-box-posi_m', 'Display Box', 'POSI_M', 105, 334, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-dg_l', 'Shelftalker №1', 'DG_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-mw25_l', 'Shelftalker №1', 'MW25_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-mw24_l', 'Shelftalker №1', 'MW24_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-dg_l', 'Shelftalker №2', 'DG_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-mw25_l', 'Shelftalker №2', 'MW25_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-mw24_l', 'Shelftalker №2', 'MW24_L', 38, 625, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-dg_l', 'Shelftalker №3', 'DG_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-mw25_l', 'Shelftalker №3', 'MW25_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-mw24_l', 'Shelftalker №3', 'MW24_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-dg_l', 'Shelftalker №4', 'DG_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-mw25_l', 'Shelftalker №4', 'MW25_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-mw24_l', 'Shelftalker №4', 'MW24_L', 38, 310, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-dg_m', 'Shelftalker №1', 'DG_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-mw25_m', 'Shelftalker №1', 'MW25_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-mw24_m', 'Shelftalker №1', 'MW24_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-dg_m', 'Shelftalker №2', 'DG_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-mw25_m', 'Shelftalker №2', 'MW25_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-mw24_m', 'Shelftalker №2', 'MW24_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-dg_m', 'Shelftalker №3', 'DG_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-mw25_m', 'Shelftalker №3', 'MW25_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-mw24_m', 'Shelftalker №3', 'MW24_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-dg_m', 'Shelftalker №4', 'DG_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-mw25_m', 'Shelftalker №4', 'MW25_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-mw24_m', 'Shelftalker №4', 'MW24_M', 38, 382, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-dg_c', 'Shelftalker №1', 'DG_C', 30, 618, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-dg_c', 'Shelftalker №2', 'DG_C', 30, 618, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-posi_xl', 'Shelftalker №1', 'POSI_XL', 28, 760, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-posi_xl', 'Shelftalker №2', 'POSI_XL', 28, 760, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-posi_xl', 'Shelftalker №3', 'POSI_XL', 28, 760, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-posi_xl', 'Shelftalker №4', 'POSI_XL', 28, 760, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-posi_l', 'Shelftalker №1', 'POSI_L', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-posi_l', 'Shelftalker №2', 'POSI_L', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-posi_l', 'Shelftalker №3', 'POSI_L', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-posi_l', 'Shelftalker №4', 'POSI_L', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-posi_m', 'Shelftalker №1', 'POSI_M', 28, 385, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-posi_m', 'Shelftalker №2', 'POSI_M', 28, 385, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-posi_m', 'Shelftalker №3', 'POSI_M', 28, 385, 1, 'Backprint UV'),
  ('distsz-shelftalker-n4-posi_m', 'Shelftalker №4', 'POSI_M', 28, 385, 1, 'Backprint UV'),
  ('distsz-shelftalker-n1-posi_c', 'Shelftalker №1', 'POSI_C', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n2-posi_c', 'Shelftalker №2', 'POSI_C', 28, 640, 1, 'Backprint UV'),
  ('distsz-shelftalker-n3-posi_c', 'Shelftalker №3', 'POSI_C', 28, 640, 1, 'Backprint UV'),
  ('distsz-divider-dg_l', 'Divider', 'DG_L', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-mw25_l', 'Divider', 'MW25_L', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-mw24_l', 'Divider', 'MW24_L', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-posi_xl', 'Divider', 'POSI_XL', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-posi_l', 'Divider', 'POSI_L', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-dg_c', 'Divider', 'DG_C', 105, 120, 2, 'PET plastic'),
  ('distsz-divider-posi_c', 'Divider', 'POSI_C', 105, 120, 2, 'PET plastic')
) AS v ("id", "element", "type", "h", "w", "pu", "material")
JOIN "DistElement" e ON e."name" = v."element"
ON CONFLICT ("elementId", "type") DO UPDATE SET
  "heightMm" = EXCLUDED."heightMm",
  "widthMm" = EXCLUDED."widthMm",
  "perUnit" = EXCLUDED."perUnit",
  "material" = EXCLUDED."material",
  "verified" = true;

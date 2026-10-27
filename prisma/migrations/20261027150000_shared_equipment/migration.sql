-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "distTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- The link the code had (planogram model by code) becomes data, editable on the model.
UPDATE "Equipment" SET "distTypes" = ARRAY['POSI_XL'] WHERE "code" = 'DISPLAY_XL_POSI';
UPDATE "Equipment" SET "distTypes" = ARRAY['POSI_L'] WHERE "code" = 'DISPLAY_L_POSI';
UPDATE "Equipment" SET "distTypes" = ARRAY['POSI_M'] WHERE "code" = 'DISPLAY_M_POSI';
UPDATE "Equipment" SET "distTypes" = ARRAY['POSI_C'] WHERE "code" = 'DISPLAY_C_POSI';
UPDATE "Equipment" SET "distTypes" = ARRAY['DG_L', 'MW25_L', 'MW24_L'] WHERE "code" = 'DISPLAY_L_MWDG';
UPDATE "Equipment" SET "distTypes" = ARRAY['DG_M', 'MW25_M', 'MW24_M'] WHERE "code" = 'DISPLAY_M_MWDG';
UPDATE "Equipment" SET "distTypes" = ARRAY['DG_C'] WHERE "code" = 'DISPLAY_C_DG';
UPDATE "Equipment" SET "distTypes" = ARRAY['MW24_S'] WHERE "code" = 'DISPLAY_S_MW';

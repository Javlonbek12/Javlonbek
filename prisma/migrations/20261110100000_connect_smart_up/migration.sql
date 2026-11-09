-- AlterEnum
ALTER TYPE "ConnectKind" ADD VALUE 'SU_VISIT';
ALTER TYPE "ConnectKind" ADD VALUE 'SU_PERSON';

-- CreateIndex
CREATE INDEX "ConnectRecord_kind_day_idx" ON "ConnectRecord"("kind", "day");

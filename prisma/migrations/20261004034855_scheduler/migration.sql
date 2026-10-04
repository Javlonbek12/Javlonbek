-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliverAfterQuiet" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "digestTime" INTEGER NOT NULL DEFAULT 510;

-- CreateTable
CREATE TABLE "ScheduledSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledSend_userId_kind_key_key" ON "ScheduledSend"("userId", "kind", "key");

-- AddForeignKey
ALTER TABLE "ScheduledSend" ADD CONSTRAINT "ScheduledSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

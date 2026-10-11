-- CreateEnum
CREATE TYPE "ContentChannel" AS ENUM ('PARTNER', 'CONNECT', 'RESEARCH');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('PLANNED', 'DRAFT', 'REVIEW', 'CHANGES', 'APPROVED', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "ContentPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT,
    "channels" "ContentChannel"[],
    "publishDate" DATE NOT NULL,
    "publishTime" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PLANNED',
    "authorId" TEXT,
    "createdById" TEXT NOT NULL,
    "textRu" TEXT,
    "textUz" TEXT,
    "imagePath" TEXT,
    "imageName" TEXT,
    "sentChannels" "ContentChannel"[],
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isFeedback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPost_publishDate_idx" ON "ContentPost"("publishDate");

-- CreateIndex
CREATE INDEX "ContentPost_authorId_status_idx" ON "ContentPost"("authorId", "status");

-- CreateIndex
CREATE INDEX "ContentComment_postId_idx" ON "ContentComment"("postId");

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentComment" ADD CONSTRAINT "ContentComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentComment" ADD CONSTRAINT "ContentComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

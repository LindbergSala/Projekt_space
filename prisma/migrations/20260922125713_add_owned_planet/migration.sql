-- CreateTable
CREATE TABLE "planet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "planet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planet_ownerId_idx" ON "planet"("ownerId");

-- AddForeignKey
ALTER TABLE "planet" ADD CONSTRAINT "planet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

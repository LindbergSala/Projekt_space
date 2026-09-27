-- CreateTable
CREATE TABLE "planet_material_transaction" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_material_transaction_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraints
ALTER TABLE "planet_material_transaction"
    ADD CONSTRAINT "planet_material_transaction_delta_nonzero" CHECK ("delta" <> 0),
    ADD CONSTRAINT "planet_material_transaction_balance_nonnegative" CHECK ("balanceAfter" >= 0);

-- CreateIndex
CREATE INDEX "planet_material_history_idx" ON "planet_material_transaction"("planetId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "planet_material_transaction" ADD CONSTRAINT "planet_material_transaction_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

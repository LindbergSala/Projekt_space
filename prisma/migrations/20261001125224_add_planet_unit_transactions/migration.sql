-- CreateTable
CREATE TABLE "planet_unit_transaction" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "unitKey" VARCHAR(32) NOT NULL,
    "delta" BIGINT NOT NULL,
    "quantityAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_unit_transaction_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
ALTER TABLE "planet_unit_transaction" ADD CONSTRAINT "planet_unit_transaction_delta_nonzero" CHECK ("delta" <> 0);

-- AddCheckConstraint
ALTER TABLE "planet_unit_transaction" ADD CONSTRAINT "planet_unit_transaction_quantity_nonnegative" CHECK ("quantityAfter" >= 0);

-- AddCheckConstraint
ALTER TABLE "planet_unit_transaction" ADD CONSTRAINT "planet_unit_transaction_unitKey_valid" CHECK (
    "unitKey" IN (
        'line-infantry',
        'assault-infantry',
        'heavy-weapons-infantry',
        'light-tank',
        'heavy-tank',
        'field-artillery',
        'combat-engineer',
        'vanguard-exosuit',
        'siege-strider',
        'razor-beast',
        'spore-caster',
        'aegis-construct',
        'phase-reaper',
        'scrap-brute',
        'rift-raider'
    )
);

-- CreateIndex
CREATE INDEX "planet_unit_history_idx" ON "planet_unit_transaction"("planetId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "planet_unit_transaction" ADD CONSTRAINT "planet_unit_transaction_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

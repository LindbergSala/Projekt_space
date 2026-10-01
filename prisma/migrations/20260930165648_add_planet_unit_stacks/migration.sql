-- CreateTable
CREATE TABLE "planet_unit_stack" (
    "planetId" TEXT NOT NULL,
    "unitKey" VARCHAR(32) NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "planet_unit_stack_pkey" PRIMARY KEY ("planetId", "unitKey")
);

-- AddCheckConstraint
ALTER TABLE "planet_unit_stack" ADD CONSTRAINT "planet_unit_stack_quantity_nonnegative" CHECK ("quantity" >= 0);

-- AddCheckConstraint
ALTER TABLE "planet_unit_stack" ADD CONSTRAINT "planet_unit_stack_unitKey_valid" CHECK (
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

-- AddForeignKey
ALTER TABLE "planet_unit_stack" ADD CONSTRAINT "planet_unit_stack_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

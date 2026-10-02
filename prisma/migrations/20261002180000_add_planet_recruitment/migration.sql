-- Recruitment is additive: no existing gameplay values or histories change.
CREATE TABLE "planet_recruitment" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "unitKey" VARCHAR(32) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "materialsCost" BIGINT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3),
    CONSTRAINT "planet_recruitment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planet_recruitment_unit_valid" CHECK ("unitKey" = 'line-infantry'),
    CONSTRAINT "planet_recruitment_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "planet_recruitment_cost_positive" CHECK ("materialsCost" > 0),
    CONSTRAINT "planet_recruitment_time_valid" CHECK ("completesAt" > "startedAt"),
    CONSTRAINT "planet_recruitment_collection_valid" CHECK (
      "collectedAt" IS NULL OR "collectedAt" >= "completesAt"
    )
);

-- Ready orders retain the slot until explicitly collected. No clock-dependent predicate.
CREATE UNIQUE INDEX "planet_recruitment_uncollected_key"
ON "planet_recruitment"("planetId") WHERE "collectedAt" IS NULL;
CREATE INDEX "planet_recruitment_history_idx"
ON "planet_recruitment"("planetId", "startedAt", "id");
ALTER TABLE "planet_recruitment" ADD CONSTRAINT "planet_recruitment_planetId_fkey"
FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

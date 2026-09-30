-- AlterTable
ALTER TABLE "user" ADD COLUMN     "factionKey" VARCHAR(32);

-- AddCheckConstraint
ALTER TABLE "user" ADD CONSTRAINT "user_factionKey_valid" CHECK (
    "factionKey" IS NULL OR
    "factionKey" IN (
        'orthevan-directorate',
        'zhyreth-brood',
        'nhalorin-continuum',
        'draskyr-clans'
    )
);

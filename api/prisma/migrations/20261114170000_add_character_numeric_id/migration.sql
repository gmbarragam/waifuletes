-- AlterTable
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "numeric_id" SERIAL;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "rarity_rank" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "characters_numeric_id_key" ON "characters"("numeric_id");
CREATE INDEX IF NOT EXISTS "characters_baseRarity_rarity_rank_idx" ON "characters"("baseRarity", "rarity_rank");

-- Popula rarity_rank inicial para todos os personagens existentes
UPDATE characters c
SET "rarity_rank" = ranked.r
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "baseRarity"
    ORDER BY rank ASC NULLS LAST, "popularityScore" DESC, "claimCount" DESC, id ASC
  ) as r
  FROM characters
) ranked
WHERE c.id = ranked.id AND c."rarity_rank" IS NULL;

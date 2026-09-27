-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on Place.name for fast trigram search
CREATE INDEX IF NOT EXISTS place_name_trgm ON "Place" USING GIN (name gin_trgm_ops);

-- GIN index on Place.city for fast trigram search
CREATE INDEX IF NOT EXISTS place_city_trgm ON "Place" USING GIN (city gin_trgm_ops);

-- Tiki-Taka leaderboard schema
-- Run this in the Supabase SQL editor (https://app.supabase.com → your project → SQL Editor)

CREATE TABLE individual_scores (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_timestamp     timestamptz NOT NULL DEFAULT now(),
  username             text        NOT NULL,
  team                 text        NOT NULL,
  challenge_date       date        NOT NULL,
  puzzle1_time_secs    int         NOT NULL CHECK (puzzle1_time_secs    >= 0 AND puzzle1_time_secs    <= 36000),
  puzzle2_time_secs    int         NOT NULL CHECK (puzzle2_time_secs    >= 0 AND puzzle2_time_secs    <= 36000),
  puzzle3_time_secs    int         NOT NULL CHECK (puzzle3_time_secs    >= 0 AND puzzle3_time_secs    <= 36000),
  total_match_time_secs int        NOT NULL CHECK (total_match_time_secs >= 0 AND total_match_time_secs <= 108000),
  UNIQUE (username, challenge_date)
);

CREATE TABLE players (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  username         text        NOT NULL,
  team             text        NOT NULL,
  jersey_number    int         NOT NULL,
  last_seen        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, team)
);

CREATE TABLE daily_challenges (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_date  date NOT NULL UNIQUE,
  grid_size     int NOT NULL DEFAULT 5 CHECK (grid_size IN (5, 6)),
  player_count  int NOT NULL DEFAULT 4 CHECK (player_count IN (4, 5, 6)),
  numbers       int[] NOT NULL,
  defenders     int[] NOT NULL,
  CHECK (cardinality(numbers) = player_count * 3),
  CHECK (array_position(numbers, NULL) IS NULL AND array_position(defenders, NULL) IS NULL)
);

-- Enable Row Level Security
ALTER TABLE individual_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON daily_challenges TO anon, authenticated;

-- Anyone can read and insert scores (public leaderboard)
CREATE POLICY "public_select_scores"  ON individual_scores FOR SELECT USING (true);
CREATE POLICY "public_insert_scores"  ON individual_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "public_select_players" ON players           FOR SELECT USING (true);
CREATE POLICY "public_insert_players" ON players           FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_players" ON players           FOR UPDATE USING (true);
CREATE POLICY "public_read_daily_challenges" ON daily_challenges FOR SELECT TO anon, authenticated USING (true);

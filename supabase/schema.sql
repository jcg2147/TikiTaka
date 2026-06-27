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

-- Enable Row Level Security
ALTER TABLE individual_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE players           ENABLE ROW LEVEL SECURITY;

-- Anyone can read and insert scores (public leaderboard)
CREATE POLICY "public_select_scores"  ON individual_scores FOR SELECT USING (true);
CREATE POLICY "public_insert_scores"  ON individual_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "public_select_players" ON players           FOR SELECT USING (true);
CREATE POLICY "public_insert_players" ON players           FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_players" ON players           FOR UPDATE USING (true);

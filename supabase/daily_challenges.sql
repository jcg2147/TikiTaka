-- Tiki-Taka daily puzzle schedule
-- One row stores the three daily puzzles for a release_date.
-- numbers is flattened as 3 consecutive target arrays:
--   [p1 targets..., p2 targets..., p3 targets...]
-- defenders is flattened with -1 separators between puzzles:
--   [p1 defenders..., -1, p2 defenders..., -1, p3 defenders...]

create table if not exists public.daily_challenges (
  id bigint generated always as identity primary key,
  release_date date not null unique,
  grid_size int not null default 5 check (grid_size in (5, 6)),
  player_count int not null default 4 check (player_count in (4, 5, 6)),
  numbers int[] not null,
  defenders int[] not null,
  check (cardinality(numbers) = player_count * 3),
  check (
    array_position(numbers, null) is null
    and array_position(defenders, null) is null
  )
);

alter table public.daily_challenges enable row level security;

grant select on public.daily_challenges to anon, authenticated;

drop policy if exists "public_read_daily_challenges" on public.daily_challenges;
create policy "public_read_daily_challenges"
  on public.daily_challenges
  for select
  to anon, authenticated
  using (true);

#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const releaseDate = args.date || new Date().toISOString().slice(0, 10);
const gridSize = Number(args['grid-size'] || args.grid_size || 5);
const playerCount = Number(args['player-count'] || args.player_count || 4);
const puzzleCount = 3;

if (![5, 6].includes(gridSize)) throw new Error('grid_size must be 5 or 6');
if (![4, 5, 6].includes(playerCount)) throw new Error('player_count must be 4, 5, or 6');
if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error('date must be YYYY-MM-DD');

const puzzles = Array.from({ length: puzzleCount }, () => generatePuzzle(gridSize, playerCount));
const row = encodeDailyChallenge({ releaseDate, gridSize, playerCount, puzzles });

if (args.insert) {
  await insertSupabase(row);
} else if (args.sql) {
  console.log(toUpsertSql(row));
} else {
  console.log(JSON.stringify({ ...row, puzzles }, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function encodeDailyChallenge({ releaseDate, gridSize, playerCount, puzzles }) {
  return {
    release_date: releaseDate,
    grid_size: gridSize,
    player_count: playerCount,
    numbers: puzzles.flatMap(puzzle => puzzle.numbers),
    defenders: puzzles.flatMap((puzzle, index) => index < puzzles.length - 1
      ? [...puzzle.defenders, -1]
      : [...puzzle.defenders])
  };
}

function generatePuzzle(size, count) {
  const total = size * size;
  const defenderCount = size === 5 ? randomInt(3, 5) : randomInt(5, 8);
  for (let attempt = 0; attempt < 400; attempt++) {
    const defenders = shuffle([...Array(total).keys()]).slice(0, defenderCount).sort((a, b) => a - b);
    const path = hamiltonianPath(size, defenders);
    if (!path) continue;
    const numbers = targetStops(path, count);
    if (numbers.some(cell => defenders.includes(cell))) continue;
    return { numbers, defenders, solution: path };
  }
  throw new Error(`Unable to generate puzzle for ${size}x${size} with ${count} targets`);
}

function hamiltonianPath(size, defenders) {
  const total = size * size;
  const blocked = new Set(defenders);
  const free = [...Array(total).keys()].filter(cell => !blocked.has(cell));
  if (!free.length) return null;
  if (!isReachable(size, free, blocked)) return null;

  const start = free[Math.floor(Math.random() * free.length)];
  const visited = new Set([start]);
  const path = [start];

  function dfs(cell) {
    if (path.length === free.length) return true;
    const nextCells = neighbors(size, cell)
      .filter(next => !blocked.has(next) && !visited.has(next))
      .sort((a, b) => onwardCount(size, a, blocked, visited) - onwardCount(size, b, blocked, visited));

    for (const next of shuffle(nextCells)) {
      visited.add(next);
      path.push(next);
      if (dfs(next)) return true;
      path.pop();
      visited.delete(next);
    }
    return false;
  }

  return dfs(start) ? path : null;
}

function targetStops(path, count) {
  const last = path.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((last * index) / (count - 1));
    return path[position];
  });
}

function neighbors(size, cell) {
  const row = Math.floor(cell / size);
  const col = cell % size;
  const out = [];
  if (row > 0) out.push((row - 1) * size + col);
  if (row < size - 1) out.push((row + 1) * size + col);
  if (col > 0) out.push(row * size + col - 1);
  if (col < size - 1) out.push(row * size + col + 1);
  return out;
}

function onwardCount(size, cell, blocked, visited) {
  return neighbors(size, cell).filter(next => !blocked.has(next) && !visited.has(next)).length;
}

function isReachable(size, free, blocked) {
  const freeSet = new Set(free);
  const seen = new Set([free[0]]);
  const queue = [free[0]];
  while (queue.length) {
    const cell = queue.shift();
    for (const next of neighbors(size, cell)) {
      if (blocked.has(next) || seen.has(next) || !freeSet.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === free.length;
}

function randomInt(min, maxInclusive) {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function toPgArray(values) {
  return `array[${values.join(',')}]::int[]`;
}

function toUpsertSql(payload) {
  return `insert into public.daily_challenges (release_date, grid_size, player_count, numbers, defenders)
values ('${payload.release_date}', ${payload.grid_size}, ${payload.player_count}, ${toPgArray(payload.numbers)}, ${toPgArray(payload.defenders)})
on conflict (release_date) do update set
  grid_size = excluded.grid_size,
  player_count = excluded.player_count,
  numbers = excluded.numbers,
  defenders = excluded.defenders;`;
}

async function insertSupabase(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/daily_challenges?on_conflict=release_date`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

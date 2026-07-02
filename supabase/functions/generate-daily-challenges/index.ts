import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Puzzle = {
  numbers: number[];
  defenders: number[];
  solution: number[];
};

type DailyChallengeRow = {
  release_date: string;
  grid_size: number;
  player_count: number;
  numbers: number[];
  defenders: number[];
};

const PUZZLES_PER_DAY = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCHEDULE_TIME_ZONE = "America/New_York";

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token !== cronSecret) return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!);
    const adminSecretToken = secretKeys["default"];
    if (!supabaseUrl || !adminSecretToken) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEYS.default");
    }

    const supabase = createClient(supabaseUrl, adminSecretToken, {
      auth: { persistSession: false },
    });

    const week = upcomingMondayToSunday(new Date());
    const rows = week.map((date) => {
      const { gridSize, playerCount } = scheduleForDate(date);
      const puzzles = Array.from(
        { length: PUZZLES_PER_DAY },
        () => generatePuzzle(gridSize, playerCount),
      );
      return encodeDailyChallenge({
        releaseDate: formatDate(date),
        gridSize,
        playerCount,
        puzzles,
      });
    });

    const { data, error } = await supabase
      .from("daily_challenges")
      .upsert(rows, { onConflict: "release_date" })
      .select("id,release_date,grid_size,player_count");

    if (error) throw error;

    return json({
      ok: true,
      generated: rows.length,
      weekStart: rows[0]?.release_date,
      weekEnd: rows[rows.length - 1]?.release_date,
      rows: data,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function upcomingMondayToSunday(now: Date): Date[] {
  const parts = zonedDateParts(now, SCHEDULE_TIME_ZONE);
  const local = new Date(parts.year, parts.month - 1, parts.day);
  const day = local.getDay();
  const daysUntilMonday = (8 - day) % 7;
  const monday = new Date(local.getTime() + daysUntilMonday * MS_PER_DAY);
  return Array.from({ length: 7 }, (_, index) => new Date(monday.getTime() + index * MS_PER_DAY));
}

function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}

function scheduleForDate(date: Date): { gridSize: number; playerCount: number } {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend
    ? { gridSize: 6, playerCount: 5 }
    : { gridSize: 5, playerCount: 4 };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function encodeDailyChallenge(
  { releaseDate, gridSize, playerCount, puzzles }: {
    releaseDate: string;
    gridSize: number;
    playerCount: number;
    puzzles: Puzzle[];
  },
): DailyChallengeRow {
  return {
    release_date: releaseDate,
    grid_size: gridSize,
    player_count: playerCount,
    numbers: puzzles.flatMap((puzzle) => puzzle.numbers),
    defenders: puzzles.flatMap((puzzle, index) =>
      index < puzzles.length - 1 ? [...puzzle.defenders, -1] : [...puzzle.defenders]
    ),
  };
}

function generatePuzzle(size: number, count: number): Puzzle {
  const total = size * size;
  const defenderCount = size === 5 ? randomInt(3, 5) : randomInt(5, 8);

  for (let attempt = 0; attempt < 400; attempt++) {
    const defenders = shuffle([...Array(total).keys()])
      .slice(0, defenderCount)
      .sort((a, b) => a - b);
    const path = hamiltonianPath(size, defenders);
    if (!path) continue;

    const numbers = targetStops(path, count);
    if (numbers.some((cell) => defenders.includes(cell))) continue;
    return { numbers, defenders, solution: path };
  }

  throw new Error(`Unable to generate puzzle for ${size}x${size} with ${count} targets`);
}

function hamiltonianPath(size: number, defenders: number[]): number[] | null {
  const total = size * size;
  const blocked = new Set(defenders);
  const free = [...Array(total).keys()].filter((cell) => !blocked.has(cell));
  if (!free.length) return null;
  if (!isReachable(size, free, blocked)) return null;

  const start = free[Math.floor(Math.random() * free.length)];
  const visited = new Set([start]);
  const path = [start];

  function dfs(cell: number): boolean {
    if (path.length === free.length) return true;

    const nextCells = neighbors(size, cell)
      .filter((next) => !blocked.has(next) && !visited.has(next))
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

function targetStops(path: number[], count: number): number[] {
  const last = path.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((last * index) / (count - 1));
    return path[position];
  });
}

function neighbors(size: number, cell: number): number[] {
  const row = Math.floor(cell / size);
  const col = cell % size;
  const out = [];
  if (row > 0) out.push((row - 1) * size + col);
  if (row < size - 1) out.push((row + 1) * size + col);
  if (col > 0) out.push(row * size + col - 1);
  if (col < size - 1) out.push(row * size + col + 1);
  return out;
}

function onwardCount(
  size: number,
  cell: number,
  blocked: Set<number>,
  visited: Set<number>,
): number {
  return neighbors(size, cell).filter((next) => !blocked.has(next) && !visited.has(next)).length;
}

function isReachable(size: number, free: number[], blocked: Set<number>): boolean {
  const freeSet = new Set(free);
  const seen = new Set([free[0]]);
  const queue = [free[0]];

  while (queue.length) {
    const cell = queue.shift() as number;
    for (const next of neighbors(size, cell)) {
      if (blocked.has(next) || seen.has(next) || !freeSet.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen.size === free.length;
}

function randomInt(min: number, maxInclusive: number): number {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

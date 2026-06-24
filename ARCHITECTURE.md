# Architecture

## Technology Stack

- HTML: static markup and game structure.
- CSS: layout, intro dashboard, field styling, goal, ball, and animations.
- JavaScript: scheduled puzzle data, validation, gameplay state, timer, input handling, and win sequence.
- Canvas 2D: yellow path rendering over the grid.
- Browser `localStorage`: same-browser player profile, match progress, and per-puzzle time persistence.
- GitLab Pages: optional static hosting through `.gitlab-ci.yml`.
- FlagCDN: static flag image URLs for the World Cup team picker.
- Google Apps Script and Google Sheets: shared leaderboard persistence.

No package manager, bundler, framework, or backend is required.

## Architecture Overview

The game is implemented as a single static widget in `tiki_taka_v6_trionda.html`.

Major pieces:

- Intro dashboard: collects `username` and favorite team, uses Login to replace the form with a saved jersey profile card, and keeps match/tutorial controls in a compact action panel.
- Team picker: renders 48 flag image buttons while storing the selected country name internally.
- Profile persistence: stores the selected profile in `localStorage` for same-browser convenience.
- Puzzle model: stores numbered targets, defenders, current path, timer, and solved state.
- Match schedule: stores three validated puzzles per date from June 24, 2026 through July 15, 2026.
- Input system: supports mouse and touch dragging across grid cells.
- Rendering: grid cells are DOM elements; the path line is drawn on a canvas overlay.
- Tutorial mode: loads a fixed sample puzzle, animates a 7-second solution preview, resets that same board for player practice, and skips score submission.
- Win sequence: clears the path, animates a sprite ball into the goal, shakes the goal, spawns confetti, and shows the GOAL overlay.
- Leaderboard: `registerPlayer(entry)` requests a country-specific jersey number, `fetchProgress(entry)` syncs completed match status when the local cache is stale, `submitScore(entry)` writes one completed match row to Google Apps Script, `fetchScores(challengeDate)` loads total-match player leaders, and the country leaderboard loads fastest-goal and average-match country leaders.

## Major Design Decisions

- Static-first implementation: keeps the project easy to review, clone, run, and publish.
- Single-file game logic: reduces setup overhead for the challenge and keeps the game portable.
- Solver-backed puzzle schedule: avoids shipping unsolvable daily boards.
- Canvas for path rendering: keeps path visuals independent from cell DOM state.
- Local sprite asset: avoids remote-image dependency and keeps GitLab Pages deployment self-contained.
- GitLab Pages pipeline: makes one-click hosted play possible once the repo is pushed.
- JSONP leaderboard transport: avoids CORS complexity for a static GitLab Pages frontend talking to Apps Script.
- Local profile persistence: gives the demo a returning-player feel without adding authentication.
- No username uniqueness enforcement: keeps the project lightweight and avoids pretending that demo usernames are secure identities.
- Apps Script score guards: rejects duplicate completed-match submissions for the same username/date.

## AI Tooling Used

- Codex in the desktop app for implementation, iteration, documentation, and validation.
- Browser/image context supplied by the user for the Trionda-style ball asset.
- Web lookup for current World Cup team/group data used by the team picker.

## Agent Workflow

1. Capture requirements and evolve the game iteratively.
2. Inspect the existing file before each change.
3. Make scoped edits with patch-based updates.
4. Validate JavaScript syntax after changes.
5. Keep the implementation static and deployable.
6. Add challenge-required documentation and GitLab Pages configuration.

## Deployment Model

The `.gitlab-ci.yml` file publishes static files by copying them into `public/`:

- `index.html`
- `tiki_taka_v6_trionda.html`
- `assets/`

When pushed to the default branch of a GitLab project with Pages enabled, the pipeline should publish the playable game as a static site.

## Leaderboard Backend

`google-apps-script/Code.gs` is designed to be pasted into a Google Sheet-bound Apps Script project. It supports:

- `action=submit`: append one completed-match score row.
- `action=registerPlayer`: assign or return a country-specific jersey number for the `username` + `team` pair.
- `action=progress`: return completed match status and puzzle times for a username and challenge date.
- `action=list`: return the fastest total match scores.
- `action=countries`: return country aggregate standings sorted by fastest single-puzzle goal or average total match time.
- `action=ping`: basic health check.

The browser uses a generated JSONP callback name and a `<script>` tag request, which works from static hosting without requiring CORS headers.

The script targets the configured spreadsheet ID and maintains three tabs:

- `Individual Scores`: append-only completed match log with `serverTimestamp`, `playerName`, `country`, `date`, `puzzle1Time`, `puzzle2Time`, `puzzle3Time`, and `totalMatchTime`.
- `Country Scores`: aggregate rows by selected country with `country`, `plays`, formatted `fastestGoal`, formatted `averageMatchTime`, and `lastPlayed`.
- `Players`: player registry with `serverTimestamp`, `username`, `team`, `jerseyNumber`, and `lastSeen`.

Jersey number assignments are stored in the `Players` tab by normalized `username` + `team`. This keeps score history separate from player identity while still allowing the UI to show stable numbers like `01`, `02`, and `03` in join order for each country.

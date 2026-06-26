# Specification

## Game Rules

Tiki-Taka is a soccer path puzzle played on a 5x5 grid.

The player must:

- Start on the cell marked `1`.
- Drag a continuous orthogonal path through adjacent cells.
- Avoid defender cells.
- Cover every non-defender cell exactly once.
- Include numbered targets `1`, `2`, `3`, and `4` in ascending path order.
- Finish the path on `4`.

The player may retrace to a previously visited cell to trim the path back to that point.

## Scope

In scope:

- Single-player browser game.
- Static HTML/CSS/JavaScript implementation.
- Fixed daily match schedule with three puzzles per day from June 24, 2026 through July 15, 2026.
- Solver-backed validation for generated and scheduled puzzles.
- Intro dashboard with username, favorite World Cup team, login, match controls, and leaderboards.
- Same-browser profile persistence for returning players.
- Country-inspired jersey profile card with an assigned team number.
- Tutorial mode that previews a sample solution and does not submit scores.
- Timer, reset path, next puzzle, and win animation.
- Shared leaderboard integration through Google Apps Script and Google Sheets.
- GitLab Pages-ready static deployment configuration.

Out of scope for MVP:

- User authentication.
- Username ownership or uniqueness enforcement.
- Multiple difficulty modes.
- Move counter.
- Full responsive redesign beyond the current compact widget layout.

## Functional Requirements

1. The game must render a 5x5 playable grid.
2. The player must enter a username before starting.
3. The player must choose a team to represent from the 48-team World Cup list before starting.
4. Team choices must be shown as flag images rather than visible country names.
5. After profile selection, Login must replace the setup form with a jersey card showing the username, selected team, and two-digit player number without starting a match.
6. The selected profile must persist in the same browser through `localStorage`.
7. Username uniqueness must not be required for this demo build.
8. The intro dashboard must show compact Start Match and Tutorial controls outside the profile card.
9. The intro dashboard must show the top five individual total-match leaders, top five fastest-goal countries, and top five country average-match leaders when the leaderboard is configured.
10. The timer must start only after the player starts a scored match or tutorial.
11. Tutorial mode must show a short rules description in-game.
12. Tutorial mode must play a 7-second sample solution before user control starts.
13. After the tutorial sample, the player must be allowed to play the same tutorial board.
14. Tutorial mode must not submit a score.
15. Dragging must start only from target `1`.
16. Defender cells must block movement.
17. Movement must be orthogonal to adjacent cells.
18. Revisiting a path cell must trim the path.
19. Every scheduled puzzle must keep all free cells reachable.
20. Every scheduled puzzle must have at least one valid solution.
21. The game must detect a win only when all free cells are covered and target order is valid.
22. On win, the ball must animate into a randomized area of the goal.
23. Each username must be limited to one scored three-puzzle match per challenge date.
24. Every player must receive the same three scored puzzles on the same challenge date.
25. The frontend must keep Puzzle 1, Puzzle 2, and Puzzle 3 times locally until the match is complete.
26. The leaderboard hook must submit one completed-match payload with player name, country, date, Puzzle 1 time, Puzzle 2 time, Puzzle 3 time, and total match time.
27. When configured, the app must submit completed matches to Google Apps Script and render shared top times.
28. When configured, Apps Script must assign stable country-specific jersey numbers through the `Players` sheet tab.
29. The game must run as a static browser page without build tools.

## Acceptance Criteria

- Opening `index.html` launches the game.
- The intro dashboard blocks play until username and team are provided.
- The team picker contains 48 flag image choices.
- Pressing Login saves the profile and replaces the profile form with a jersey card.
- Reloading in the same browser restores the selected username, country, and jersey number.
- Choosing "Change profile" returns the player to the profile form.
- Pressing Start Match after login hides the intro dashboard, serves the next unfinished puzzle in The Match, and starts the timer.
- Pressing Tutorial after login hides the intro dashboard, shows a 7-second sample playthrough, then clears the path and starts the timer on that same board.
- The intro dashboard shows top-five individual total-match, fastest-goal country, and average-match country leaderboards.
- Reset path clears the drawn path without changing the current match puzzle.
- Next puzzle serves the next match puzzle only after the current puzzle is solved.
- A valid solution triggers GOAL, confetti, and the ball animation.
- A configured Apps Script endpoint records completed matches in an `Individual Scores` sheet, updates date-scoped `Country Scores`, rejects duplicate match submissions per username/date, and returns leaderboard rows for the requested challenge date.
- The `Players` sheet preserves static jersey numbers for returning `username` + `team` pairs.
- The project contains `README.md`, `SPEC.md`, `ARCHITECTURE.md`, and `RETROSPECTIVE.md`.
- The project can be committed to GitLab and published with the included GitLab Pages pipeline.

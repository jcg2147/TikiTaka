# Tiki-Taka

Tiki-Taka is a single-page browser puzzle game inspired by soccer passing patterns and LinkedIn-style path puzzle games (Zip). The player draws one continuous path across a 5x5 soccer field, connects numbered targets in order, avoids defenders, covers the entire field, and finishes by sending the ball into the goal.

## Game Description

The board is a 5x5 grid with numbered targets `1` through `4` and defender blocks. The player starts at `1`, drags through adjacent cells, covers every non-defender square exactly once, and must finish on `4`. When solved, the path clears and a Trionda-style ball animates into the goal.

The game includes:

- An intro dashboard for username, favorite 2026 World Cup team, match controls, and top-five individual, fastest-goal country, and average-match country leaderboards.
- A flags-only team picker for selecting the country the player represents.
- Same-browser profile persistence with `localStorage`, so returning players can start again without re-entering their username and country.
- A Login flow that previews the player's jersey and country before starting a match.
- A profile card that replaces the setup form after login, showing the username on the back of a country-inspired jersey with an assigned two-digit team number.
- A tutorial mode with a 7-second sample playthrough, followed by the same board for practice without score submission.
- The Match mode with three fixed puzzles per day from June 24, 2026 through July 15, 2026.
- Built-in puzzle schedule with reachability and solution validation.
- Mouse and touch drag controls.
- Reset and next puzzle controls.
- Timer and win animation.
- Shared leaderboard backed by Google Apps Script and Google Sheets.

## Screenshots

The current build is a static HTML game. A screenshot can be added after publishing, but the game is playable directly from the included HTML file.

## Setup

No dependencies are required.

## Run Locally

Open `index.html` or `tiki_taka_v6_trionda.html` in a browser.

## GitLab Pages

This repository includes `.gitlab-ci.yml` for GitLab Pages. On the default branch, CI copies the static files into `public/` and publishes them as a Pages artifact.

Playable link:

[Play Tiki-Taka on GitLab Pages](https://rc-ai-learning.gitlab.io/juan-garcia-tiki-taka/)

## Shared Leaderboard

The game supports a shared Google Sheets leaderboard through a Google Apps Script web app.

Do not store private tokens or credentials in the repository. The Apps Script URL is public by design, so this leaderboard is suitable for challenge/demo use rather than fraud-resistant production scoring.

## Project Files

- `index.html`: landing redirect for hosted environments.
- `tiki_taka_v6_trionda.html`: complete game implementation.
- `assets/trionda-ball-sprite.png`: local ball sprite used by the win animation.
- World Cup team flags are loaded as static images from FlagCDN at runtime.
- `google-apps-script/Code.gs`: Google Apps Script backend for the shared Sheets leaderboard.
- `SPEC.md`: rules, scope, requirements, and acceptance criteria.
- `ARCHITECTURE.md`: stack, design, and AI workflow.
- `RETROSPECTIVE.md`: AI-native development retrospective.

# Retrospective

## AI Tools Used

- Codex desktop app for code changes, documentation, validation, and iteration.

## Development Workflow

The project followed an AI-native loop:

1. Define a small game idea.
2. Implement a playable prototype.
3. Add validation logic to avoid broken generated puzzles.
4. Iterate on visual polish and animations through user feedback.
5. Add onboarding and player metadata.
6. Add challenge documentation and deployment scaffolding.
7. Add a Google Apps Script and Sheets leaderboard integration for shared scoring.

Most changes were made in small increments and verified with static checks, especially JavaScript syntax parsing.

## What Worked Well

- The single-file static architecture made iteration fast.
- The generator plus solver check prevented most puzzle quality problems.
- User feedback was highly effective for tuning visual details, especially the goal and ball animation.
- Keeping the leaderboard as a hook preserved a clean future integration point.
- JSONP provided a practical bridge between static GitLab Pages hosting and a simple Apps Script backend.

## What Did Not Work Well

- Browser automation against the local `file://` page was restricted, so some visual verification required manual reloads.

## Surprises and Discoveries

- A realistic soccer ball photo can become visually worse than a simplified graphic at tiny UI size.
- Randomized animation targets need enough spatial separation to be perceptible.
- A small static project can still cover the full AI-native lifecycle when documentation, deployment, validation, and iteration are included.
- Even for a simple game, solver-backed generation is valuable because random puzzles can easily become unwinnable.

## Estimated Percentage of AI-Generated Code

Approximate estimate: 85-90%.

The user supplied direction, requirements, playtesting feedback, and the ball reference image. Codex generated most of the implementation, documentation, and configuration.

## Time Spent

Approximate estimate: 4-6 hours including iteration, visual tuning, and documentation.

## What I Would Do Differently Next Time

- Start with the repo deliverables from the beginning: `README`, `SPEC`, `ARCHITECTURE`, deployment config, and a stable `index.html`.
- Add lightweight automated UI tests earlier.
- Add a proper screenshot capture workflow for documentation.
- Separate the game into `src/` files if the project grows beyond the challenge scope.
- Add difficulty levels and a move counter once the core is stable.
- Add basic abuse protection or authentication if the leaderboard becomes more than a demo feature.

## Key Lessons Learned

- AI is strongest when paired with frequent human playtesting and concrete feedback.
- Small scoped changes are easier to validate and refine than large rewrites.
- Static deployment is a strong default for small browser games.
- Documentation should be treated as a deliverable, not an afterthought.
- AI-native development is not only code generation; it includes requirements capture, validation, iteration, deployment, and reflection.

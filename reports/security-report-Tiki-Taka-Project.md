# Security Review: Tiki-Taka-Project

## Scope

Deep repository security scan of the Tiki-Taka static browser game and its Google Apps Script/Sheets leaderboard backend. The scan reviewed the frontend, GitLab Pages publication path, and Apps Script backend evidence reached from the shipped leaderboard integration.

- Scan mode: deep_repository
- Target kind: git_revision
- Target ID: 87691604d9b87c19abe486ad62b723d5ea594f4b
- Revision: 87691604d9b87c19abe486ad62b723d5ea594f4b
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: No destructive live endpoint tests were run. Validation used static source tracing and official Apps Script API behavior; live spreadsheet mutation/load testing was avoided to keep the scan read-only for the application backend.
- Artifacts reviewed: .gitlab-ci.yml, index.html, tiki_taka_v6_trionda.html, google-apps-script/Code.gs, README.md, deep discovery worker artifacts, validation and attack-path receipts
- Scan context: Threat model generated during the scan from repository evidence. README.md line 50 explicitly states the Apps Script URL is public by design and suitable for challenge/demo use rather than fraud-resistant production scoring.

Limitations and exclusions:
- The scan did not call the live Apps Script endpoint with forged scores, formula payloads, or load traffic because those tests would mutate or stress the shared demo spreadsheet.
- The deterministic worklist helper emphasized static frontend and CI files; `google-apps-script/Code.gs` was reviewed as supporting backend context because the frontend and README identify it as the shared leaderboard backend.
- Apps Script deployment settings and Google Sheet contents were not available locally beyond repository code.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 4 |
| Severity mix | medium: 4 |
| Confidence mix | high: 3, medium: 1 |
| Coverage | complete |
| Validation mode | centralized static validation with official Google Apps Script API documentation for spreadsheet formula behavior |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

The project is a static browser game with a public Google Apps Script backend that writes to Google Sheets for shared leaderboard and player registry state. The main trust boundary is between unauthenticated browser or direct HTTP callers and Apps Script code that has spreadsheet write/read privileges.

### Assets

- Shared individual and country leaderboards
- Google Sheets cell integrity
- Player registry rows and jersey numbers
- Apps Script and Sheets execution quotas
- Limited display-game progress data

### Trust Boundaries

- Public GitLab Pages/static HTML to Apps Script web app
- Unauthenticated JSONP query parameters to spreadsheet-mutating backend functions
- Operator-visible Google Sheets data created from public player input

### Attacker Capabilities

- Load or script the static game
- Call the embedded Apps Script URL directly with chosen query parameters
- Choose display usernames, teams/countries, dates, and timing values
- Submit spreadsheet formula-like text to public text fields

### Security Objectives

- Prevent client-only state from being authoritative for shared leaderboard records
- Store public text in Sheets as literal text, not formulas
- Bound public backend actions with authentication, rate limiting, and volume controls
- Treat public display-name progress as low sensitivity unless future product requirements add identity/privacy guarantees

### Assumptions

- The Apps Script endpoint is public by design, per README.md.
- The leaderboard is a challenge/demo workflow, not a fraud-resistant production scoring system.
- No private tokens or credentials should be stored in the repository or spreadsheet.

## Findings

| Finding | Severity | Confidence |
| --- | --- | --- |
| [Public Apps Script endpoints allow registry pollution and Sheets quota exhaustion](#finding-1) | medium | medium |
| [Score submission stores formula-capable player and country cells](#finding-2) | medium | high |
| [Public score submission trusts client-supplied match completion data](#finding-3) | medium | high |
| [Player registration stores formula-capable username and team cells](#finding-4) | medium | high |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Public Apps Script endpoints allow registry pollution and Sheets quota exhaustion

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Static source evidence shows the unbounded public write/read-heavy operations, but destructive load proof was not run against the live spreadsheet and quota impact depends on deployment quotas and traffic volume. |
| Category | Unauthenticated resource abuse |
| CWE | CWE-306, CWE-400, CWE-770 |
| Affected lines | google-apps-script/Code.gs:34-56, google-apps-script/Code.gs:80-98, google-apps-script/Code.gs:119-178, google-apps-script/Code.gs:294-327 |

#### Summary

The Apps Script web app exposes write-heavy and read-heavy Google Sheets operations without authentication, rate limiting, row caps, or caller binding. Public callers can register arbitrary players, consume jersey-number space, submit unique username/date scores that trigger aggregate rebuilds, and repeatedly invoke endpoints that read and sort full score data.

#### Root Cause

The violated invariant is that public backend actions that mutate shared state or perform expensive sheet work need caller controls, rate limits, and volume bounds. The handler exposes all actions publicly and relies on locks, display-name duplicate checks, and text trimming rather than request throttling or authenticated state ownership.

**Public Apps Script action surface** — `google-apps-script/Code.gs:34-56`

`doGet` exposes all leaderboard actions through public query parameters without an authentication or rate-limit check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
    }
    if (action === 'list') {
      return respond_(listIndividualScores_(params), params.callback);
    }
    if (action === 'countries') {
      return respond_(listCountryScores_(params), params.callback);
    }
    if (action === 'progress') {
      return respond_(getPlayerProgress_(params), params.callback);
    }
    if (action === 'ping') {
      return respond_({ ok: true, message: 'pong' }, params.callback);
    }
    return respond_({ ok: false, error: 'Unknown action' }, params.callback);
```

**Score submission lock and aggregate rebuild** — `google-apps-script/Code.gs:80-98`

Each accepted score submission holds the script lock, appends a row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
  } finally {
    lock.releaseLock();
```

**Duplicate control is attacker-keyed** — `google-apps-script/Code.gs:104-110`

The duplicate check blocks only matching attacker-chosen username/date pairs, so unique values remain accepted.

```javascript
function enforceDailyMatchLimit_(playerName, date) {
  const usernameKey = normalizeKey_(playerName);
  const todaysScores = readIndividualScores_()
    .filter(score => normalizeKey_(score.username) === usernameKey && score.challengeDate === date);

  if (todaysScores.length) {
    throw new Error('This match already has a submitted score');
```

**Registration row mutation** — `google-apps-script/Code.gs:119-178`

Registration takes the script lock and updates or appends `Players` rows and jersey numbers for public callers.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
  } finally {
    lock.releaseLock();
  }
}

function registerPlayerForTeam_(username, team) {
  const sheet = getPlayersSheet_();
  const now = new Date();
  const usernameKey = normalizeKey_(username);
  const teamKey = normalizeKey_(team);
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const values = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getValues() : [];
  const displayValues = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getDisplayValues() : [];
  const players = values.map((row, i) => ({
    rowNumber: i + 2,
    username: String(row[1] || ''),
    team: String(row[2] || ''),
    usernameKey: normalizeKey_(String(row[1] || '')),
    teamKey: normalizeKey_(String(row[2] || '')),
    jerseyNumber: parseJerseyNumber_(displayValues[i][3] || row[3])
  }));

  const maxTeamNumber = players
    .filter(player => player.teamKey === teamKey)
    .map(player => player.jerseyNumber)
    .filter(number => Number.isFinite(number))
    .reduce((max, number) => Math.max(max, number), 0);

  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
    applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
    return {
      username,
      team,
      jerseyNumber
    };
  }

  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

**Public read-heavy endpoints** — `google-apps-script/Code.gs:187-215`

Public list and country endpoints read, filter, sort, and aggregate score data.

```javascript
function listIndividualScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_()
    .filter(score => !challengeDate || score.challengeDate === challengeDate)
    .sort((a, b) => a.totalMatchTimeSeconds - b.totalMatchTimeSeconds || a.serverTimestamp.localeCompare(b.serverTimestamp))
    .slice(0, limit)
    .map(score => ({
      serverTimestamp: score.serverTimestamp,
      username: score.username,
      team: score.team,
      time: score.totalMatchTime,
      totalMatchTime: score.totalMatchTime,
      puzzle1Time: score.puzzle1Time,
      puzzle2Time: score.puzzle2Time,
      puzzle3Time: score.puzzle3Time,
      challengeDate: score.challengeDate,
    }));

  return { ok: true, scores };
}

function listCountryScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const sortMode = params.sort === 'average' ? 'average' : 'fastest';
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_();
  const scopedScores = challengeDate ? scores.filter(score => score.challengeDate === challengeDate) : scores;
  return { ok: true, countries: buildCountryRows_(scopedScores, sortMode, limit) };
```

**Full sheet reads and aggregate writes** — `google-apps-script/Code.gs:294-327`

Aggregate rebuild and score reading scan sheet ranges and rewrite country-score rows.

```javascript
function rebuildCountryScores_() {
  const scores = readIndividualScores_();
  const scoresByDate = {};
  scores.forEach(score => {
    if (!scoresByDate[score.challengeDate]) scoresByDate[score.challengeDate] = [];
    scoresByDate[score.challengeDate].push(score);
  });
  const rows = Object.keys(scoresByDate)
    .sort((a, b) => b.localeCompare(a))
    .flatMap(date => buildCountryRows_(scoresByDate[date], 'fastest', Math.max(scoresByDate[date].length, 1))
      .map(team => [
        date,
        team.team,
        team.plays,
        team.fastestGoal,
        team.averageMatchTime,
        team.lastPlayed
      ]));

  const sheet = getSheet_(COUNTRY_SHEET_NAME, COUNTRY_HEADERS);
  const existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (existingRows) sheet.getRange(2, 1, existingRows, COUNTRY_HEADERS.length).clearContent();
  applySheetFormats_(sheet, COUNTRY_SHEET_NAME);
  if (rows.length) sheet.getRange(2, 1, rows.length, COUNTRY_HEADERS.length).setValues(rows);
}

function rebuildCountryScores() {
  rebuildCountryScores_();
}

function readIndividualScores_() {
  const sheet = getIndividualSheet_();
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();
```

#### Validation

Validation confirmed unauthenticated entry points for write-heavy and read-heavy sheet operations. Dynamic proof was intentionally limited because mass registration, score submission, or load testing would alter or stress the real shared spreadsheet.

Validation method: static source trace

**Public Apps Script action surface** — `google-apps-script/Code.gs:34-56`

`doGet` exposes all leaderboard actions through public query parameters without an authentication or rate-limit check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
    }
    if (action === 'list') {
      return respond_(listIndividualScores_(params), params.callback);
    }
    if (action === 'countries') {
      return respond_(listCountryScores_(params), params.callback);
    }
    if (action === 'progress') {
      return respond_(getPlayerProgress_(params), params.callback);
    }
    if (action === 'ping') {
      return respond_({ ok: true, message: 'pong' }, params.callback);
    }
    return respond_({ ok: false, error: 'Unknown action' }, params.callback);
```

**Score submission lock and aggregate rebuild** — `google-apps-script/Code.gs:80-98`

Each accepted score submission holds the script lock, appends a row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
  } finally {
    lock.releaseLock();
```

**Duplicate control is attacker-keyed** — `google-apps-script/Code.gs:104-110`

The duplicate check blocks only matching attacker-chosen username/date pairs, so unique values remain accepted.

```javascript
function enforceDailyMatchLimit_(playerName, date) {
  const usernameKey = normalizeKey_(playerName);
  const todaysScores = readIndividualScores_()
    .filter(score => normalizeKey_(score.username) === usernameKey && score.challengeDate === date);

  if (todaysScores.length) {
    throw new Error('This match already has a submitted score');
```

**Registration row mutation** — `google-apps-script/Code.gs:119-178`

Registration takes the script lock and updates or appends `Players` rows and jersey numbers for public callers.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
  } finally {
    lock.releaseLock();
  }
}

function registerPlayerForTeam_(username, team) {
  const sheet = getPlayersSheet_();
  const now = new Date();
  const usernameKey = normalizeKey_(username);
  const teamKey = normalizeKey_(team);
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const values = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getValues() : [];
  const displayValues = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getDisplayValues() : [];
  const players = values.map((row, i) => ({
    rowNumber: i + 2,
    username: String(row[1] || ''),
    team: String(row[2] || ''),
    usernameKey: normalizeKey_(String(row[1] || '')),
    teamKey: normalizeKey_(String(row[2] || '')),
    jerseyNumber: parseJerseyNumber_(displayValues[i][3] || row[3])
  }));

  const maxTeamNumber = players
    .filter(player => player.teamKey === teamKey)
    .map(player => player.jerseyNumber)
    .filter(number => Number.isFinite(number))
    .reduce((max, number) => Math.max(max, number), 0);

  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
    applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
    return {
      username,
      team,
      jerseyNumber
    };
  }

  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

**Public read-heavy endpoints** — `google-apps-script/Code.gs:187-215`

Public list and country endpoints read, filter, sort, and aggregate score data.

```javascript
function listIndividualScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_()
    .filter(score => !challengeDate || score.challengeDate === challengeDate)
    .sort((a, b) => a.totalMatchTimeSeconds - b.totalMatchTimeSeconds || a.serverTimestamp.localeCompare(b.serverTimestamp))
    .slice(0, limit)
    .map(score => ({
      serverTimestamp: score.serverTimestamp,
      username: score.username,
      team: score.team,
      time: score.totalMatchTime,
      totalMatchTime: score.totalMatchTime,
      puzzle1Time: score.puzzle1Time,
      puzzle2Time: score.puzzle2Time,
      puzzle3Time: score.puzzle3Time,
      challengeDate: score.challengeDate,
    }));

  return { ok: true, scores };
}

function listCountryScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const sortMode = params.sort === 'average' ? 'average' : 'fastest';
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_();
  const scopedScores = challengeDate ? scores.filter(score => score.challengeDate === challengeDate) : scores;
  return { ok: true, countries: buildCountryRows_(scopedScores, sortMode, limit) };
```

**Full sheet reads and aggregate writes** — `google-apps-script/Code.gs:294-327`

Aggregate rebuild and score reading scan sheet ranges and rewrite country-score rows.

```javascript
function rebuildCountryScores_() {
  const scores = readIndividualScores_();
  const scoresByDate = {};
  scores.forEach(score => {
    if (!scoresByDate[score.challengeDate]) scoresByDate[score.challengeDate] = [];
    scoresByDate[score.challengeDate].push(score);
  });
  const rows = Object.keys(scoresByDate)
    .sort((a, b) => b.localeCompare(a))
    .flatMap(date => buildCountryRows_(scoresByDate[date], 'fastest', Math.max(scoresByDate[date].length, 1))
      .map(team => [
        date,
        team.team,
        team.plays,
        team.fastestGoal,
        team.averageMatchTime,
        team.lastPlayed
      ]));

  const sheet = getSheet_(COUNTRY_SHEET_NAME, COUNTRY_HEADERS);
  const existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (existingRows) sheet.getRange(2, 1, existingRows, COUNTRY_HEADERS.length).clearContent();
  applySheetFormats_(sheet, COUNTRY_SHEET_NAME);
  if (rows.length) sheet.getRange(2, 1, rows.length, COUNTRY_HEADERS.length).setValues(rows);
}

function rebuildCountryScores() {
  rebuildCountryScores_();
}

function readIndividualScores_() {
  const sheet = getIndividualSheet_();
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();
```

Evidence:
- All relevant actions are selected by public `action` query parameters.
- Registration mutates `Players` rows and jersey numbers.
- Score submission appends rows and rebuilds aggregate country scores.
- Read endpoints scan and sort score data.

Counterevidence and remaining uncertainty:
- README.md identifies this as a public demo/challenge leaderboard, not a production availability target.
- Actual quota-exhaustion thresholds depend on Apps Script/Sheets quotas and live traffic, which were not tested.

#### Dataflow

public action query parameter -\> `doGet` -\> registration/submit/list/countries handlers -\> Google Sheets row mutation or full-range reads

- **Source:** unauthenticated public Apps Script requests

- **Sink:** Google Sheets row writes, full-range reads, and aggregate rewrites

- **Outcome:** shared registry pollution and backend quota/work amplification

**Public Apps Script action surface** — `google-apps-script/Code.gs:34-56`

`doGet` exposes all leaderboard actions through public query parameters without an authentication or rate-limit check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
    }
    if (action === 'list') {
      return respond_(listIndividualScores_(params), params.callback);
    }
    if (action === 'countries') {
      return respond_(listCountryScores_(params), params.callback);
    }
    if (action === 'progress') {
      return respond_(getPlayerProgress_(params), params.callback);
    }
    if (action === 'ping') {
      return respond_({ ok: true, message: 'pong' }, params.callback);
    }
    return respond_({ ok: false, error: 'Unknown action' }, params.callback);
```

**Registration row mutation** — `google-apps-script/Code.gs:119-178`

Registration takes the script lock and updates or appends `Players` rows and jersey numbers for public callers.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
  } finally {
    lock.releaseLock();
  }
}

function registerPlayerForTeam_(username, team) {
  const sheet = getPlayersSheet_();
  const now = new Date();
  const usernameKey = normalizeKey_(username);
  const teamKey = normalizeKey_(team);
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const values = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getValues() : [];
  const displayValues = rowCount ? sheet.getRange(2, 1, rowCount, PLAYERS_HEADERS.length).getDisplayValues() : [];
  const players = values.map((row, i) => ({
    rowNumber: i + 2,
    username: String(row[1] || ''),
    team: String(row[2] || ''),
    usernameKey: normalizeKey_(String(row[1] || '')),
    teamKey: normalizeKey_(String(row[2] || '')),
    jerseyNumber: parseJerseyNumber_(displayValues[i][3] || row[3])
  }));

  const maxTeamNumber = players
    .filter(player => player.teamKey === teamKey)
    .map(player => player.jerseyNumber)
    .filter(number => Number.isFinite(number))
    .reduce((max, number) => Math.max(max, number), 0);

  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
    applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
    return {
      username,
      team,
      jerseyNumber
    };
  }

  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

**Score submission lock and aggregate rebuild** — `google-apps-script/Code.gs:80-98`

Each accepted score submission holds the script lock, appends a row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
  } finally {
    lock.releaseLock();
```

**Public read-heavy endpoints** — `google-apps-script/Code.gs:187-215`

Public list and country endpoints read, filter, sort, and aggregate score data.

```javascript
function listIndividualScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_()
    .filter(score => !challengeDate || score.challengeDate === challengeDate)
    .sort((a, b) => a.totalMatchTimeSeconds - b.totalMatchTimeSeconds || a.serverTimestamp.localeCompare(b.serverTimestamp))
    .slice(0, limit)
    .map(score => ({
      serverTimestamp: score.serverTimestamp,
      username: score.username,
      team: score.team,
      time: score.totalMatchTime,
      totalMatchTime: score.totalMatchTime,
      puzzle1Time: score.puzzle1Time,
      puzzle2Time: score.puzzle2Time,
      puzzle3Time: score.puzzle3Time,
      challengeDate: score.challengeDate,
    }));

  return { ok: true, scores };
}

function listCountryScores_(params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  const sortMode = params.sort === 'average' ? 'average' : 'fastest';
  const challengeDate = cleanDate_(params.challengeDate);
  const scores = readIndividualScores_();
  const scopedScores = challengeDate ? scores.filter(score => score.challengeDate === challengeDate) : scores;
  return { ok: true, countries: buildCountryRows_(scopedScores, sortMode, limit) };
```

**Full sheet reads and aggregate writes** — `google-apps-script/Code.gs:294-327`

Aggregate rebuild and score reading scan sheet ranges and rewrite country-score rows.

```javascript
function rebuildCountryScores_() {
  const scores = readIndividualScores_();
  const scoresByDate = {};
  scores.forEach(score => {
    if (!scoresByDate[score.challengeDate]) scoresByDate[score.challengeDate] = [];
    scoresByDate[score.challengeDate].push(score);
  });
  const rows = Object.keys(scoresByDate)
    .sort((a, b) => b.localeCompare(a))
    .flatMap(date => buildCountryRows_(scoresByDate[date], 'fastest', Math.max(scoresByDate[date].length, 1))
      .map(team => [
        date,
        team.team,
        team.plays,
        team.fastestGoal,
        team.averageMatchTime,
        team.lastPlayed
      ]));

  const sheet = getSheet_(COUNTRY_SHEET_NAME, COUNTRY_HEADERS);
  const existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (existingRows) sheet.getRange(2, 1, existingRows, COUNTRY_HEADERS.length).clearContent();
  applySheetFormats_(sheet, COUNTRY_SHEET_NAME);
  if (rows.length) sheet.getRange(2, 1, rows.length, COUNTRY_HEADERS.length).setValues(rows);
}

function rebuildCountryScores() {
  rebuildCountryScores_();
}

function readIndividualScores_() {
  const sheet = getIndividualSheet_();
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();
```

#### Reachability

The public Apps Script URL is embedded in the static frontend and documented as public. The code shows no server-side rate limit, origin check, authentication, or per-player ownership binding.

- **Attacker:** unauthenticated internet user

- **Entry point:** Google Apps Script `doGet` actions

- **Outcome:** degraded shared leaderboard integrity and availability

Preconditions:
- The Apps Script deployment remains public and backed by the configured Google Sheet.

#### Severity

**Medium** — The endpoint is public and can mutate or consume work on the shared Sheets backend. Severity is medium because the affected workflow is a demo leaderboard and the scan did not prove severe business, safety, account, or credential impact.

Severity would increase if the backend supported production scoring, rewards, or sensitive operational workflows, or if load testing proved easy sustained quota exhaustion; it would decrease if endpoint-level rate limits, row caps, and authenticated registration were added.

#### Remediation

Add endpoint-level abuse controls. Require a server-issued session or registration token for state-changing actions, enforce per-IP/per-player/day rate limits, cap rows and teams, validate team allowlists, debounce aggregate rebuilds, and cache or paginate read endpoints so unauthenticated callers cannot force full sheet scans repeatedly.

Tests:
- Attempt repeated `registerPlayer` calls with unique usernames and assert rate limits or row caps stop unbounded growth.
- Attempt repeated unique `submit` requests and assert aggregate rebuilds are throttled or queued.
- Call `list` and `countries` in a loop and assert read endpoints are cached or rate-limited.

Preventive controls:
- Monitor Apps Script execution quota errors and abnormal action volume.
- Separate public demo data from operator-owned or production spreadsheets.

<a id="finding-2"></a>

### [2] Score submission stores formula-capable player and country cells

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The source-to-sink path is direct and Google’s Apps Script documentation states `appendRow` and `setValues` interpret leading `=` values as formulas. |
| Category | Spreadsheet formula injection |
| CWE | CWE-1236, CWE-20 |
| Affected lines | google-apps-script/Code.gs:463-467, google-apps-script/Code.gs:86-95, google-apps-script/Code.gs:431-435 |

#### Summary

The public score submission path writes `playerName` and `country` values into `Individual Scores` after `cleanText_` removes only a small punctuation set. Those columns are not forced to literal text, and Google Apps Script treats values beginning with `=` as formulas when inserted with `appendRow`, so a remote caller can store spreadsheet formulas in the score sheet.

#### Root Cause

The violated invariant is that untrusted text written to Sheets must be stored as literal text. `cleanText_` does not neutralize formula prefixes, and the text-formatting control excludes the player/team columns that receive public submit input.

**Submit text parameters** — `google-apps-script/Code.gs:63-66`

The public submit path reads `playerName` and `country`/`team` from request parameters.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` strips a small punctuation set and truncates, but it does not prefix or reject formula-leading characters such as `=`.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Text formatting omits name/team cells** — `google-apps-script/Code.gs:431-435`

Only date/time columns 4-8 are forced to text on `Individual Scores`; columns 2-3 hold attacker-controlled player and country values.

```javascript
function applySheetFormats_(sheet, name) {
  const rowCount = Math.max(sheet.getMaxRows(), 1);
  if (name === INDIVIDUAL_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 5).setNumberFormat('@');
  }
```

**Formula-capable score cells** — `google-apps-script/Code.gs:86-95`

`appendRow` writes the untrusted player and country values directly into the score sheet.

```javascript
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
```

#### Validation

Validation confirmed that public submit parameters reach `appendRow` without formula-prefix neutralization. Google’s Apps Script documentation says `Sheet.appendRow` interprets leading-equals cell content as formulas; the `Range.setValues` documentation says the same for grid writes.

Validation method: static source trace plus official Apps Script API documentation

**Submit text parameters** — `google-apps-script/Code.gs:63-66`

The public submit path reads `playerName` and `country`/`team` from request parameters.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` strips a small punctuation set and truncates, but it does not prefix or reject formula-leading characters such as `=`.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Text formatting omits name/team cells** — `google-apps-script/Code.gs:431-435`

Only date/time columns 4-8 are forced to text on `Individual Scores`; columns 2-3 hold attacker-controlled player and country values.

```javascript
function applySheetFormats_(sheet, name) {
  const rowCount = Math.max(sheet.getMaxRows(), 1);
  if (name === INDIVIDUAL_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 5).setNumberFormat('@');
  }
```

**Formula-capable score cells** — `google-apps-script/Code.gs:86-95`

`appendRow` writes the untrusted player and country values directly into the score sheet.

```javascript
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
```

Evidence:
- `cleanText_` does not reject or escape `=`.
- `Individual Scores` columns 2-3 are not set to text format.
- Official Apps Script documentation confirms leading `=` values are interpreted as formulas for the relevant write APIs.

Counterevidence and remaining uncertainty:
- No live formula was written to the shared sheet during this read-only scan.
- The README warns not to store private tokens or credentials, limiting demonstrated downstream impact.

#### Dataflow

submit query parameter -\> `cleanText_` -\> `appendRow` -\> formula-capable score cell

- **Source:** public `playerName` or `country` submit parameter

- **Sink:** Google Sheets `appendRow` into `Individual Scores` columns 2-3

- **Outcome:** stored spreadsheet formula in the score sheet

**Submit text parameters** — `google-apps-script/Code.gs:63-66`

The public submit path reads `playerName` and `country`/`team` from request parameters.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` strips a small punctuation set and truncates, but it does not prefix or reject formula-leading characters such as `=`.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Formula-capable score cells** — `google-apps-script/Code.gs:86-95`

`appendRow` writes the untrusted player and country values directly into the score sheet.

```javascript
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
```

#### Reachability

The same public `submit` endpoint used for leaderboard scores accepts the affected text fields. The attacker needs only the public Apps Script URL.

- **Attacker:** unauthenticated internet user

- **Entry point:** Google Apps Script `action=submit`

- **Outcome:** stored formula-capable cell in operator-visible sheet

Preconditions:
- A sheet viewer, automation, or export later evaluates or processes formula cells.

#### Severity

**Medium** — A public unauthenticated path can persist attacker-controlled spreadsheet formulas into an operator-owned Google Sheet. Impact is medium because formula execution depends on spreadsheet evaluation/operator workflows and no direct credential exfiltration was proven.

Severity would increase if the sheet is opened by privileged operators, exported to automation, or contains sensitive data; it would decrease if all public text columns are forced to literal text before insertion.

#### Remediation

Normalize all untrusted spreadsheet text before writing. Reject or prefix literal text that starts with `=`, `+`, `-`, `@`, tab, carriage return, or other formula-triggering characters, and set all user-controlled text columns to plain text before data insertion.

Tests:
- Submit a score with `playerName` beginning with `=` and assert the sheet stores a literal string, not a formula.
- Submit a score with formula prefixes in `country`/`team` and assert columns 2-3 remain literal text.

Preventive controls:
- Centralize spreadsheet-safe text escaping in one helper and use it before every `appendRow` or `setValues` call.
- Add regression tests around formula-prefix payloads for all public text fields.

<a id="finding-3"></a>

### [3] Public score submission trusts client-supplied match completion data

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Static source evidence shows the public dispatch, request-controlled fields, and append sink directly; no live mutation was needed to validate the source-to-sink path. |
| Category | Client-side trust boundary bypass |
| CWE | CWE-306, CWE-345, CWE-602 |
| Affected lines | google-apps-script/Code.gs:63-78, google-apps-script/Code.gs:86-96, tiki_taka_v6_trionda.html:1030-1063 |

#### Summary

The public Apps Script `submit` action accepts the player identity, team, date, puzzle split times, and total match time from unauthenticated query parameters. The server checks only syntax/range consistency and a same username/date duplicate rule before appending to the shared leaderboard, so a direct caller can forge scores without solving the puzzles.

#### Root Cause

The violated invariant is that leaderboard scores should be accepted only after a server-trusted proof of completion or caller identity binding. The backend trusts all score material from public request parameters and uses only format/range checks before writing shared leaderboard state.

**Public submit dispatch** — `google-apps-script/Code.gs:34-42`

`doGet` routes public query-string actions to `submitScore_` without an authentication or caller-identity check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
```

**Client-supplied score fields** — `google-apps-script/Code.gs:63-78`

`submitScore_` takes player identity, team/country, date, split times, and total from request parameters and validates only format, range, and total consistency.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
  const puzzle1Time = parseTime_(params.puzzle1Time);
  const puzzle2Time = parseTime_(params.puzzle2Time);
  const puzzle3Time = parseTime_(params.puzzle3Time);
  const submittedTotal = parseTime_(params.totalMatchTime);
  const totalMatchTime = Number.isFinite(submittedTotal) ? submittedTotal : puzzle1Time + puzzle2Time + puzzle3Time;

  if (!country) throw new Error('Country is required');
  if (!date) throw new Error('Date is required');
  [puzzle1Time, puzzle2Time, puzzle3Time, totalMatchTime].forEach(time => {
    if (!Number.isFinite(time) || time < 0 || time > 36000) throw new Error('Invalid match time');
  });
  if (Math.abs(totalMatchTime - (puzzle1Time + puzzle2Time + puzzle3Time)) > 1) throw new Error('Total match time does not match puzzle times');
```

**Leaderboard row mutation** — `google-apps-script/Code.gs:80-96`

After the lightweight checks, the handler takes a script lock, enforces only a same username/date duplicate check, appends the row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
```

#### Validation

Validation confirmed a direct public source-to-sink path: JSONP query parameters reach `submitScore_`, the handler validates only simple numeric and duplicate constraints, and accepted values are appended to the Google Sheet. No live request was sent to the shared Apps Script deployment because mutation or load tests would alter the real demo spreadsheet; validation used static source tracing and official Apps Script behavior where relevant.

Validation method: static source trace

**Public submit dispatch** — `google-apps-script/Code.gs:34-42`

`doGet` routes public query-string actions to `submitScore_` without an authentication or caller-identity check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
```

**Client-supplied score fields** — `google-apps-script/Code.gs:63-78`

`submitScore_` takes player identity, team/country, date, split times, and total from request parameters and validates only format, range, and total consistency.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
  const puzzle1Time = parseTime_(params.puzzle1Time);
  const puzzle2Time = parseTime_(params.puzzle2Time);
  const puzzle3Time = parseTime_(params.puzzle3Time);
  const submittedTotal = parseTime_(params.totalMatchTime);
  const totalMatchTime = Number.isFinite(submittedTotal) ? submittedTotal : puzzle1Time + puzzle2Time + puzzle3Time;

  if (!country) throw new Error('Country is required');
  if (!date) throw new Error('Date is required');
  [puzzle1Time, puzzle2Time, puzzle3Time, totalMatchTime].forEach(time => {
    if (!Number.isFinite(time) || time < 0 || time > 36000) throw new Error('Invalid match time');
  });
  if (Math.abs(totalMatchTime - (puzzle1Time + puzzle2Time + puzzle3Time)) > 1) throw new Error('Total match time does not match puzzle times');
```

**Leaderboard row mutation** — `google-apps-script/Code.gs:80-96`

After the lightweight checks, the handler takes a script lock, enforces only a same username/date duplicate check, appends the row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
```

**Frontend JSONP transport** — `tiki_taka_v6_trionda.html:1030-1043`

The browser transport serializes arbitrary action parameters into the public Apps Script URL, which an attacker can reproduce directly outside the UI.

```javascript
function gasRequest(action,params={}){
  return new Promise((resolve,reject)=>{
    if(!leaderboardConfigured()){
      resolve({ok:false,reason:'not_configured'});
      return;
    }
    const callbackName=`ttLeaderboard_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url=new URL(LEADERBOARD_CONFIG.endpoint);
    url.searchParams.set('action',action);
    url.searchParams.set('callback',callbackName);
    url.searchParams.set('cacheBust',Date.now().toString());
    Object.entries(params).forEach(([key,value])=>{
      if(value!==undefined&&value!==null) url.searchParams.set(key,String(value));
    });
```

Evidence:
- `doGet` dispatches `action=submit` without authentication.
- The submitted player, team, date, and timing fields are all parameter-controlled.
- The duplicate check is keyed only by attacker-chosen normalized username and date.

Counterevidence and remaining uncertainty:
- README.md states the Apps Script URL is public by design and suitable for challenge/demo use, which limits impact but does not defeat the shared-state integrity issue.

#### Dataflow

query parameters -\> `doGet` -\> `submitScore_` -\> `appendRow` -\> rebuilt country aggregate

- **Source:** unauthenticated Apps Script query parameters

- **Sink:** `Individual Scores` row append and country-score rebuild

- **Outcome:** forged leaderboard entries and username/date lockout

**Frontend JSONP transport** — `tiki_taka_v6_trionda.html:1030-1043`

The browser transport serializes arbitrary action parameters into the public Apps Script URL, which an attacker can reproduce directly outside the UI.

```javascript
function gasRequest(action,params={}){
  return new Promise((resolve,reject)=>{
    if(!leaderboardConfigured()){
      resolve({ok:false,reason:'not_configured'});
      return;
    }
    const callbackName=`ttLeaderboard_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url=new URL(LEADERBOARD_CONFIG.endpoint);
    url.searchParams.set('action',action);
    url.searchParams.set('callback',callbackName);
    url.searchParams.set('cacheBust',Date.now().toString());
    Object.entries(params).forEach(([key,value])=>{
      if(value!==undefined&&value!==null) url.searchParams.set(key,String(value));
    });
```

**Public submit dispatch** — `google-apps-script/Code.gs:34-42`

`doGet` routes public query-string actions to `submitScore_` without an authentication or caller-identity check.

```javascript
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';
  try {
    if (action === 'registerPlayer') {
      return respond_(registerPlayer_(params), params.callback);
    }
    if (action === 'submit') {
      return respond_(submitScore_(params), params.callback);
```

**Client-supplied score fields** — `google-apps-script/Code.gs:63-78`

`submitScore_` takes player identity, team/country, date, split times, and total from request parameters and validates only format, range, and total consistency.

```javascript
function submitScore_(params) {
  const playerName = cleanText_(params.playerName || params.username, 18) || 'Player';
  const country = cleanText_(params.country || params.team, 40);
  const date = cleanDate_(params.date || params.challengeDate);
  const puzzle1Time = parseTime_(params.puzzle1Time);
  const puzzle2Time = parseTime_(params.puzzle2Time);
  const puzzle3Time = parseTime_(params.puzzle3Time);
  const submittedTotal = parseTime_(params.totalMatchTime);
  const totalMatchTime = Number.isFinite(submittedTotal) ? submittedTotal : puzzle1Time + puzzle2Time + puzzle3Time;

  if (!country) throw new Error('Country is required');
  if (!date) throw new Error('Date is required');
  [puzzle1Time, puzzle2Time, puzzle3Time, totalMatchTime].forEach(time => {
    if (!Number.isFinite(time) || time < 0 || time > 36000) throw new Error('Invalid match time');
  });
  if (Math.abs(totalMatchTime - (puzzle1Time + puzzle2Time + puzzle3Time)) > 1) throw new Error('Total match time does not match puzzle times');
```

**Leaderboard row mutation** — `google-apps-script/Code.gs:80-96`

After the lightweight checks, the handler takes a script lock, enforces only a same username/date duplicate check, appends the row, and rebuilds country scores.

```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const individualSheet = getIndividualSheet_();
    enforceDailyMatchLimit_(playerName, date);
    applySheetFormats_(individualSheet, INDIVIDUAL_SHEET_NAME);
    individualSheet.appendRow([
      new Date(),
      playerName,
      country,
      date,
      formatTime_(puzzle1Time),
      formatTime_(puzzle2Time),
      formatTime_(puzzle3Time),
      formatTime_(totalMatchTime)
    ]);
    rebuildCountryScores_();
```

#### Reachability

The endpoint URL is embedded in the shipped static HTML and README documents a public shared leaderboard. No repository evidence shows caller authentication or server-side solve proof.

- **Attacker:** unauthenticated internet user who can load or script the public URL

- **Entry point:** Google Apps Script `action=submit` JSONP request

- **Outcome:** shared leaderboard integrity loss

Preconditions:
- The Apps Script deployment remains reachable as the public URL embedded in the frontend.

#### Severity

**Medium** — The path is unauthenticated and remotely reachable through the public Apps Script URL, and it modifies shared leaderboard state. The impact is capped at medium because the README explicitly positions the leaderboard as a public demo/challenge surface rather than fraud-resistant production scoring, and no account, credential, tenant, or private-data boundary is shown.

Severity would increase if this leaderboard became authoritative for rewards, access, production records, or user reputation; it would drop if the endpoint were restricted to disposable local demos or server-side solve proof were added.

#### Remediation

Move score authority to the backend. Store per-puzzle completion server-side, issue a nonce or signed completion token per daily match, bind submissions to that token and date, and reject score rows that are not backed by server-observed completions. Keep duplicate prevention keyed to a server-side player identity rather than only display name/date.

Tests:
- Submit a crafted `action=submit` URL without a server-issued completion token and assert no row is written.
- Complete a legitimate daily match through the UI and assert exactly one server-authorized score row is accepted.
- Attempt a second submission for the same server-side player/date and assert it is rejected.

Preventive controls:
- Do not use client-only localStorage or browser timers as authority for shared leaderboard data.
- Add backend audit logging for rejected and accepted submissions.

<a id="finding-4"></a>

### [4] Player registration stores formula-capable username and team cells

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Static source evidence shows both registration write sinks and the missing formula neutralization; Google’s Apps Script documentation confirms leading `=` values are formulas for `appendRow`/`setValues`. |
| Category | Spreadsheet formula injection |
| CWE | CWE-1236, CWE-20 |
| Affected lines | google-apps-script/Code.gs:463-467, google-apps-script/Code.gs:155-160, google-apps-script/Code.gs:171-177, google-apps-script/Code.gs:431-442 |

#### Summary

The public player-registration path writes `username` and `team` values into the `Players` sheet through `setValues` or `appendRow` after a cleaner that does not neutralize formula prefixes. The sheet formatting protects only the jersey number column, leaving attacker-controlled display fields formula-capable.

#### Root Cause

The violated invariant is identical to the score-sheet path: public display text must be stored as literal spreadsheet text. Registration sends formula-prefix-capable username/team values into both `setValues` and `appendRow`, while formatting only the jersey-number column as text.

**Registration text parameters** — `google-apps-script/Code.gs:114-123`

The registration action reads public `username` and `team` parameters, then proceeds under a script lock without caller authentication.

```javascript
function registerPlayer_(params) {
  const username = cleanText_(params.username, 18) || 'Player';
  const team = cleanText_(params.team, 40);
  if (!team) throw new Error('Team is required');

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` does not neutralize spreadsheet formula prefixes.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Players formatting omits username/team** — `google-apps-script/Code.gs:431-442`

Only the jersey-number column is formatted as text on `Players`; username and team remain formula-capable cells.

```javascript
function applySheetFormats_(sheet, name) {
  const rowCount = Math.max(sheet.getMaxRows(), 1);
  if (name === INDIVIDUAL_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 5).setNumberFormat('@');
  }
  if (name === COUNTRY_SHEET_NAME) {
    sheet.getRange(1, 1, rowCount, 1).setNumberFormat('@');
    sheet.getRange(1, 4, rowCount, 2).setNumberFormat('@');
  }
  if (name === PLAYERS_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 1).setNumberFormat('@');
  }
```

**Existing player update sink** — `google-apps-script/Code.gs:152-160`

Existing player rows are updated with attacker-controlled username/team through `setValues`.

```javascript
  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
```

**New player append sink** — `google-apps-script/Code.gs:169-178`

New player rows are appended with attacker-controlled username/team through `appendRow`.

```javascript
  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

#### Validation

Validation confirmed that public registration text reaches both player update and append sinks without formula-prefix neutralization. Apps Script documentation confirms that leading `=` values are interpreted as formulas for the write APIs used here.

Validation method: static source trace plus official Apps Script API documentation

**Registration text parameters** — `google-apps-script/Code.gs:114-123`

The registration action reads public `username` and `team` parameters, then proceeds under a script lock without caller authentication.

```javascript
function registerPlayer_(params) {
  const username = cleanText_(params.username, 18) || 'Player';
  const team = cleanText_(params.team, 40);
  if (!team) throw new Error('Team is required');

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` does not neutralize spreadsheet formula prefixes.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Players formatting omits username/team** — `google-apps-script/Code.gs:431-442`

Only the jersey-number column is formatted as text on `Players`; username and team remain formula-capable cells.

```javascript
function applySheetFormats_(sheet, name) {
  const rowCount = Math.max(sheet.getMaxRows(), 1);
  if (name === INDIVIDUAL_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 5).setNumberFormat('@');
  }
  if (name === COUNTRY_SHEET_NAME) {
    sheet.getRange(1, 1, rowCount, 1).setNumberFormat('@');
    sheet.getRange(1, 4, rowCount, 2).setNumberFormat('@');
  }
  if (name === PLAYERS_SHEET_NAME) {
    sheet.getRange(1, 4, rowCount, 1).setNumberFormat('@');
  }
```

**Existing player update sink** — `google-apps-script/Code.gs:152-160`

Existing player rows are updated with attacker-controlled username/team through `setValues`.

```javascript
  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
```

**New player append sink** — `google-apps-script/Code.gs:169-178`

New player rows are appended with attacker-controlled username/team through `appendRow`.

```javascript
  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

Evidence:
- `registerPlayer_` accepts public username/team values.
- `cleanText_` does not escape formula prefixes.
- `Players` sheet formatting does not cover username/team columns.
- Both existing-row and new-row registration paths write attacker-controlled text to Sheets.

Counterevidence and remaining uncertainty:
- No live malicious registration was performed against the shared sheet.
- The registry is a demo player registry rather than a private account database.

#### Dataflow

register query parameter -\> `cleanText_` -\> `setValues` or `appendRow` -\> formula-capable player cell

- **Source:** public `username` or `team` registration parameter

- **Sink:** Google Sheets `Players` username/team cells

- **Outcome:** stored spreadsheet formula in player registry

**Registration text parameters** — `google-apps-script/Code.gs:114-123`

The registration action reads public `username` and `team` parameters, then proceeds under a script lock without caller authentication.

```javascript
function registerPlayer_(params) {
  const username = cleanText_(params.username, 18) || 'Player';
  const team = cleanText_(params.team, 40);
  if (!team) throw new Error('Team is required');

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const profile = registerPlayerForTeam_(username, team);
    return { ok: true, username: profile.username, team: profile.team, jerseyNumber: formatJerseyNumber_(profile.jerseyNumber) };
```

**Text cleaner does not neutralize formulas** — `google-apps-script/Code.gs:463-467`

`cleanText_` does not neutralize spreadsheet formula prefixes.

```javascript
function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
```

**Existing player update sink** — `google-apps-script/Code.gs:152-160`

Existing player rows are updated with attacker-controlled username/team through `setValues`.

```javascript
  const existingPlayer = players.find(player => player.usernameKey === usernameKey && player.teamKey === teamKey);
  if (existingPlayer) {
    const jerseyNumber = Number.isFinite(existingPlayer.jerseyNumber) ? existingPlayer.jerseyNumber : maxTeamNumber + 1;
    sheet.getRange(existingPlayer.rowNumber, 2, 1, 4).setValues([[
      username,
      team,
      formatJerseyNumber_(jerseyNumber),
      now
    ]]);
```

**New player append sink** — `google-apps-script/Code.gs:169-178`

New player rows are appended with attacker-controlled username/team through `appendRow`.

```javascript
  const nextNumber = maxTeamNumber + 1;

  sheet.appendRow([
    now,
    username,
    team,
    formatJerseyNumber_(nextNumber),
    now
  ]);
  applySheetFormats_(sheet, PLAYERS_SHEET_NAME);
```

#### Reachability

The frontend calls registration for saved profiles, and the same Apps Script action can be called directly with chosen parameters.

- **Attacker:** unauthenticated internet user

- **Entry point:** Google Apps Script `action=registerPlayer`

- **Outcome:** stored formula-capable cell in player registry

Preconditions:
- A sheet viewer, automation, or export later evaluates or processes formula cells.

#### Severity

**Medium** — A public unauthenticated registration path can persist attacker-controlled formulas into an operator-visible player registry. Impact is medium because execution depends on spreadsheet evaluation/operator workflows and no secret exfiltration was directly proven.

Severity would increase if the player sheet is consumed by privileged automation or contains sensitive operational data; it would drop if username/team cells are escaped or forced to literal text before writes.

#### Remediation

Apply the same spreadsheet-safe text normalization to registration fields before `setValues` and `appendRow`. Force username/team columns to plain text and reject or literalize formula-leading characters.

Tests:
- Register a username starting with `=` and assert the `Players` cell is literal text.
- Update an existing player row with a formula-prefixed team and assert `setValues` stores literal text.

Preventive controls:
- Use one safe cell-writing helper for all user-controlled Google Sheets values.
- Add tests for formula-prefix payloads across registration and score submission.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Static frontend JSONP transport | Public request construction | Reported | The shipped HTML embeds a public Apps Script endpoint and sends query-string JSONP requests. Evidence: artifacts/05_findings/CANON-001/validation_report.md |
| Apps Script score submission | Leaderboard integrity and spreadsheet cell integrity | Reported | The public submit action accepts client-supplied score data and user-controlled text. Evidence: artifacts/05_findings/CANON-001/validation_report.md, artifacts/05_findings/CANON-002/validation_report.md |
| Apps Script player registration | Player registry integrity, formula injection, and resource abuse | Reported | Public registration writes username/team and jersey registry rows without caller controls. Evidence: artifacts/05_findings/CANON-003/validation_report.md, artifacts/05_findings/CANON-005/validation_report.md |
| Apps Script progress lookup | Information disclosure | Rejected | The path is real, but exposes only display-game progress/split data in a public demo leaderboard context with no private account boundary evidenced. Evidence: artifacts/05_findings/CANON-004/validation_report.md, artifacts/05_findings/CANON-004/attack_path_analysis_report.md |
| GitLab Pages CI publication | Static artifact publication | No issue found | The reviewed CI path publishes static files and did not expose secrets or privileged deployment mutation paths. Evidence: artifacts/03_coverage/reviewed_surfaces.md |

## Open Questions And Follow Up

- The live Apps Script deployment settings were not modified or dynamically probed.
  - Follow-up prompt: Create a disposable Apps Script deployment and spreadsheet copy from google-apps-script/Code.gs, then run bounded dynamic tests for score forgery, formula literalization, and endpoint rate limits.

const SPREADSHEET_ID = '15GvRYiKc69VeaEoU7PapFe26nqtpj7yyr9Gahjqo05A';
const INDIVIDUAL_SHEET_NAME = 'Individual Scores';
const COUNTRY_SHEET_NAME = 'Country Scores';
const PLAYERS_SHEET_NAME = 'Players';

const INDIVIDUAL_HEADERS = [
  'serverTimestamp',
  'playerName',
  'country',
  'date',
  'puzzle1Time',
  'puzzle2Time',
  'puzzle3Time',
  'totalMatchTime'
];

const COUNTRY_HEADERS = [
  'date',
  'country',
  'plays',
  'fastestGoal',
  'averageMatchTime',
  'lastPlayed'
];

const PLAYERS_HEADERS = [
  'serverTimestamp',
  'username',
  'team',
  'jerseyNumber',
  'lastSeen'
];

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
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return respond_({ ok: false, error: message }, params.callback);
  }
}

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
  }

  return { ok: true };
}

function enforceDailyMatchLimit_(playerName, date) {
  const usernameKey = normalizeKey_(playerName);
  const todaysScores = readIndividualScores_()
    .filter(score => normalizeKey_(score.username) === usernameKey && score.challengeDate === date);

  if (todaysScores.length) {
    throw new Error('This match already has a submitted score');
  }
}

function registerPlayer_(params) {
  const username = cleanText_(params.username, 18) || 'Player';
  const team = cleanText_(params.team, 40);
  if (!team) throw new Error('Team is required');

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

  return {
    username,
    team,
    jerseyNumber: nextNumber
  };
}

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
}

function getPlayerProgress_(params) {
  const username = cleanText_(params.username, 18) || 'Player';
  const challengeDate = cleanDate_(params.challengeDate);
  if (!challengeDate) throw new Error('Challenge date is required');

  const usernameKey = normalizeKey_(username);
  const scores = readIndividualScores_()
    .filter(score => normalizeKey_(score.username) === usernameKey && score.challengeDate === challengeDate);
  const completedPuzzleIds = scores.length ? [1, 2, 3].map(n => `${challengeDate}-${String(n).padStart(2, '0')}`) : [];
  const puzzleTimes = scores.length ? scores[0].puzzleTimes : [];

  return {
    ok: true,
    challengeDate,
    completedCount: completedPuzzleIds.length,
    completedPuzzleIds,
    puzzleTimes
  };
}

function buildCountryRows_(scores, sortMode, limit) {
  const byTeam = {};

  scores.forEach(score => {
    if (!byTeam[score.team]) {
      byTeam[score.team] = {
        team: score.team,
        challengeDate: score.challengeDate,
        plays: 0,
        totalTime: 0,
        fastestGoal: Number.POSITIVE_INFINITY,
        lastPlayed: ''
      };
    }
    const team = byTeam[score.team];
    if (team.challengeDate !== score.challengeDate) team.challengeDate = '';
    team.plays += 1;
    team.totalTime += score.totalMatchTimeSeconds;
    score.puzzleTimes.forEach(time => {
      if (Number.isFinite(time)) team.fastestGoal = Math.min(team.fastestGoal, time);
    });
    if (!team.lastPlayed || score.serverTimestamp > team.lastPlayed) team.lastPlayed = score.serverTimestamp;
  });

  return Object.values(byTeam)
    .map(team => ({
      challengeDate: team.challengeDate,
      team: team.team,
      plays: team.plays,
      fastestGoal: formatTime_(team.fastestGoal),
      bestTime: formatTime_(team.fastestGoal),
      averageTime: formatTime_(Math.round(team.totalTime / team.plays)),
      averageMatchTime: formatTime_(Math.round(team.totalTime / team.plays)),
      fastestGoalSeconds: team.fastestGoal,
      averageTimeSeconds: Math.round(team.totalTime / team.plays),
      lastPlayed: team.lastPlayed
    }))
    .sort((a, b) => {
      if (sortMode === 'average') {
        return a.averageTimeSeconds - b.averageTimeSeconds || a.fastestGoalSeconds - b.fastestGoalSeconds || b.plays - a.plays || a.team.localeCompare(b.team);
      }
      return a.fastestGoalSeconds - b.fastestGoalSeconds || b.plays - a.plays || a.team.localeCompare(b.team);
    })
    .slice(0, limit)
    .map(row => ({
      challengeDate: row.challengeDate,
      team: row.team,
      plays: row.plays,
      fastestGoal: row.fastestGoal,
      bestTime: row.bestTime,
      averageTime: row.averageTime,
      averageMatchTime: row.averageMatchTime,
      lastPlayed: row.lastPlayed
    }));
}

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
  if (values.length <= 1) return [];

  return values.slice(1)
    .map((row, i) => {
      const displayRow = displayValues[i + 1];
      const puzzle1Time = parseTime_(displayRow[4] && displayRow[4].indexOf(':') >= 0 ? displayRow[4] : row[4]);
      const puzzle2Time = parseTime_(displayRow[5] && displayRow[5].indexOf(':') >= 0 ? displayRow[5] : row[5]);
      const puzzle3Time = parseTime_(displayRow[6] && displayRow[6].indexOf(':') >= 0 ? displayRow[6] : row[6]);
      const displayedTotal = displayRow[7] && displayRow[7].indexOf(':') >= 0 ? displayRow[7] : row[7];
      const parsedTotal = parseTime_(displayedTotal);
      const totalMatchTimeSeconds = Number.isFinite(parsedTotal) ? parsedTotal : puzzle1Time + puzzle2Time + puzzle3Time;
      return {
        serverTimestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
        username: String(row[1] || 'Player'),
        team: String(row[2] || ''),
        challengeDate: cleanDate_(row[3]),
        puzzleTimes: [puzzle1Time, puzzle2Time, puzzle3Time],
        puzzle1Time: formatTime_(puzzle1Time),
        puzzle2Time: formatTime_(puzzle2Time),
        puzzle3Time: formatTime_(puzzle3Time),
        totalMatchTimeSeconds,
        totalMatchTime: formatTime_(totalMatchTimeSeconds)
      };
    })
    .filter(score => score.team && score.challengeDate && score.puzzleTimes.every(time => Number.isFinite(time)) && Number.isFinite(score.totalMatchTimeSeconds));
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some((header, i) => firstRow[i] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  clearTrailingColumns_(sheet, headers.length);
  applySheetFormats_(sheet, name);
  return sheet;
}

function getIndividualSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(INDIVIDUAL_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(INDIVIDUAL_SHEET_NAME);

  const lastColumn = Math.max(sheet.getLastColumn(), INDIVIDUAL_HEADERS.length);
  const firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  migrateIndividualSheet_(sheet, firstRow);

  const currentHeaders = sheet.getRange(1, 1, 1, INDIVIDUAL_HEADERS.length).getValues()[0];
  const needsHeaders = INDIVIDUAL_HEADERS.some((header, i) => currentHeaders[i] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, INDIVIDUAL_HEADERS.length).setValues([INDIVIDUAL_HEADERS]);
    sheet.setFrozenRows(1);
  }
  clearTrailingColumns_(sheet, INDIVIDUAL_HEADERS.length);
  applySheetFormats_(sheet, INDIVIDUAL_SHEET_NAME);
  return sheet;
}

function getPlayersSheet_() {
  return getSheet_(PLAYERS_SHEET_NAME, PLAYERS_HEADERS);
}

function migrateIndividualSheet_(sheet, headers) {
  const hasOldColumns = headers[3] === 'time' && headers[4] === 'timeFormatted';
  if (!hasOldColumns || sheet.getLastRow() <= 1) return;

  const rowCount = sheet.getLastRow() - 1;
  const columnCount = Math.max(sheet.getLastColumn(), INDIVIDUAL_HEADERS.length);
  const rows = sheet.getRange(2, 1, rowCount, columnCount).getValues();
  const displayRows = sheet.getRange(2, 1, rowCount, columnCount).getDisplayValues();
  const migratedRows = rows.map((row, i) => {
    const displayedTime = displayRows[i][4] || displayRows[i][3];
    const parsedTime = parseTime_(displayedTime && displayedTime.indexOf(':') >= 0 ? displayedTime : (row[4] || row[3]));
    return [
      row[0],
      row[1],
      row[2],
      '',
      '',
      '',
      '',
      Number.isFinite(parsedTime) ? formatTime_(parsedTime) : ''
    ];
  });
  sheet.getRange(2, 1, migratedRows.length, INDIVIDUAL_HEADERS.length).setValues(migratedRows);
}

function clearTrailingColumns_(sheet, expectedColumnCount) {
  const extraColumnCount = sheet.getLastColumn() - expectedColumnCount;
  if (extraColumnCount <= 0) return;

  const rowCount = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(1, expectedColumnCount + 1, rowCount, extraColumnCount).clearContent();
}

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
}

function respond_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    const safeCallback = String(callback).match(/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/) ? callback : 'callback';
    return ContentService
      .createTextOutput(`${safeCallback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function cleanDate_(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>{}[\]\\]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeKey_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

function parseJerseyNumber_(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : NaN;
}

function formatJerseyNumber_(number) {
  return String(Math.max(1, Math.floor(Number(number) || 1))).padStart(2, '0');
}

function formatTime_(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function parseTime_(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60 * 60);
    return value;
  }
  if (value instanceof Date) return value.getHours() * 60 * 60 + value.getMinutes() * 60 + value.getSeconds();

  const text = String(value || '').trim();
  if (!text) return NaN;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;

  const parts = text.split(':').map(part => Number(part));
  if (parts.length !== 2 || parts.some(part => !Number.isFinite(part))) return NaN;
  return parts[0] * 60 + parts[1];
}

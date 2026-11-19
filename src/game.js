// The Avalon rules engine: game setup and a pure reducer, reduce(state, action) -> new state.
// The host device owns the full state. Other devices only ever see viewFor(state, playerId).

import {
  MIN_PLAYERS, MAX_PLAYERS, QUESTS_TO_WIN, MAX_REJECTIONS,
  GOOD, EVIL, EVIL_COUNT, QUEST_SIZES, ROLES, SPECIAL_ROLES, DEFAULT_OPTIONS,
  LADY_AFTER_QUESTS, sideOf, goodCount, failsRequired,
} from './rules.js';

export const PHASES = Object.freeze({
  TEAM_BUILD: 'TEAM_BUILD',
  TEAM_VOTE: 'TEAM_VOTE',
  QUEST: 'QUEST',
  LADY: 'LADY',
  ASSASSINATION: 'ASSASSINATION',
  GAME_OVER: 'GAME_OVER',
});

export const ACTIONS = Object.freeze({
  PROPOSE_TEAM: 'PROPOSE_TEAM',
  VOTE: 'VOTE',
  PLAY_QUEST_CARD: 'PLAY_QUEST_CARD',
  LADY_EXAMINE: 'LADY_EXAMINE',
  ASSASSINATE: 'ASSASSINATE',
});

export const WIN_REASONS = Object.freeze({
  THREE_SUCCESSES: 'three-successes',
  MERLIN_SURVIVED: 'merlin-survived',
  THREE_FAILS: 'three-fails',
  FIVE_REJECTIONS: 'five-rejections',
  MERLIN_ASSASSINATED: 'merlin-assassinated',
});

/** Thrown for any illegal setup or action. `code` is stable for UI and tests. */
export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new RuleError(code, message); };

/** Uniform random float in [0, 1), from crypto when available. */
export function cryptoRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export function shuffle(items, rng = cryptoRandom) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Checks player count and character choices. Returns the normalised options. */
export function validateSetup(playerCount, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const roles = [...new Set(opts.roles)];

  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    fail('bad-player-count', `Avalon needs ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${playerCount}.`);
  }
  for (const r of roles) {
    if (!SPECIAL_ROLES.includes(r)) fail('unknown-role', `Unknown character: ${r}.`);
  }
  const has = (r) => roles.includes(r);
  if (has('merlin') !== has('assassin')) {
    fail('merlin-needs-assassin', 'Merlin and the Assassin must be used together.');
  }
  if (has('percival') && !has('merlin')) fail('percival-needs-merlin', 'Percival needs Merlin in the game.');
  if (has('morgana') && !has('percival')) fail('morgana-needs-percival', 'Morgana needs Percival in the game.');

  const evilSpecials = roles.filter((r) => sideOf(r) === EVIL).length;
  const goodSpecials = roles.filter((r) => sideOf(r) === GOOD).length;
  if (evilSpecials > EVIL_COUNT[playerCount]) {
    fail('too-many-evil-roles', `${playerCount} players have only ${EVIL_COUNT[playerCount]} evil seats.`);
  }
  if (goodSpecials > goodCount(playerCount)) {
    fail('too-many-good-roles', `${playerCount} players have only ${goodCount(playerCount)} good seats.`);
  }
  return { roles, ladyOfTheLake: Boolean(opts.ladyOfTheLake) };
}

/** The full list of roles dealt for a game, specials first, padded with servants and minions. */
export function roleDeck(playerCount, roles) {
  const deck = [...roles];
  const evil = roles.filter((r) => sideOf(r) === EVIL).length;
  const good = roles.length - evil;
  for (let i = evil; i < EVIL_COUNT[playerCount]; i++) deck.push('minion');
  for (let i = good; i < goodCount(playerCount); i++) deck.push('servant');
  return deck;
}

/**
 * Starts a game. `players` is [{ id, name }] in seating order; the leader passes
 * to the next seat in this order. Roles and the first leader are chosen with `rng`.
 */
export function createGame(players, options = {}, rng = cryptoRandom) {
  const ids = players.map((p) => p.id);
  if (new Set(ids).size !== ids.length) fail('duplicate-player', 'Player ids must be unique.');
  const opts = validateSetup(players.length, options);

  const deck = shuffle(roleDeck(players.length, opts.roles), rng);
  const roles = Object.fromEntries(ids.map((id, i) => [id, deck[i]]));
  const leader = Math.floor(rng() * players.length);
  const n = players.length;

  return {
    phase: PHASES.TEAM_BUILD,
    players: players.map(({ id, name }) => ({ id, name })),
    options: opts,
    roles,
    quest: 0,
    leader,
    rejections: 0,
    team: [],
    votes: {},
    questCards: {},
    questResults: [],
    history: [],
    // The Lady starts with the player to the right of the first leader, i.e. the previous seat.
    lady: opts.ladyOfTheLake
      ? { holder: ids[(leader - 1 + n) % n], pastHolders: [], findings: [] }
      : null,
    assassinTarget: null,
    winner: null,
    winReason: null,
  };
}

// ---- helpers over state ----

export const playerIds = (state) => state.players.map((p) => p.id);
export const leaderId = (state) => state.players[state.leader].id;
export const teamSize = (state) => QUEST_SIZES[state.players.length][state.quest];
export const findRole = (state, role) => playerIds(state).find((id) => state.roles[id] === role) ?? null;
export const successCount = (state) => state.questResults.filter((q) => q.success).length;
export const failCount = (state) => state.questResults.filter((q) => !q.success).length;

/** Players whose input the game is waiting on in the current phase. */
export function awaiting(state) {
  switch (state.phase) {
    case PHASES.TEAM_BUILD: return [leaderId(state)];
    case PHASES.TEAM_VOTE: return playerIds(state).filter((id) => !(id in state.votes));
    case PHASES.QUEST: return state.team.filter((id) => !(id in state.questCards));
    case PHASES.LADY: return [state.lady.holder];
    case PHASES.ASSASSINATION: return [findRole(state, 'assassin')];
    default: return [];
  }
}

/** Players the current Lady of the Lake holder may examine. */
export function ladyTargets(state) {
  if (!state.lady) return [];
  const used = new Set([state.lady.holder, ...state.lady.pastHolders]);
  return playerIds(state).filter((id) => !used.has(id));
}

// ---- reducer ----

const nextLeader = (state) => (state.leader + 1) % state.players.length;

function endGame(s, winner, winReason) {
  s.phase = PHASES.GAME_OVER;
  s.winner = winner;
  s.winReason = winReason;
  return s;
}

function startNextRound(s) {
  s.quest += 1;
  s.leader = nextLeader(s);
  s.phase = PHASES.TEAM_BUILD;
  return s;
}

function requirePlayer(state, id) {
  if (!state.players.some((p) => p.id === id)) fail('unknown-player', `No player with id ${id}.`);
}

function proposeTeam(s, { playerId, team }) {
  if (playerId !== leaderId(s)) fail('not-leader', 'Only the leader picks the team.');
  if (!Array.isArray(team)) fail('bad-team', 'Team must be a list of player ids.');
  const unique = [...new Set(team)];
  unique.forEach((id) => requirePlayer(s, id));
  if (unique.length !== team.length) fail('bad-team', 'A player can only be on the team once.');
  if (team.length !== teamSize(s)) {
    fail('bad-team-size', `Quest ${s.quest + 1} needs a team of ${teamSize(s)}.`);
  }
  s.team = [...team];
  s.votes = {};
  s.phase = PHASES.TEAM_VOTE;
  return s;
}

function vote(s, { playerId, approve }) {
  if (playerId in s.votes) fail('already-voted', 'You already voted on this team.');
  if (typeof approve !== 'boolean') fail('bad-vote', 'A vote is approve or reject.');
  s.votes[playerId] = approve;
  if (Object.keys(s.votes).length < s.players.length) return s;

  // Everyone has voted: reveal. A tie rejects.
  const approvals = Object.values(s.votes).filter(Boolean).length;
  const approved = approvals > s.players.length / 2;
  s.history.push({
    quest: s.quest,
    leader: leaderId(s),
    team: s.team,
    votes: { ...s.votes },
    approved,
  });

  if (approved) {
    s.rejections = 0;
    s.questCards = {};
    s.phase = PHASES.QUEST;
    return s;
  }
  s.rejections += 1;
  s.team = [];
  s.votes = {};
  if (s.rejections >= MAX_REJECTIONS) return endGame(s, EVIL, WIN_REASONS.FIVE_REJECTIONS);
  s.leader = nextLeader(s);
  s.phase = PHASES.TEAM_BUILD;
  return s;
}

function playQuestCard(s, { playerId, success }) {
  if (!s.team.includes(playerId)) fail('not-on-team', 'Only team members play quest cards.');
  if (playerId in s.questCards) fail('already-played', 'You already played a quest card.');
  if (typeof success !== 'boolean') fail('bad-card', 'A quest card is success or fail.');
  if (!success && sideOf(s.roles[playerId]) === GOOD) {
    fail('good-must-succeed', 'Loyal servants of Arthur must play Success.');
  }
  s.questCards[playerId] = success;
  if (Object.keys(s.questCards).length < s.team.length) return s;

  // All cards in. Only the number of fails is kept, so who failed is never stored.
  const fails = Object.values(s.questCards).filter((c) => !c).length;
  const success_ = fails < failsRequired(s.players.length, s.quest);
  s.questResults.push({ quest: s.quest, team: s.team, fails, success: success_ });
  s.history[s.history.length - 1].fails = fails;
  s.questCards = {};
  s.team = [];
  s.votes = {};

  if (failCount(s) >= QUESTS_TO_WIN) return endGame(s, EVIL, WIN_REASONS.THREE_FAILS);
  if (successCount(s) >= QUESTS_TO_WIN) {
    if (findRole(s, 'assassin')) {
      s.phase = PHASES.ASSASSINATION;
      return s;
    }
    return endGame(s, GOOD, WIN_REASONS.THREE_SUCCESSES);
  }
  if (s.lady && LADY_AFTER_QUESTS.includes(s.quest)) {
    s.phase = PHASES.LADY;
    return s;
  }
  return startNextRound(s);
}

function ladyExamine(s, { playerId, targetId }) {
  if (playerId !== s.lady.holder) fail('not-lady-holder', 'Only the Lady of the Lake holder examines.');
  requirePlayer(s, targetId);
  if (!ladyTargets(s).includes(targetId)) {
    fail('bad-lady-target', 'You cannot examine yourself or a past holder of the Lady.');
  }
  s.lady.findings.push({
    quest: s.quest,
    holder: playerId,
    target: targetId,
    side: sideOf(s.roles[targetId]),
  });
  s.lady.pastHolders.push(playerId);
  s.lady.holder = targetId;
  return startNextRound(s);
}

function assassinate(s, { playerId, targetId }) {
  if (s.roles[playerId] !== 'assassin') fail('not-assassin', 'Only the Assassin names Merlin.');
  requirePlayer(s, targetId);
  if (targetId === playerId) fail('bad-assassin-target', 'The Assassin cannot name themselves.');
  s.assassinTarget = targetId;
  return s.roles[targetId] === 'merlin'
    ? endGame(s, EVIL, WIN_REASONS.MERLIN_ASSASSINATED)
    : endGame(s, GOOD, WIN_REASONS.MERLIN_SURVIVED);
}

const HANDLERS = {
  [ACTIONS.PROPOSE_TEAM]: [PHASES.TEAM_BUILD, proposeTeam],
  [ACTIONS.VOTE]: [PHASES.TEAM_VOTE, vote],
  [ACTIONS.PLAY_QUEST_CARD]: [PHASES.QUEST, playQuestCard],
  [ACTIONS.LADY_EXAMINE]: [PHASES.LADY, ladyExamine],
  [ACTIONS.ASSASSINATE]: [PHASES.ASSASSINATION, assassinate],
};

/**
 * Applies one player action and returns a new state; the input state is never modified.
 * Throws RuleError for anything the rules do not allow.
 */
export function reduce(state, action) {
  const entry = HANDLERS[action?.type];
  if (!entry) fail('unknown-action', `Unknown action: ${action?.type}.`);
  const [phase, handler] = entry;
  if (state.phase !== phase) fail('wrong-phase', `${action.type} is not allowed during ${state.phase}.`);
  requirePlayer(state, action.playerId);
  return handler(structuredClone(state), action);
}

export { ROLES };

import { createGame, reduce, leaderId, ACTIONS } from '../src/index.js';

/** Deterministic PRNG for repeatable tests. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const makePlayers = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));

/**
 * A game with roles fixed by seat (roles[i] goes to p{i}) and the first leader at seat 0.
 * Options are still validated by createGame.
 */
export function rigged(roles, options = {}) {
  const players = makePlayers(roles.length);
  const g = createGame(players, options, seeded(1));
  g.roles = Object.fromEntries(players.map((p, i) => [p.id, roles[i]]));
  g.leader = 0;
  if (g.lady) g.lady.holder = players[roles.length - 1].id;
  return g;
}

export const ids = (state) => state.players.map((p) => p.id);

export function propose(state, team) {
  return reduce(state, { type: ACTIONS.PROPOSE_TEAM, playerId: leaderId(state), team });
}

/** Everyone votes; `approve` is a boolean for all, or a function of player id. */
export function voteAll(state, approve) {
  let s = state;
  for (const id of ids(state)) {
    const a = typeof approve === 'function' ? approve(id) : approve;
    s = reduce(s, { type: ACTIONS.VOTE, playerId: id, approve: a });
  }
  return s;
}

/** Team members play cards; ids listed in `failers` play Fail. */
export function quest(state, failers = []) {
  let s = state;
  for (const id of state.team) {
    s = reduce(s, { type: ACTIONS.PLAY_QUEST_CARD, playerId: id, success: !failers.includes(id) });
  }
  return s;
}

/** Proposes, approves and plays a whole quest round. */
export function round(state, team, failers = []) {
  return quest(voteAll(propose(state, team), true), failers);
}

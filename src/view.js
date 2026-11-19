// What one player is allowed to see. The host sends each device only viewFor(state, itsPlayerId).

import { EVIL, GOOD, ROLES, QUEST_SIZES, sideOf, failsRequired } from './rules.js';
import { PHASES, awaiting, leaderId, ladyTargets, playerIds } from './game.js';

/**
 * Who a role sees during the night phase, as [{ id, as }], where `as` is
 * 'evil' (a fellow or spotted evil player), 'merlin' or 'merlin-or-morgana'.
 */
export function nightKnowledge(state, playerId) {
  const role = state.roles[playerId];
  const others = playerIds(state).filter((id) => id !== playerId);
  const roleOf = (id) => state.roles[id];

  if (role === 'merlin') {
    return others
      .filter((id) => sideOf(roleOf(id)) === EVIL && roleOf(id) !== 'mordred')
      .map((id) => ({ id, as: 'evil' }));
  }
  if (role === 'percival') {
    const seen = others.filter((id) => roleOf(id) === 'merlin' || roleOf(id) === 'morgana');
    const as = seen.length > 1 ? 'merlin-or-morgana' : 'merlin';
    return seen.map((id) => ({ id, as }));
  }
  if (sideOf(role) === EVIL && role !== 'oberon') {
    return others
      .filter((id) => sideOf(roleOf(id)) === EVIL && roleOf(id) !== 'oberon')
      .map((id) => ({ id, as: 'evil' }));
  }
  return [];
}

/** The state as seen by one player: everything public plus their own secrets. */
export function viewFor(state, playerId) {
  const role = state.roles[playerId];
  if (!role) throw new Error(`No player with id ${playerId}.`);
  const over = state.phase === PHASES.GAME_OVER;
  const n = state.players.length;

  const view = {
    phase: state.phase,
    players: state.players,
    options: state.options,
    questSizes: QUEST_SIZES[n],
    failsRequired: QUEST_SIZES[n].map((_, q) => failsRequired(n, q)),
    quest: state.quest,
    leader: leaderId(state),
    rejections: state.rejections,
    team: state.team,
    // During a vote everyone sees who has voted, but not how until all votes are in.
    voted: Object.keys(state.votes),
    played: Object.keys(state.questCards),
    questResults: state.questResults,
    history: state.history,
    awaiting: awaiting(state),
    lady: state.lady && {
      holder: state.lady.holder,
      pastHolders: state.lady.pastHolders,
      targets: ladyTargets(state),
      // Everyone knows who examined whom; only the holder learned the answer.
      examinations: state.lady.findings.map(({ quest, holder, target }) => ({ quest, holder, target })),
    },
    winner: state.winner,
    winReason: state.winReason,
    assassinTarget: state.assassinTarget,

    me: {
      id: playerId,
      role,
      roleName: ROLES[role].name,
      side: sideOf(role),
      knows: nightKnowledge(state, playerId),
      myVote: state.votes[playerId] ?? null,
      myQuestCard: state.questCards[playerId] ?? null,
      canFail: sideOf(role) === EVIL,
      ladyFindings: state.lady
        ? state.lady.findings.filter((f) => f.holder === playerId)
          .map(({ quest, target, side }) => ({ quest, target, side }))
        : [],
    },
    // Roles are revealed to everyone when the game ends.
    roles: over ? state.roles : null,
  };
  return view;
}

export { GOOD, EVIL };

// Plays thousands of random legal games for every player count and checks invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reduce, viewFor, awaiting, teamSize, ladyTargets, sideOf, shuffle,
  ACTIONS, PHASES, MAX_REJECTIONS,
} from '../src/index.js';
import { makePlayers, seeded } from './helpers.js';

const ROLE_SETS = [
  [],
  ['merlin', 'assassin'],
  ['merlin', 'assassin', 'percival', 'morgana'],
  ['merlin', 'assassin', 'percival', 'morgana', 'mordred'],
  ['merlin', 'assassin', 'percival', 'morgana', 'mordred', 'oberon'],
];

function randomAction(state, rng) {
  const actor = awaiting(state)[0];
  const ids = state.players.map((p) => p.id);
  switch (state.phase) {
    case PHASES.TEAM_BUILD:
      return { type: ACTIONS.PROPOSE_TEAM, playerId: actor, team: shuffle(ids, rng).slice(0, teamSize(state)) };
    case PHASES.TEAM_VOTE:
      return { type: ACTIONS.VOTE, playerId: actor, approve: rng() < 0.6 };
    case PHASES.QUEST:
      return {
        type: ACTIONS.PLAY_QUEST_CARD,
        playerId: actor,
        success: sideOf(state.roles[actor]) === 'good' || rng() < 0.5,
      };
    case PHASES.LADY: {
      const t = ladyTargets(state);
      return { type: ACTIONS.LADY_EXAMINE, playerId: actor, targetId: t[Math.floor(rng() * t.length)] };
    }
    case PHASES.ASSASSINATION: {
      const t = ids.filter((id) => id !== actor);
      return { type: ACTIONS.ASSASSINATE, playerId: actor, targetId: t[Math.floor(rng() * t.length)] };
    }
    default: throw new Error(`no action in ${state.phase}`);
  }
}

test('random games always finish legally with a consistent winner', () => {
  let games = 0;
  const outcomes = new Set();
  for (let n = 5; n <= 10; n++) {
    for (const roles of ROLE_SETS) {
      const evilSpecials = roles.filter((r) => sideOf(r) === 'evil').length;
      if (evilSpecials > { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 }[n]) continue;
      for (let seed = 0; seed < 60; seed++) {
        const rng = seeded(seed * 1000 + n);
        let s = createGame(makePlayers(n), { roles, ladyOfTheLake: seed % 2 === 0 }, rng);
        let steps = 0;
        while (s.phase !== PHASES.GAME_OVER) {
          assert.ok(s.rejections < MAX_REJECTIONS);
          assert.ok(awaiting(s).length > 0, `stuck in ${s.phase}`);
          s = reduce(s, randomAction(s, rng));
          assert.ok(++steps < 500, 'game did not end');
        }
        const succ = s.questResults.filter((q) => q.success).length;
        const fails = s.questResults.length - succ;
        assert.ok(succ <= 3 && fails <= 3);
        assert.ok(['good', 'evil'].includes(s.winner));
        if (s.winner === 'good') assert.equal(succ, 3);
        if (s.winReason === 'three-fails') assert.equal(fails, 3);
        // Every player's final view is well-formed and reveals roles.
        for (const p of s.players) assert.deepEqual(viewFor(s, p.id).roles, s.roles);
        outcomes.add(s.winReason);
        games++;
      }
    }
  }
  assert.ok(games > 1000);
  // Random play should reach every way a game can end.
  const expected = ['three-fails', 'five-rejections', 'merlin-assassinated', 'merlin-survived', 'three-successes'];
  for (const r of expected) assert.ok(outcomes.has(r), `never saw ${r}`);
});

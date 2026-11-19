import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIL_COUNT, QUEST_SIZES, failsRequired, validateSetup, roleDeck, createGame, sideOf,
  RuleError, EVIL, GOOD,
} from '../src/index.js';
import { makePlayers, seeded } from './helpers.js';

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof RuleError && e.code === code);

test('good/evil split matches the rulebook', () => {
  assert.deepEqual(EVIL_COUNT, { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 });
});

test('quest team sizes match the rulebook', () => {
  assert.deepEqual(QUEST_SIZES[5], [2, 3, 2, 3, 3]);
  assert.deepEqual(QUEST_SIZES[6], [2, 3, 4, 3, 4]);
  assert.deepEqual(QUEST_SIZES[7], [2, 3, 3, 4, 4]);
  for (const n of [8, 9, 10]) assert.deepEqual(QUEST_SIZES[n], [3, 4, 4, 5, 5]);
});

test('the 4th quest needs two fails only with 7 or more players', () => {
  for (let n = 5; n <= 10; n++) {
    for (let q = 0; q < 5; q++) {
      assert.equal(failsRequired(n, q), q === 3 && n >= 7 ? 2 : 1, `n=${n} q=${q}`);
    }
  }
});

test('player count must be 5 to 10', () => {
  throwsCode(() => validateSetup(4), 'bad-player-count');
  throwsCode(() => validateSetup(11), 'bad-player-count');
  for (let n = 5; n <= 10; n++) assert.ok(validateSetup(n));
});

test('character dependencies are enforced', () => {
  throwsCode(() => validateSetup(5, { roles: ['merlin'] }), 'merlin-needs-assassin');
  throwsCode(() => validateSetup(5, { roles: ['assassin'] }), 'merlin-needs-assassin');
  throwsCode(() => validateSetup(5, { roles: ['merlin', 'assassin', 'morgana'] }), 'morgana-needs-percival');
  throwsCode(() => validateSetup(5, { roles: ['percival'] }), 'percival-needs-merlin');
  throwsCode(() => validateSetup(5, { roles: ['wizard'] }), 'unknown-role');
  assert.ok(validateSetup(5, { roles: [] }), 'a plain game with no characters is allowed');
});

test('too many evil characters for the player count is rejected', () => {
  const roles = ['merlin', 'assassin', 'percival', 'morgana', 'mordred'];
  throwsCode(() => validateSetup(6, { roles }), 'too-many-evil-roles');
  assert.ok(validateSetup(7, { roles }));
  throwsCode(() => validateSetup(9, { roles: [...roles, 'oberon'] }), 'too-many-evil-roles');
  assert.ok(validateSetup(10, { roles: [...roles, 'oberon'] }));
});

test('the role deck has the right number of each side for every count', () => {
  for (let n = 5; n <= 10; n++) {
    for (const roles of [[], ['merlin', 'assassin'], ['merlin', 'assassin', 'percival', 'morgana']]) {
      const deck = roleDeck(n, roles);
      assert.equal(deck.length, n);
      assert.equal(deck.filter((r) => sideOf(r) === EVIL).length, EVIL_COUNT[n]);
      assert.equal(deck.filter((r) => sideOf(r) === GOOD).length, n - EVIL_COUNT[n]);
      for (const r of roles) assert.ok(deck.includes(r));
    }
  }
});

test('createGame deals every role once and picks a valid first leader', () => {
  const players = makePlayers(8);
  const g = createGame(players, { roles: ['merlin', 'assassin', 'percival', 'morgana'] }, seeded(42));
  assert.deepEqual(
    Object.values(g.roles).sort(),
    roleDeck(8, ['merlin', 'assassin', 'percival', 'morgana']).sort(),
  );
  assert.ok(g.leader >= 0 && g.leader < 8);
  assert.equal(g.phase, 'TEAM_BUILD');
});

test('createGame is random across seeds but repeatable for one seed', () => {
  const players = makePlayers(7);
  const a = createGame(players, {}, seeded(7));
  const b = createGame(players, {}, seeded(7));
  assert.deepEqual(a, b);
  const deals = new Set();
  for (let s = 0; s < 30; s++) deals.add(JSON.stringify(createGame(players, {}, seeded(s)).roles));
  assert.ok(deals.size > 20);
});

test('duplicate player ids are rejected', () => {
  const players = makePlayers(5);
  players[1].id = 'p0';
  throwsCode(() => createGame(players), 'duplicate-player');
});

test('the default random source works without a seed', () => {
  const g = createGame(makePlayers(5));
  assert.equal(Object.keys(g.roles).length, 5);
});

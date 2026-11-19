import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changes } from '../src/ui/events.js';
import { viewFor, reduce, ACTIONS } from '../src/index.js';
import { rigged, propose, voteAll, quest } from './helpers.js';

// p0 Merlin, p1 servant, p2 servant, p3 Assassin, p4 minion; p0 leads first.
const FIVE = ['merlin', 'servant', 'servant', 'assassin', 'minion'];
const names = (c) => c.sounds.map((s) => s.name);

test('a new game starts with a bell, and the first leader hears their turn', () => {
  const g = rigged(FIVE);
  assert.deepEqual(names(changes(null, viewFor(g, 'p1'), 'p1')), ['start']);
  assert.deepEqual(names(changes(null, viewFor(g, 'p0'), 'p0')), ['start', 'turn']);
});

test('rejoining a game in progress is silent', () => {
  const s = voteAll(propose(rigged(FIVE), ['p0', 'p1']), false);
  assert.deepEqual(names(changes(null, viewFor(s, 'p2'), 'p2')), []);
});

test('a vote opening is everyone\'s turn; casting it is not announced again', () => {
  const g = rigged(FIVE);
  const s = propose(g, ['p0', 'p1']);
  assert.deepEqual(names(changes(viewFor(g, 'p2'), viewFor(s, 'p2'), 'p2')), ['turn']);
  const voted = reduce(s, { type: ACTIONS.VOTE, playerId: 'p3', approve: true });
  assert.deepEqual(names(changes(viewFor(s, 'p2'), viewFor(voted, 'p2'), 'p2')), []);
});

test('revealed votes and quest results are marked fresh, with sounds', () => {
  const g = propose(rigged(FIVE), ['p0', 'p3']);
  const rejected = voteAll(g, false);
  const c = changes(viewFor(g, 'p2'), viewFor(rejected, 'p2'), 'p2');
  assert.deepEqual(names(c), ['rejected']);
  assert.deepEqual(c.fresh, { vote: 0 });

  const approved = voteAll(propose(rejected, ['p1', 'p3']), true);
  const done = quest(approved, ['p3']);
  const q = changes(viewFor(approved, 'p4'), viewFor(done, 'p4'), 'p4');
  assert.deepEqual(names(q), ['fail']);
  assert.deepEqual(q.fresh, { quest: 0 });
  // The next leader (p2) also hears their turn, after the result.
  const next = changes(viewFor(approved, 'p2'), viewFor(done, 'p2'), 'p2');
  assert.deepEqual(names(next), ['fail', 'turn']);
  assert.ok(next.sounds[1].delay > next.sounds[0].delay);
});

test('the end of the game plays win or lose for each side', () => {
  let s = rigged(FIVE);
  for (let i = 0; i < 4; i++) s = voteAll(propose(s, ['p0', 'p1']), false);
  const before = propose(s, ['p0', 'p1']);
  const after = voteAll(before, false);
  assert.deepEqual(names(changes(viewFor(before, 'p3'), viewFor(after, 'p3'), 'p3')), ['rejected', 'win']);
  assert.deepEqual(names(changes(viewFor(before, 'p1'), viewFor(after, 'p1'), 'p1')), ['rejected', 'lose']);
});

test('the Assassin\'s turn makes no sound', () => {
  let s = rigged(FIVE);
  const run = (st, team) => quest(voteAll(propose(st, team), true));
  s = run(s, ['p0', 'p1']);
  s = run(s, ['p0', 'p1', 'p2']);
  const before = voteAll(propose(s, ['p0', 'p1']), true);
  const after = quest(before);
  assert.equal(after.phase, 'ASSASSINATION');
  assert.deepEqual(names(changes(viewFor(before, 'p3'), viewFor(after, 'p3'), 'p3')), ['success']);
});

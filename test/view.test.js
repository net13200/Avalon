import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFor, nightKnowledge, reduce, ACTIONS, PHASES, RuleError } from '../src/index.js';
import { rigged, propose, voteAll, round } from './helpers.js';

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof RuleError && e.code === code);

const sees = (state, id) =>
  Object.fromEntries(nightKnowledge(state, id).map((k) => [k.id, k.as]));

// p0 Merlin, p1 Percival, p2 servant, p3 servant, p4 Assassin, p5 Morgana, p6 Mordred, p7 servant, p8 servant, p9 Oberon
const TEN = ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'mordred', 'servant', 'servant', 'oberon'];
const TEN_OPTS = { roles: ['merlin', 'assassin', 'percival', 'morgana', 'mordred', 'oberon'] };

test('Merlin sees every evil player except Mordred, including Oberon', () => {
  const g = rigged(TEN, TEN_OPTS);
  assert.deepEqual(sees(g, 'p0'), { p4: 'evil', p5: 'evil', p9: 'evil' });
});

test('Percival sees Merlin and Morgana without knowing which is which', () => {
  const g = rigged(TEN, TEN_OPTS);
  assert.deepEqual(sees(g, 'p1'), { p0: 'merlin-or-morgana', p5: 'merlin-or-morgana' });
});

test('Percival without Morgana sees Merlin for certain', () => {
  const g = rigged(['merlin', 'percival', 'servant', 'assassin', 'minion'],
    { roles: ['merlin', 'assassin', 'percival'] });
  assert.deepEqual(sees(g, 'p1'), { p0: 'merlin' });
});

test('evil players see each other except Oberon, and Oberon sees no one', () => {
  const g = rigged(TEN, TEN_OPTS);
  for (const id of ['p4', 'p5', 'p6']) {
    const expected = { p4: 'evil', p5: 'evil', p6: 'evil' };
    delete expected[id];
    assert.deepEqual(sees(g, id), expected, id);
  }
  assert.deepEqual(sees(g, 'p9'), {});
});

test('loyal servants see no one', () => {
  const g = rigged(TEN, TEN_OPTS);
  assert.deepEqual(sees(g, 'p2'), {});
});

test('a player view hides other roles and other votes until the reveal', () => {
  let s = propose(rigged(TEN, TEN_OPTS), ['p0', 'p1', 'p2']);
  s = reduce(s, { type: ACTIONS.VOTE, playerId: 'p4', approve: false });
  const v = viewFor(s, 'p2');
  assert.equal(v.me.role, 'servant');
  assert.equal(v.roles, null);
  assert.deepEqual(v.voted, ['p4']);
  assert.equal(v.me.myVote, null);
  // The character list in options is public; nothing else may name another player's role.
  const { options, me, ...rest } = v;
  assert.ok(!/"(assassin|merlin|morgana|mordred|oberon|percival|minion)"/.test(JSON.stringify(rest)));
  assert.equal(viewFor(s, 'p4').me.myVote, false);
});

test('quest cards stay hidden while the quest is in progress', () => {
  let s = voteAll(propose(rigged(TEN, TEN_OPTS), ['p4', 'p1', 'p2']), true);
  s = reduce(s, { type: ACTIONS.PLAY_QUEST_CARD, playerId: 'p4', success: false });
  const v = viewFor(s, 'p1');
  assert.deepEqual(v.played, ['p4']);
  assert.equal(v.me.myQuestCard, null);
  assert.equal(viewFor(s, 'p4').me.myQuestCard, false);
  assert.equal(viewFor(s, 'p4').me.canFail, true);
  assert.equal(v.me.canFail, false);
});

test('all roles are revealed when the game ends', () => {
  let s = rigged(TEN, TEN_OPTS);
  for (let i = 0; i < 5; i++) s = voteAll(propose(s, ['p0', 'p1', 'p2']), false);
  const v = viewFor(s, 'p2');
  assert.equal(v.phase, PHASES.GAME_OVER);
  assert.deepEqual(v.roles, s.roles);
});

test('the view lists quest sizes and the two-fail quest', () => {
  const v = viewFor(rigged(TEN, TEN_OPTS), 'p0');
  assert.deepEqual(v.questSizes, [3, 4, 4, 5, 5]);
  assert.deepEqual(v.failsRequired, [1, 1, 1, 2, 1]);
});

// ---- Lady of the Lake ----

// Seats: p0 Merlin, p1-p3 servants, p4 Assassin, p5-p6 minions. Lady starts with p6 (right of leader p0).
const SEVEN = ['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'];
const LADY = { ladyOfTheLake: true };

test('the Lady starts with the player to the right of the first leader', () => {
  const g = rigged(SEVEN, LADY);
  assert.equal(g.lady.holder, 'p6');
});

test('the Lady is used after quests 2, 3 and 4 only', () => {
  let s = rigged(SEVEN, LADY);
  s = round(s, ['p0', 'p1']);
  assert.equal(s.phase, PHASES.TEAM_BUILD, 'not after quest 1');
  s = round(s, ['p4', 'p1', 'p2'], ['p4']);
  assert.equal(s.phase, PHASES.LADY, 'after quest 2');
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p6', targetId: 'p0' });
  assert.equal(s.phase, PHASES.TEAM_BUILD);
  assert.equal(s.quest, 2);
  s = round(s, ['p0', 'p1', 'p2']);
  assert.equal(s.phase, PHASES.LADY, 'after quest 3');
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p0', targetId: 'p1' });
  s = round(s, ['p4', 'p5', 'p0', 'p1'], ['p4', 'p5']);
  assert.equal(s.phase, PHASES.LADY, 'after quest 4');
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p1', targetId: 'p2' });
  assert.equal(s.quest, 4);
  s = round(s, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(s.phase, PHASES.ASSASSINATION, 'never after the last quest');
});

test('the Lady cannot examine yourself or a past holder, and passes to the target', () => {
  let s = rigged(SEVEN, LADY);
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  throwsCode(() => reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p0', targetId: 'p1' }), 'not-lady-holder');
  throwsCode(() => reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p6', targetId: 'p6' }), 'bad-lady-target');
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p6', targetId: 'p4' });
  assert.equal(s.lady.holder, 'p4');
  s = round(s, ['p4', 'p1', 'p2'], ['p4']);
  throwsCode(() => reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p4', targetId: 'p6' }), 'bad-lady-target');
  assert.ok(!viewFor(s, 'p4').lady.targets.includes('p6'));
});

test('only the Lady holder learns the result; everyone sees who was examined', () => {
  let s = rigged(SEVEN, LADY);
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p6', targetId: 'p4' });
  assert.deepEqual(viewFor(s, 'p6').me.ladyFindings, [{ quest: 1, target: 'p4', side: 'evil' }]);
  const other = viewFor(s, 'p1');
  assert.deepEqual(other.me.ladyFindings, []);
  assert.deepEqual(other.lady.examinations, [{ quest: 1, holder: 'p6', target: 'p4' }]);
  assert.ok(!JSON.stringify(other.lady).includes('evil'));
});

test('the Lady is skipped if the game ends on quest 3', () => {
  let s = rigged(SEVEN, LADY);
  s = round(s, ['p4', 'p0'], ['p4']);
  s = round(s, ['p4', 'p0', 'p1'], ['p4']);
  s = reduce(s, { type: ACTIONS.LADY_EXAMINE, playerId: 'p6', targetId: 'p0' });
  s = round(s, ['p4', 'p0', 'p1'], ['p4']);
  assert.equal(s.phase, PHASES.GAME_OVER);
});

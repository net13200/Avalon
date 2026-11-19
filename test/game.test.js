import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, ACTIONS, PHASES, RuleError, WIN_REASONS, awaiting } from '../src/index.js';
import { rigged, propose, voteAll, quest, round } from './helpers.js';

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof RuleError && e.code === code);

// Seats: p0 Merlin, p1 servant, p2 servant, p3 Assassin, p4 minion.
const FIVE = ['merlin', 'servant', 'servant', 'assassin', 'minion'];

test('only the leader proposes, with exactly the right team size', () => {
  const g = rigged(FIVE);
  throwsCode(() => reduce(g, { type: ACTIONS.PROPOSE_TEAM, playerId: 'p1', team: ['p0', 'p1'] }), 'not-leader');
  throwsCode(() => propose(g, ['p0']), 'bad-team-size');
  throwsCode(() => propose(g, ['p0', 'p1', 'p2']), 'bad-team-size');
  throwsCode(() => propose(g, ['p0', 'p0']), 'bad-team');
  throwsCode(() => propose(g, ['p0', 'zz']), 'unknown-player');
  const s = propose(g, ['p0', 'p1']);
  assert.equal(s.phase, PHASES.TEAM_VOTE);
  assert.deepEqual(s.team, ['p0', 'p1']);
});

test('reduce never modifies the state it is given', () => {
  const g = rigged(FIVE);
  const before = structuredClone(g);
  propose(g, ['p0', 'p1']);
  assert.deepEqual(g, before);
});

test('actions in the wrong phase and unknown actions are rejected', () => {
  const g = rigged(FIVE);
  throwsCode(() => reduce(g, { type: ACTIONS.VOTE, playerId: 'p0', approve: true }), 'wrong-phase');
  throwsCode(() => reduce(g, { type: 'NOPE', playerId: 'p0' }), 'unknown-action');
  throwsCode(() => reduce(g, { type: ACTIONS.PROPOSE_TEAM, playerId: 'ghost', team: [] }), 'unknown-player');
});

test('every player votes once; majority approves', () => {
  let s = propose(rigged(FIVE), ['p0', 'p1']);
  s = reduce(s, { type: ACTIONS.VOTE, playerId: 'p0', approve: true });
  throwsCode(() => reduce(s, { type: ACTIONS.VOTE, playerId: 'p0', approve: false }), 'already-voted');
  throwsCode(() => reduce(s, { type: ACTIONS.VOTE, playerId: 'p1', approve: 'yes' }), 'bad-vote');
  assert.deepEqual(awaiting(s), ['p1', 'p2', 'p3', 'p4']);
  s = voteAll(propose(rigged(FIVE), ['p0', 'p1']), (id) => ['p0', 'p1', 'p2'].includes(id));
  assert.equal(s.phase, PHASES.QUEST);
  assert.equal(s.history.at(-1).approved, true);
});

test('a tied vote rejects the team and passes the lead', () => {
  const six = rigged(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion']);
  const s = voteAll(propose(six, ['p0', 'p1']), (id) => ['p0', 'p1', 'p2'].includes(id));
  assert.equal(s.phase, PHASES.TEAM_BUILD);
  assert.equal(s.rejections, 1);
  assert.equal(s.leader, 1);
  assert.deepEqual(s.team, []);
});

test('five rejections in a row give evil the win', () => {
  let s = rigged(FIVE);
  for (let i = 0; i < 4; i++) {
    s = voteAll(propose(s, ['p0', 'p1']), false);
    assert.equal(s.phase, PHASES.TEAM_BUILD);
  }
  s = voteAll(propose(s, ['p0', 'p1']), false);
  assert.equal(s.phase, PHASES.GAME_OVER);
  assert.equal(s.winner, 'evil');
  assert.equal(s.winReason, WIN_REASONS.FIVE_REJECTIONS);
});

test('an approved team resets the rejection count', () => {
  let s = rigged(FIVE);
  s = voteAll(propose(s, ['p0', 'p1']), false);
  s = voteAll(propose(s, ['p0', 'p1']), false);
  assert.equal(s.rejections, 2);
  s = voteAll(propose(s, ['p0', 'p1']), true);
  assert.equal(s.rejections, 0);
});

test('good players cannot play Fail; evil players may play either', () => {
  const s = voteAll(propose(rigged(FIVE), ['p1', 'p3']), true);
  throwsCode(() => quest(s, ['p1']), 'good-must-succeed');
  throwsCode(() => reduce(s, { type: ACTIONS.PLAY_QUEST_CARD, playerId: 'p0', success: true }), 'not-on-team');
  const once = reduce(s, { type: ACTIONS.PLAY_QUEST_CARD, playerId: 'p3', success: true });
  throwsCode(() => reduce(once, { type: ACTIONS.PLAY_QUEST_CARD, playerId: 'p3', success: false }), 'already-played');
  assert.equal(quest(s, []).questResults[0].success, true);
  assert.equal(quest(s, ['p3']).questResults[0].success, false);
});

test('quest results keep only the number of fails, never who played them', () => {
  const s = round(rigged(FIVE), ['p3', 'p4'], ['p3', 'p4']);
  assert.deepEqual(s.questResults[0], { quest: 0, team: ['p3', 'p4'], fails: 2, success: false });
  assert.deepEqual(s.questCards, {});
  assert.equal(s.history.at(-1).fails, 2);
  assert.ok(!JSON.stringify(s).includes('"p3":false'));
});

test('after a quest the next round starts with the next leader', () => {
  const s = round(rigged(FIVE), ['p0', 'p1']);
  assert.equal(s.phase, PHASES.TEAM_BUILD);
  assert.equal(s.quest, 1);
  assert.equal(s.leader, 1);
});

test('with 7+ players, one fail on the 4th quest is not enough', () => {
  // p0 Merlin, p1-p3 servants, p4 Assassin, p5-p6 minions.
  let s = rigged(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion']);
  s = round(s, ['p0', 'p1']); // Q1 ok
  s = round(s, ['p4', 'p1', 'p2'], ['p4']); // Q2 fail
  s = round(s, ['p0', 'p1', 'p2']); // Q3 ok
  s = round(s, ['p4', 'p0', 'p1', 'p2'], ['p4']); // Q4: one fail of the two needed
  assert.equal(s.questResults[3].fails, 1);
  assert.equal(s.questResults[3].success, true);
  assert.equal(s.phase, PHASES.ASSASSINATION);
});

test('two fails fail the 4th quest with 7 players', () => {
  let s = rigged(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion']);
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  s = round(s, ['p4', 'p0', 'p1'], ['p4']);
  s = round(s, ['p4', 'p5', 'p0', 'p1'], ['p4', 'p5']);
  assert.equal(s.questResults[3].success, false);
  assert.equal(s.phase, PHASES.TEAM_BUILD);
  assert.equal(s.quest, 4);
});

test('with 5 or 6 players, one fail on the 4th quest fails it', () => {
  let s = rigged(FIVE);
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  s = round(s, ['p3', 'p0'], ['p3']);
  s = round(s, ['p3', 'p0', 'p1'], ['p3']);
  assert.equal(s.questResults[3].success, false);
});

test('three failed quests give evil the win', () => {
  let s = rigged(FIVE);
  s = round(s, ['p3', 'p0'], ['p3']);
  s = round(s, ['p3', 'p0', 'p1'], ['p3']);
  assert.equal(s.phase, PHASES.TEAM_BUILD);
  s = round(s, ['p4', 'p0'], ['p4']);
  assert.equal(s.phase, PHASES.GAME_OVER);
  assert.equal(s.winner, 'evil');
  assert.equal(s.winReason, WIN_REASONS.THREE_FAILS);
});

test('three successes lead to the assassination', () => {
  let s = rigged(FIVE);
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  s = round(s, ['p0', 'p1']);
  assert.equal(s.phase, PHASES.ASSASSINATION);
  assert.deepEqual(awaiting(s), ['p3']);

  throwsCode(() => reduce(s, { type: ACTIONS.ASSASSINATE, playerId: 'p4', targetId: 'p0' }), 'not-assassin');
  throwsCode(() => reduce(s, { type: ACTIONS.ASSASSINATE, playerId: 'p3', targetId: 'p3' }), 'bad-assassin-target');

  const hit = reduce(s, { type: ACTIONS.ASSASSINATE, playerId: 'p3', targetId: 'p0' });
  assert.equal(hit.winner, 'evil');
  assert.equal(hit.winReason, WIN_REASONS.MERLIN_ASSASSINATED);
  assert.equal(hit.assassinTarget, 'p0');

  const miss = reduce(s, { type: ACTIONS.ASSASSINATE, playerId: 'p3', targetId: 'p1' });
  assert.equal(miss.winner, 'good');
  assert.equal(miss.winReason, WIN_REASONS.MERLIN_SURVIVED);
});

test('without Merlin and the Assassin, three successes win outright', () => {
  let s = rigged(['servant', 'servant', 'servant', 'minion', 'minion'], { roles: [] });
  s = round(s, ['p0', 'p1']);
  s = round(s, ['p0', 'p1', 'p2']);
  s = round(s, ['p0', 'p1']);
  assert.equal(s.phase, PHASES.GAME_OVER);
  assert.equal(s.winner, 'good');
  assert.equal(s.winReason, WIN_REASONS.THREE_SUCCESSES);
});

test('no further actions are accepted after the game ends', () => {
  let s = rigged(FIVE);
  for (let i = 0; i < 5; i++) s = voteAll(propose(s, ['p0', 'p1']), false);
  throwsCode(() => propose(s, ['p0', 'p1']), 'wrong-phase');
});

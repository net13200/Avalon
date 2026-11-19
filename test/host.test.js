import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, C2H, H2C } from '../src/host.js';
import { ACTIONS, PHASES } from '../src/index.js';
import { seeded } from './helpers.js';

/** A host plus an inbox per player, with every message delivered synchronously. */
function setup(n = 5) {
  const inbox = {};
  const host = new HostSession({
    hostId: 'h',
    rng: seeded(3),
    send: (to, msg) => (inbox[to] ??= []).push(msg),
  });
  const ids = ['h', ...Array.from({ length: n - 1 }, (_, i) => `c${i}`)];
  for (const id of ids) host.receive(id, { type: C2H.HELLO, name: id.toUpperCase() });
  const last = (id) => inbox[id].at(-1);
  return { host, inbox, ids, last };
}

test('players join the lobby in order and everyone gets the lobby', () => {
  const { host, ids, last } = setup(5);
  assert.deepEqual(host.players.map((p) => p.id), ids);
  for (const id of ids) {
    assert.equal(last(id).type, H2C.LOBBY);
    assert.equal(last(id).lobby.players.length, 5);
  }
  assert.equal(last('c0').lobby.canStart, true);
});

test('the lobby reports why the game cannot start yet', () => {
  const { last } = setup(4);
  assert.equal(last('h').lobby.canStart, false);
  assert.match(last('h').lobby.setupError, /at least 5/);
});

test('only the host can change options, move seats, kick or start', () => {
  const { host, last } = setup(5);
  host.receive('c0', { type: C2H.START });
  assert.equal(last('c0').type, H2C.ERROR);
  assert.equal(last('c0').code, 'not-host');
  assert.equal(host.state, null);

  host.receive('h', { type: C2H.MOVE_SEAT, playerId: 'c1', delta: -1 });
  assert.deepEqual(host.players.map((p) => p.id), ['h', 'c1', 'c0', 'c2', 'c3']);

  host.receive('h', { type: C2H.KICK, playerId: 'c3' });
  assert.equal(host.players.length, 4);
  assert.equal(last('c3').type, H2C.REJECTED);
});

test('invalid character choices block the start', () => {
  const { host, last } = setup(5);
  host.receive('h', { type: C2H.SET_OPTIONS, options: { roles: ['merlin', 'assassin', 'percival', 'morgana', 'mordred'] } });
  assert.equal(last('h').lobby.canStart, false);
  host.receive('h', { type: C2H.START });
  assert.equal(last('h').code, 'too-many-evil-roles');
});

test('starting sends each player only their own view', () => {
  const { host, ids, last } = setup(5);
  host.receive('h', { type: C2H.START });
  assert.ok(host.state);
  for (const id of ids) {
    const msg = last(id);
    assert.equal(msg.type, H2C.VIEW);
    assert.equal(msg.view.me.id, id);
    assert.equal(msg.view.me.role, host.state.roles[id]);
    assert.equal(msg.view.roles, null);
  }
});

test('actions are attributed to the sender, not to a claimed playerId', () => {
  const { host, last } = setup(5);
  host.receive('h', { type: C2H.START });
  const leader = host.players[host.state.leader].id;
  const other = host.players.find((p) => p.id !== leader).id;
  host.receive(other, {
    type: C2H.ACTION,
    action: { type: ACTIONS.PROPOSE_TEAM, playerId: leader, team: [leader, other] },
  });
  assert.equal(last(other).code, 'not-leader');
  host.receive(leader, { type: C2H.ACTION, action: { type: ACTIONS.PROPOSE_TEAM, team: [leader, other] } });
  assert.equal(host.state.phase, PHASES.TEAM_VOTE);
});

test('strangers cannot join a running game; known players can rejoin', () => {
  const { host, inbox, last } = setup(5);
  host.receive('h', { type: C2H.START });
  host.receive('x', { type: C2H.HELLO, name: 'X' });
  assert.equal(last('x').type, H2C.REJECTED);
  assert.equal(last('x').code, 'game-in-progress');

  host.receive('c1', { type: C2H.BYE });
  assert.equal(host.players.find((p) => p.id === 'c1').connected, false);
  inbox.c1 = [];
  host.receive('c1', { type: C2H.HELLO, name: 'renamed' });
  assert.equal(last('c1').type, H2C.VIEW);
  assert.equal(host.players.find((p) => p.id === 'c1').name, 'C1', 'no renaming mid-game');
});

test('the room is full at 10 players', () => {
  const { host, last } = setup(10);
  host.receive('late', { type: C2H.HELLO, name: 'Late' });
  assert.equal(last('late').code, 'room-full');
});

test('leaving the lobby frees the seat; leaving a game keeps it', () => {
  const { host } = setup(6);
  host.receive('c4', { type: C2H.LEAVE });
  assert.equal(host.players.length, 5);
  host.receive('h', { type: C2H.START });
  host.receive('c3', { type: C2H.LEAVE });
  assert.equal(host.players.length, 5);
  assert.equal(host.players.find((p) => p.id === 'c3').connected, false);
});

test('a snapshot resumes the session after the host reloads', () => {
  const { host } = setup(5);
  host.receive('h', { type: C2H.START });
  const saved = JSON.parse(JSON.stringify(host.snapshot()));
  const inbox = {};
  const again = new HostSession({ hostId: 'h', saved, send: (to, msg) => (inbox[to] ??= []).push(msg) });
  again.receive('h', { type: C2H.HELLO, name: 'H' });
  assert.deepEqual(again.state, host.state);
  assert.equal(inbox.c2.at(-1).type, H2C.VIEW, 'everyone gets their view again');
});

test('new game returns everyone to the lobby with the same seats', () => {
  const { host, last } = setup(5);
  host.receive('h', { type: C2H.START });
  host.receive('h', { type: C2H.NEW_GAME });
  assert.equal(host.state, null);
  assert.equal(last('c0').type, H2C.LOBBY);
  assert.equal(host.players.length, 5);
});

test('messages from players who never joined are refused', () => {
  const { host, last } = setup(5);
  host.receive('ghost', { type: C2H.ACTION, action: {} });
  assert.equal(last('ghost').code, 'not-joined');
});

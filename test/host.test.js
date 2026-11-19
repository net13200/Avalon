import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, C2H, H2C, PROTOCOL } from '../src/host.js';
import { ACTIONS, PHASES } from '../src/index.js';
import { seeded } from './helpers.js';

/**
 * A host plus an inbox per connection. Each player connects on connection
 * `conn-<id>` with secret `s-<id>`; messages are delivered synchronously.
 */
function setup(n = 5) {
  const inbox = {};
  const dropped = [];
  const host = new HostSession({
    hostId: 'h',
    rng: seeded(3),
    send: (to, msg) => (inbox[to] ??= []).push(msg),
    drop: (conn) => dropped.push(conn),
  });
  const ids = ['h', ...Array.from({ length: n - 1 }, (_, i) => `c${i}`)];
  const hello = (id, extra = {}) =>
    host.receive(`conn-${id}`, { type: C2H.HELLO, v: PROTOCOL, pid: id, secret: `s-${id}`, name: id.toUpperCase(), ...extra });
  for (const id of ids) hello(id);
  const from = (id, msg) => host.receive(`conn-${id}`, msg);
  const last = (id) => inbox[`conn-${id}`]?.at(-1);
  return { host, inbox, ids, hello, from, last, dropped };
}

test('players join the lobby in order and everyone gets the lobby', () => {
  const { host, ids, last } = setup(5);
  assert.deepEqual(host.players.map((p) => p.id), ids);
  for (const id of ids) {
    assert.equal(last(id).type, H2C.LOBBY);
    assert.equal(last(id).lobby.players.length, 5);
    assert.ok(last(id).lobby.players.every((p) => p.connected));
  }
  assert.equal(last('c0').lobby.canStart, true);
});

test('secrets never leave the host', () => {
  const { last, from } = setup(5);
  assert.ok(!JSON.stringify(last('c0')).includes('s-'));
  from('h', { type: C2H.START });
  assert.ok(!JSON.stringify(last('c0')).includes('s-'));
});

test('the lobby reports why the game cannot start yet', () => {
  const { last } = setup(4);
  assert.equal(last('h').lobby.canStart, false);
  assert.match(last('h').lobby.setupError, /at least 5/);
});

test('only the host can change options, move seats, kick or start', () => {
  const { host, from, last, dropped } = setup(5);
  from('c0', { type: C2H.START });
  assert.equal(last('c0').type, H2C.ERROR);
  assert.equal(last('c0').code, 'not-host');
  assert.equal(host.state, null);

  from('h', { type: C2H.MOVE_SEAT, playerId: 'c1', delta: -1 });
  assert.deepEqual(host.players.map((p) => p.id), ['h', 'c1', 'c0', 'c2', 'c3']);

  from('h', { type: C2H.KICK, playerId: 'c3' });
  assert.equal(host.players.length, 4);
  assert.equal(last('c3').type, H2C.REJECTED);
  assert.deepEqual(dropped, ['conn-c3']);
});

test('invalid character choices block the start', () => {
  const { from, last } = setup(5);
  from('h', { type: C2H.SET_OPTIONS, options: { roles: ['merlin', 'assassin', 'percival', 'morgana', 'mordred'] } });
  assert.equal(last('h').lobby.canStart, false);
  from('h', { type: C2H.START });
  assert.equal(last('h').code, 'too-many-evil-roles');
});

test('starting sends each player only their own view', () => {
  const { host, ids, from, last } = setup(5);
  from('h', { type: C2H.START });
  assert.ok(host.state);
  for (const id of ids) {
    const msg = last(id);
    assert.equal(msg.type, H2C.VIEW);
    assert.equal(msg.view.me.id, id);
    assert.equal(msg.view.me.role, host.state.roles[id]);
    assert.equal(msg.view.roles, null);
  }
});

test('actions are attributed to the connection, not to a claimed playerId', () => {
  const { host, from, last } = setup(5);
  from('h', { type: C2H.START });
  const leader = host.players[host.state.leader].id;
  const other = host.players.find((p) => p.id !== leader).id;
  from(other, { type: C2H.ACTION, action: { type: ACTIONS.PROPOSE_TEAM, playerId: leader, team: [leader, other] } });
  assert.equal(last(other).code, 'not-leader');
  from(leader, { type: C2H.ACTION, action: { type: ACTIONS.PROPOSE_TEAM, team: [leader, other] } });
  assert.equal(host.state.phase, PHASES.TEAM_VOTE);
});

test('a device cannot take a seat without its secret', () => {
  const { host, inbox } = setup(5);
  host.receive('evil-conn', { type: C2H.HELLO, v: PROTOCOL, pid: 'c1', secret: 'guess', name: 'Mallory' });
  assert.equal(inbox['evil-conn'].at(-1).code, 'wrong-secret');
  assert.equal(host.connOf.get('c1'), 'conn-c1', 'the real player keeps the seat');
  host.receive('evil-conn', { type: C2H.START });
  assert.equal(inbox['evil-conn'].at(-1).code, 'not-joined');
});

test('a device running another protocol version is asked to reload', () => {
  const { host, inbox } = setup(5);
  host.receive('old', { type: C2H.HELLO, pid: 'old', secret: 'o', name: 'Old' });
  assert.equal(inbox.old.at(-1).code, 'version-mismatch');
  assert.match(inbox.old.at(-1).message, /Your app is out of date/);
  host.receive('new', { type: C2H.HELLO, v: PROTOCOL + 1, pid: 'new', secret: 'n', name: 'New' });
  assert.match(inbox.new.at(-1).message, /host's app is out of date/);
  assert.equal(host.players.length, 5);
});

test('malformed hellos are rejected', () => {
  const { host, inbox } = setup(5);
  host.receive('x', { type: C2H.HELLO, v: PROTOCOL, pid: '', secret: 'a' });
  host.receive('y', { type: C2H.HELLO, v: PROTOCOL, pid: 'ok', secret: '' });
  host.receive('z', { type: C2H.HELLO, v: PROTOCOL, pid: 'has space', secret: 'a' });
  for (const c of ['x', 'y', 'z']) assert.equal(inbox[c].at(-1).code, 'bad-hello');
});

test('a player rejoining on a new connection replaces the old one', () => {
  const { host, inbox, dropped, from } = setup(5);
  from('h', { type: C2H.START });
  host.receive('new-conn', { type: C2H.HELLO, v: PROTOCOL, pid: 'c1', secret: 's-c1', name: 'renamed' });
  assert.deepEqual(dropped, ['conn-c1']);
  assert.equal(inbox['new-conn'].at(-1).type, H2C.VIEW);
  assert.equal(host.players.find((p) => p.id === 'c1').name, 'C1', 'no renaming mid-game');
  // A late close from the old connection does not mark the player offline.
  host.disconnected('conn-c1');
  assert.equal(host.lobbyInfo().players.find((p) => p.id === 'c1').connected, true);
});

test('strangers cannot join a running game; disconnected players show offline', () => {
  const { host, inbox, from } = setup(5);
  from('h', { type: C2H.START });
  host.receive('x', { type: C2H.HELLO, v: PROTOCOL, pid: 'x', secret: 'x', name: 'X' });
  assert.equal(inbox.x.at(-1).code, 'game-in-progress');
  host.disconnected('conn-c2');
  assert.equal(host.lobbyInfo().players.find((p) => p.id === 'c2').connected, false);
});

test('the room is full at 10 players', () => {
  const { host, inbox } = setup(10);
  host.receive('late', { type: C2H.HELLO, v: PROTOCOL, pid: 'late', secret: 'l', name: 'Late' });
  assert.equal(inbox.late.at(-1).code, 'room-full');
});

test('leaving the lobby frees the seat; leaving a game keeps it', () => {
  const { host, from } = setup(6);
  from('c4', { type: C2H.LEAVE });
  assert.equal(host.players.length, 5);
  from('h', { type: C2H.START });
  from('c3', { type: C2H.LEAVE });
  assert.equal(host.players.length, 5);
  assert.equal(host.lobbyInfo().players.find((p) => p.id === 'c3').connected, false);
});

test('a snapshot resumes the session after the host reloads', () => {
  const { host, from } = setup(5);
  from('h', { type: C2H.START });
  const saved = JSON.parse(JSON.stringify(host.snapshot()));
  const inbox = {};
  const again = new HostSession({ hostId: 'h', saved, send: (to, msg) => (inbox[to] ??= []).push(msg) });
  again.receive('self', { type: C2H.HELLO, v: PROTOCOL, pid: 'h', secret: 's-h', name: 'H' });
  assert.deepEqual(again.state, host.state);
  assert.equal(inbox.self.at(-1).type, H2C.VIEW);
  assert.equal(again.lobbyInfo().players.filter((p) => p.connected).length, 1, 'others must reconnect');
  again.receive('c2-again', { type: C2H.HELLO, v: PROTOCOL, pid: 'c2', secret: 's-c2', name: 'C2' });
  assert.equal(inbox['c2-again'].at(-1).view.me.role, host.state.roles.c2);
});

test('new game returns everyone to the lobby with the same seats', () => {
  const { host, from, last } = setup(5);
  from('h', { type: C2H.START });
  from('h', { type: C2H.NEW_GAME });
  assert.equal(host.state, null);
  assert.equal(last('c0').type, H2C.LOBBY);
  assert.equal(host.players.length, 5);
});

test('messages from connections that never joined are refused', () => {
  const { host, inbox } = setup(5);
  host.receive('ghost', { type: C2H.ACTION, action: {} });
  assert.equal(inbox.ghost.at(-1).code, 'not-joined');
  host.disconnected('ghost'); // harmless
});

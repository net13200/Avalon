// The host session: runs on the host's device, owns the lobby and the game state,
// and answers every other device. It knows nothing about the network: the transport
// calls receive(connId, msg) for each message from a connection, and the session
// replies through send(connId, msg).
//
// A connection becomes a player by saying hello with { pid, secret }. Player ids are
// public (every view lists them); the secret is not, so a device can only take over
// a seat by proving it holds that seat's secret, e.g. a phone rejoining after a reload.

import { createGame, reduce, validateSetup, RuleError } from './game.js';
import { viewFor } from './view.js';
import { DEFAULT_OPTIONS, MAX_PLAYERS, MIN_PLAYERS } from './rules.js';

/**
 * Bumped whenever messages change incompatibly. Phones can run different cached
 * versions of the app after an update, so a mismatch asks the player to reload.
 */
export const PROTOCOL = 1;

/** Messages a client sends to the host. */
export const C2H = Object.freeze({
  HELLO: 'hello', // { v, pid, secret, name } - join, or rejoin the same seat
  BYE: 'bye', // the connection closed; the player keeps their seat
  LEAVE: 'leave', // the player left on purpose; removed if the game has not started
  ACTION: 'action', // { action } - a game action; playerId is filled in by the host
  // Host only:
  SET_OPTIONS: 'set-options', // { options }
  MOVE_SEAT: 'move-seat', // { playerId, delta }
  KICK: 'kick', // { playerId }
  START: 'start',
  NEW_GAME: 'new-game', // back to the lobby with the same players
});

/** Messages the host sends to a client. */
export const H2C = Object.freeze({
  LOBBY: 'lobby', // { lobby } - sent while no game is running
  VIEW: 'view', // { lobby, view } - this player's view of the running game
  ERROR: 'error', // { code, message }
  REJECTED: 'rejected', // { code, message } - could not join, or removed
});

const ID_PATTERN = /^[\w-]{1,64}$/;

export class HostSession {
  /**
   * @param {object} p
   * @param {string} p.hostId the host's own player id
   * @param {(connId: string, msg: object) => void} p.send
   * @param {(connId: string) => void} [p.drop] close a connection that was replaced or removed
   * @param {() => number} [p.rng]
   * @param {object} [p.saved] a value from snapshot(), to resume after a reload
   */
  constructor({ hostId, send, drop = () => {}, rng, saved }) {
    this.hostId = hostId;
    this.send = send;
    this.drop = drop;
    this.rng = rng;
    this.players = saved?.players ?? []; // [{ id, name, secret }]
    this.options = saved?.options ?? { ...DEFAULT_OPTIONS };
    this.state = saved?.state ?? null;
    this.pidOf = new Map(); // connId -> pid
    this.connOf = new Map(); // pid -> connId
    this.onChange = () => {};
  }

  /** Everything needed to resume this session; safe to JSON.stringify. */
  snapshot() {
    return { players: this.players, options: this.options, state: this.state };
  }

  lobbyInfo() {
    let setupError = null;
    try {
      validateSetup(Math.max(this.players.length, MIN_PLAYERS), this.options);
    } catch (e) {
      setupError = e.message;
    }
    if (!setupError && this.players.length < MIN_PLAYERS) {
      setupError = `Waiting for at least ${MIN_PLAYERS} players.`;
    }
    return {
      hostId: this.hostId,
      players: this.players.map(({ id, name }) => ({ id, name, connected: this.connOf.has(id) })),
      options: this.options,
      inGame: Boolean(this.state),
      canStart: !this.state && !setupError,
      setupError,
    };
  }

  receive(connId, msg) {
    try {
      this.#handle(connId, msg ?? {});
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.send(connId, { type: H2C.ERROR, code: e.code, message: e.message });
    }
  }

  /** The host closes the room: every other device is told and released. */
  end() {
    for (const [conn, pid] of this.pidOf) {
      if (pid !== this.hostId) this.send(conn, { type: H2C.REJECTED, code: 'host-left', message: 'The host closed the game.' });
    }
  }

  /** The transport reports a closed connection. */
  disconnected(connId) {
    this.receive(connId, { type: C2H.BYE });
  }

  #handle(connId, msg) {
    if (msg.type === C2H.HELLO) return this.#hello(connId, msg);
    const pid = this.pidOf.get(connId);
    const player = pid && this.players.find((p) => p.id === pid);
    if (msg.type === C2H.BYE) {
      if (pid) this.#unbind(connId);
      return pid ? this.#broadcast() : undefined;
    }
    if (!player) throw new RuleError('not-joined', 'Join the game first.');

    if (msg.type === C2H.LEAVE) {
      this.#unbind(connId);
      if (!this.state && pid !== this.hostId) this.players = this.players.filter((p) => p.id !== pid);
      return this.#broadcast();
    }
    if (msg.type === C2H.ACTION) {
      if (!this.state) throw new RuleError('no-game', 'The game has not started.');
      this.state = reduce(this.state, { ...msg.action, playerId: pid });
      return this.#broadcast();
    }

    // Lobby management: host only.
    if (pid !== this.hostId) throw new RuleError('not-host', 'Only the host can do that.');
    switch (msg.type) {
      case C2H.SET_OPTIONS:
        this.#requireLobby();
        this.options = {
          roles: [...(msg.options?.roles ?? this.options.roles)],
          ladyOfTheLake: Boolean(msg.options?.ladyOfTheLake ?? this.options.ladyOfTheLake),
        };
        break;
      case C2H.MOVE_SEAT: {
        this.#requireLobby();
        const i = this.players.findIndex((p) => p.id === msg.playerId);
        const j = i + msg.delta;
        if (i < 0 || j < 0 || j >= this.players.length) return undefined;
        [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
        break;
      }
      case C2H.KICK: {
        this.#requireLobby();
        if (msg.playerId === this.hostId) throw new RuleError('bad-kick', 'The host cannot leave their own game.');
        const conn = this.connOf.get(msg.playerId);
        if (conn !== undefined) {
          this.send(conn, { type: H2C.REJECTED, code: 'kicked', message: 'The host removed you from the game.' });
          this.#unbind(conn);
          this.drop(conn);
        }
        this.players = this.players.filter((p) => p.id !== msg.playerId);
        break;
      }
      case C2H.START:
        this.#requireLobby();
        this.state = createGame(this.players, this.options, this.rng);
        break;
      case C2H.NEW_GAME:
        this.state = null;
        break;
      default:
        throw new RuleError('unknown-message', `Unknown message: ${msg.type}.`);
    }
    return this.#broadcast();
  }

  #hello(connId, { v, pid, secret, name }) {
    const reject = (code, message) => this.send(connId, { type: H2C.REJECTED, code, message });
    if (v !== PROTOCOL) {
      return reject('version-mismatch', v > PROTOCOL
        ? "The host's app is out of date. The host should reload the page, then you can rejoin."
        : 'Your app is out of date. Reload the page, then join again.');
    }
    if (typeof pid !== 'string' || !ID_PATTERN.test(pid) || typeof secret !== 'string' || !secret) {
      return reject('bad-hello', 'This device sent an invalid request.');
    }
    const cleanName = String(name ?? '').trim().slice(0, 20) || 'Player';
    const player = this.players.find((p) => p.id === pid);

    if (player) {
      if (player.secret !== secret) return reject('wrong-secret', 'That seat belongs to another device.');
      if (!this.state) player.name = cleanName; // no renaming mid-game
    } else {
      if (this.state) return reject('game-in-progress', 'This game has already started.');
      if (this.players.length >= MAX_PLAYERS) return reject('room-full', `The game is full (${MAX_PLAYERS} players).`);
      this.players.push({ id: pid, name: cleanName, secret });
    }

    // Bind this connection to the seat, replacing an older connection (e.g. before a reload).
    const old = this.connOf.get(pid);
    if (old !== undefined && old !== connId) {
      this.pidOf.delete(old);
      this.drop(old);
    }
    const prevPid = this.pidOf.get(connId);
    if (prevPid && prevPid !== pid) this.connOf.delete(prevPid);
    this.pidOf.set(connId, pid);
    this.connOf.set(pid, connId);
    return this.#broadcast();
  }

  #unbind(connId) {
    const pid = this.pidOf.get(connId);
    this.pidOf.delete(connId);
    if (pid && this.connOf.get(pid) === connId) this.connOf.delete(pid);
  }

  #requireLobby() {
    if (this.state) throw new RuleError('game-running', 'Not possible while a game is running.');
  }

  #broadcast() {
    const lobby = this.lobbyInfo();
    for (const p of this.players) {
      const conn = this.connOf.get(p.id);
      if (conn === undefined) continue;
      if (this.state?.roles[p.id]) {
        this.send(conn, { type: H2C.VIEW, lobby, view: viewFor(this.state, p.id) });
      } else {
        this.send(conn, { type: H2C.LOBBY, lobby });
      }
    }
    this.onChange();
  }
}

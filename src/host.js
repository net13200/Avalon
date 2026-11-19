// The host session: runs on the host's device, owns the lobby and the game state,
// and answers every other device. It knows nothing about the network: messages come
// in through receive(from, msg) and go out through the send(to, msg) function it is given.

import { createGame, reduce, validateSetup, RuleError } from './game.js';
import { viewFor } from './view.js';
import { DEFAULT_OPTIONS, MAX_PLAYERS, MIN_PLAYERS } from './rules.js';

/** Messages a client sends to the host. */
export const C2H = Object.freeze({
  HELLO: 'hello', // { name } - join, or rejoin with the same id
  BYE: 'bye', // the device is closing or reloading; the player keeps their seat
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
  REJECTED: 'rejected', // { code, message } - could not join
});

export class HostSession {
  /**
   * @param {object} p
   * @param {string} p.hostId the host's own player id
   * @param {(to: string, msg: object) => void} p.send
   * @param {() => number} [p.rng]
   * @param {object} [p.saved] a value from snapshot(), to resume after a reload
   */
  constructor({ hostId, send, rng, saved }) {
    this.hostId = hostId;
    this.send = send;
    this.rng = rng;
    this.players = saved?.players ?? []; // [{ id, name, connected }]
    this.options = saved?.options ?? { ...DEFAULT_OPTIONS };
    this.state = saved?.state ?? null;
    this.onChange = () => {};
    for (const p of this.players) p.connected = p.id === hostId;
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
      players: this.players.map(({ id, name, connected }) => ({ id, name, connected })),
      options: this.options,
      inGame: Boolean(this.state),
      canStart: !this.state && !setupError,
      setupError,
    };
  }

  receive(from, msg) {
    try {
      this.#handle(from, msg);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.send(from, { type: H2C.ERROR, code: e.code, message: e.message });
    }
  }

  #handle(from, msg) {
    const player = this.players.find((p) => p.id === from);
    if (msg.type === C2H.HELLO) return this.#hello(from, msg, player);
    if (!player) {
      throw new RuleError('not-joined', 'Join the game first.');
    }
    if (msg.type === C2H.BYE) {
      player.connected = false;
      return this.#broadcast();
    }
    if (msg.type === C2H.LEAVE) {
      if (this.state || from === this.hostId) player.connected = false;
      else this.players = this.players.filter((p) => p.id !== from);
      return this.#broadcast();
    }
    if (msg.type === C2H.ACTION) {
      if (!this.state) throw new RuleError('no-game', 'The game has not started.');
      this.state = reduce(this.state, { ...msg.action, playerId: from });
      return this.#broadcast();
    }

    // Lobby management: host only.
    if (from !== this.hostId) throw new RuleError('not-host', 'Only the host can do that.');
    switch (msg.type) {
      case C2H.SET_OPTIONS:
        this.#requireLobby();
        this.options = {
          roles: [...(msg.options.roles ?? this.options.roles)],
          ladyOfTheLake: Boolean(msg.options.ladyOfTheLake ?? this.options.ladyOfTheLake),
        };
        break;
      case C2H.MOVE_SEAT: {
        this.#requireLobby();
        const i = this.players.findIndex((p) => p.id === msg.playerId);
        const j = i + msg.delta;
        if (i < 0 || j < 0 || j >= this.players.length) return;
        [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
        break;
      }
      case C2H.KICK: {
        this.#requireLobby();
        if (msg.playerId === this.hostId) throw new RuleError('bad-kick', 'The host cannot leave their own game.');
        this.players = this.players.filter((p) => p.id !== msg.playerId);
        this.send(msg.playerId, { type: H2C.REJECTED, code: 'kicked', message: 'The host removed you from the game.' });
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

  #hello(from, msg, player) {
    const name = String(msg.name ?? '').trim().slice(0, 20) || 'Player';
    if (player) {
      // Rejoin (reload, reconnect). Name changes are allowed in the lobby only.
      player.connected = true;
      if (!this.state) player.name = name;
    } else {
      if (this.state) {
        return this.send(from, { type: H2C.REJECTED, code: 'game-in-progress', message: 'This game has already started.' });
      }
      if (this.players.length >= MAX_PLAYERS) {
        return this.send(from, { type: H2C.REJECTED, code: 'room-full', message: `The game is full (${MAX_PLAYERS} players).` });
      }
      this.players.push({ id: from, name, connected: true });
    }
    return this.#broadcast();
  }

  #requireLobby() {
    if (this.state) throw new RuleError('game-running', 'Not possible while a game is running.');
  }

  #broadcast() {
    const lobby = this.lobbyInfo();
    const inGame = this.state ? new Set(Object.keys(this.state.roles)) : null;
    for (const p of this.players) {
      if (inGame?.has(p.id)) {
        this.send(p.id, { type: H2C.VIEW, lobby, view: viewFor(this.state, p.id) });
      } else {
        this.send(p.id, { type: H2C.LOBBY, lobby });
      }
    }
    this.onChange();
  }
}

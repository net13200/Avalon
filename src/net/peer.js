// WebRTC transport using PeerJS (vendor/peerjs.min.js, loaded as a classic script that
// defines globalThis.Peer). The host's device registers the peer id for its room code
// with a PeerJS matchmaking server; each player's device opens a direct data channel to
// it. After that, game messages travel peer to peer and each channel carries only
// its own player's messages.
//
// By default this uses the free public PeerJS server (0.peerjs.com) and its STUN/TURN
// servers. A `signal` option such as "localhost:9000" points at a self-run PeerServer,
// which the end-to-end tests use.

const PREFIX = 'sugi-avalon-';
export const peerIdFor = (room) => `${PREFIX}${room.toLowerCase()}`;

/** PeerJS options from a "host:port[/path]" string; empty means the public cloud server. */
export function signalOptions(signal) {
  const opts = { debug: 1 };
  if (!signal) return opts;
  const m = /^([^:/]+)(?::(\d+))?(\/.*)?$/.exec(signal);
  if (!m) return opts;
  const local = m[1] === 'localhost' || m[1] === '127.0.0.1';
  return {
    ...opts,
    host: m[1],
    port: Number(m[2] ?? (local ? 9000 : 443)),
    path: m[3] ?? '/',
    secure: !local,
    // A local server is for testing on one machine: no STUN/TURN needed.
    ...(local ? { config: { iceServers: [] } } : {}),
  };
}

function PeerClass() {
  if (!globalThis.Peer) throw new Error('PeerJS did not load.');
  return globalThis.Peer;
}

// PeerJS errors that mean "the matchmaking server is unreachable for now".
const NETWORK_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

/**
 * Host side: registers the room's peer id and accepts player connections.
 * onStatus: 'connecting' | 'ready' | 'offline' | 'room-taken' | 'error'.
 * With `retryTaken` (a host resuming after a reload) a taken id is retried, since the
 * server may still hold the old registration for a moment.
 */
export function peerHostTransport({ room, signal, retryTaken = false, onMessage, onClose, onStatus = () => {} }) {
  const Peer = PeerClass();
  const conns = new Map();
  let peer = null;
  let closed = false;
  let timer = null;
  let n = 0;
  let takenTries = 0;

  const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(() => !closed && fn(), ms); };

  function start() {
    onStatus('connecting');
    peer = new Peer(peerIdFor(room), signalOptions(signal));
    peer.on('open', () => { takenTries = 0; onStatus('ready'); });
    peer.on('connection', (dc) => {
      const id = `c${++n}`;
      conns.set(id, dc);
      dc.on('data', (msg) => onMessage(id, msg));
      dc.on('close', () => {
        if (conns.get(id) !== dc) return;
        conns.delete(id);
        onClose(id);
      });
      dc.on('error', () => {});
    });
    // Lost the matchmaking server; open data channels keep working meanwhile.
    peer.on('disconnected', () => {
      if (closed || peer.destroyed) return;
      onStatus('offline');
      later(() => peer.reconnect(), 2000);
    });
    peer.on('error', (e) => {
      if (closed) return;
      if (e.type === 'unavailable-id') {
        peer.destroy();
        if (retryTaken && takenTries++ < 15) {
          onStatus('connecting');
          later(start, 2000);
        } else {
          onStatus('room-taken');
        }
      } else if (NETWORK_ERRORS.has(e.type)) {
        onStatus('offline');
        if (peer.destroyed) later(start, 3000);
      } else {
        onStatus('error', e.type);
      }
    });
  }
  start();

  return {
    send(connId, msg) {
      const dc = conns.get(connId);
      if (dc?.open) dc.send(msg);
    },
    drop(connId) {
      const dc = conns.get(connId);
      conns.delete(connId);
      // Let a last message (e.g. "removed") go out before closing.
      if (dc) setTimeout(() => dc.close(), 500);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      peer?.destroy();
    },
  };
}

/**
 * Client side: connects to the room's host and keeps reconnecting until closed.
 * onStatus: 'connecting' | 'open' | 'no-host' | 'reconnecting' | 'offline'.
 */
export function peerClientTransport({ room, signal, onMessage, onOpen = () => {}, onStatus = () => {} }) {
  const Peer = PeerClass();
  let peer = null;
  let dc = null;
  let closed = false;
  let timer = null;
  let everOpen = false;

  const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(() => !closed && fn(), ms); };

  function startPeer() {
    peer = new Peer(signalOptions(signal));
    peer.on('open', connect);
    peer.on('disconnected', () => {
      if (closed || peer.destroyed) return;
      later(() => peer.reconnect(), 2000);
    });
    peer.on('error', (e) => {
      if (closed) return;
      if (e.type === 'peer-unavailable') {
        onStatus(everOpen ? 'reconnecting' : 'no-host');
        later(retry, 2000);
      } else if (NETWORK_ERRORS.has(e.type)) {
        onStatus('offline');
        later(retry, 3000);
      }
    });
  }

  function connect() {
    if (closed || dc?.open) return;
    if (dc) dc.close();
    onStatus(everOpen ? 'reconnecting' : 'connecting');
    const mine = peer.connect(peerIdFor(room), { serialization: 'json', reliable: true });
    dc = mine;
    let opened = false;
    mine.on('open', () => {
      opened = true;
      everOpen = true;
      onStatus('open');
      onOpen();
    });
    mine.on('data', (msg) => dc === mine && onMessage(msg));
    mine.on('close', () => {
      if (dc !== mine || closed) return;
      onStatus('reconnecting');
      later(retry, 1000);
    });
    mine.on('error', () => {});
    // Give up on a connection attempt that never opens.
    setTimeout(() => {
      if (!opened && dc === mine && !closed) retry();
    }, 12000);
  }

  function retry() {
    if (closed || dc?.open) return;
    if (!peer || peer.destroyed) startPeer();
    else if (peer.disconnected) peer.reconnect();
    else connect();
  }

  startPeer();

  return {
    send(msg) {
      if (dc?.open) dc.send(msg);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      peer?.destroy();
    },
    /** Call when the page becomes visible again: phones often drop connections while asleep. */
    reconnectNow() {
      if (!closed && !dc?.open) later(retry, 0);
    },
  };
}

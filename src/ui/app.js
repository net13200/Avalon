// The app controller: identity, hosting or joining a room, and UI events.
//
// URL parameters:
//   ?join=ABCD           prefill the room code (the link behind the lobby's QR code)
//   ?net=local           connect tabs with BroadcastChannel instead of WebRTC (dev table)
//   ?signal=host:port    use a self-run PeerJS server instead of the public one
//   ?room=ABCD[&host=1]&pid=…&name=…   join or host straight away (dev table, tests)

import { HostSession, C2H, H2C, PROTOCOL } from '../host.js';
import { ACTIONS } from '../game.js';
import { localHostTransport, localClientTransport } from '../net/local.js';
import { peerHostTransport, peerClientTransport } from '../net/peer.js';
import { CHARACTER_OPTIONS } from './text.js';
import { render, pickMode } from './render.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const LOCAL = params.get('net') === 'local';
const SIGNAL = params.get('signal') ?? '';

// ---------- storage (never throws) ----------

// Local mode keeps identity per tab, so each tab is its own player. On a phone the
// identity must survive closing the browser, so the game can be rejoined.
const backing = () => (LOCAL ? sessionStorage : localStorage);
const store = {
  get(key) {
    try { return JSON.parse(backing().getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { backing().setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  remove(key) {
    try { backing().removeItem(key); } catch { /* private mode */ }
  },
};

function randomId(bytes = 8) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// The player id is public (other players see it); the secret proves a device owns its seat.
// A ?pid= URL parameter overrides the stored id, which the dev table uses for its frames.
const pid = params.get('pid') ?? store.get('avalon.pid') ?? randomId();
if (!params.get('pid')) store.set('avalon.pid', pid);
const secretKey = `avalon.secret.${pid}`;
const secret = store.get(secretKey) ?? randomId(16);
store.set(secretKey, secret);

const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRoomCode = () => Array.from({ length: 4 },
  () => ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)]).join('');

/** The link other players open (or scan) to join this room. */
function joinLink(room) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', room);
  if (LOCAL) url.searchParams.set('net', 'local');
  if (SIGNAL) url.searchParams.set('signal', SIGNAL);
  return url.href;
}

// ---------- app state ----------

const app = {
  pid,
  name: params.get('name') ?? store.get('avalon.name') ?? '',
  joinCode: (params.get('join') ?? '').toUpperCase().slice(0, 4),
  room: null,
  isHost: false,
  joinLink: null,
  netStatus: null,
  lobby: null,
  view: null,
  picked: new Set(),
  revealing: false,
  toast: null,
  rejected: null,
  formError: null,
};

let conn = null; // { send(msg), close(), forget(), reconnectNow() }
let toastTimer = null;
const sessionKey = `avalon.session.${pid}`;
// A saved room is rejoined automatically on the next visit, but not days later.
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;
const saveSession = (room, host) => store.set(sessionKey, { room, host, at: Date.now() });

function update(changes = {}) {
  Object.assign(app, changes);
  root.innerHTML = render(app);
}

function showToast(text) {
  clearTimeout(toastTimer);
  update({ toast: text });
  toastTimer = setTimeout(() => update({ toast: null }), 3500);
}

// ---------- connecting ----------

function onHostMessage(msg) {
  switch (msg?.type) {
    case H2C.LOBBY:
      update({ lobby: msg.lobby, view: null, picked: new Set() });
      break;
    case H2C.VIEW: {
      const before = app.view;
      const turnChanged = !before || before.phase !== msg.view.phase
        || before.quest !== msg.view.quest || before.leader !== msg.view.leader;
      update({ lobby: msg.lobby, view: msg.view, picked: turnChanged ? new Set() : app.picked });
      break;
    }
    case H2C.ERROR:
      showToast(msg.message);
      break;
    case H2C.REJECTED:
      disconnect();
      store.remove(sessionKey);
      update({ rejected: msg.message, room: null, lobby: null, view: null });
      break;
  }
}

const hello = () => ({ type: C2H.HELLO, v: PROTOCOL, pid, secret, name: app.name });

/** Host a room. `resumed` means this device hosted it before (e.g. a reload). */
function hostRoom(room, resumed = false) {
  const snapKey = `avalon.host.${room}`;
  const SELF = '@self';
  let transport = null;
  const session = new HostSession({
    hostId: pid,
    saved: store.get(snapKey),
    send: (to, msg) => (to === SELF ? onHostMessage(msg) : transport.send(to, msg)),
    drop: (to) => transport.drop(to),
  });
  session.onChange = () => store.set(snapKey, session.snapshot());

  const onStatus = (status) => {
    if (status === 'room-taken') {
      // Another host already uses this code: pick a fresh one.
      transport.close();
      store.remove(snapKey);
      disconnect();
      return hostRoom(newRoomCode());
    }
    update({ netStatus: status });
  };
  const opts = {
    room,
    signal: SIGNAL,
    retryTaken: resumed,
    onMessage: (from, msg) => session.receive(from, msg),
    onClose: (from) => session.disconnected(from),
    onStatus,
  };
  transport = LOCAL ? localHostTransport(opts) : peerHostTransport(opts);

  conn = {
    send: (msg) => session.receive(SELF, msg),
    close: () => transport.close(),
    forget: () => { session.end(); store.remove(snapKey); },
    reconnectNow: () => {},
  };
  saveSession(room, true);
  update({ room, isHost: true, joinLink: joinLink(room), rejected: null, netStatus: 'connecting' });
  keepAwake();
  conn.send(hello());
}

function joinRoom(room) {
  let heard = false;
  let retry = null;
  const opts = {
    room,
    signal: SIGNAL,
    onMessage: (msg) => {
      heard = true;
      clearInterval(retry);
      onHostMessage(msg);
    },
    // Say hello on every (re)connection. Locally the host may not be open yet, so repeat.
    onOpen: () => {
      transport.send(hello());
      clearInterval(retry);
      if (LOCAL) retry = setInterval(() => (heard ? clearInterval(retry) : transport.send(hello())), 1500);
    },
    onStatus: (status) => update({ netStatus: status }),
  };
  const transport = LOCAL ? localClientTransport(opts) : peerClientTransport(opts);
  conn = {
    send: transport.send,
    close: () => { clearInterval(retry); transport.close(); },
    forget: () => {},
    reconnectNow: transport.reconnectNow,
  };
  saveSession(room, false);
  update({ room, isHost: false, joinLink: joinLink(room), rejected: null, netStatus: 'connecting' });
  keepAwake();
}

function disconnect() {
  conn?.close();
  conn = null;
  letSleep();
}

// ---------- keeping the screen on ----------

// A sleeping phone drops out of the game, and the host's phone runs it, so keep the
// screen on while in a room. Browsers release the lock when the page is hidden.
let wakeLock = null;
let wantAwake = false;

async function keepAwake() {
  wantAwake = true;
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    if (!wantAwake) letSleep();
  } catch {
    wakeLock = null; // not allowed (e.g. battery saver); the game still works
  }
}

function letSleep() {
  wantAwake = false;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function leave() {
  conn?.send({ type: C2H.LEAVE });
  conn?.forget();
  // Give the goodbye a moment to leave before the connection closes.
  const closing = conn;
  conn = null;
  setTimeout(() => closing?.close(), 300);
  letSleep();
  store.remove(sessionKey);
  update({ room: null, lobby: null, view: null, rejected: null, netStatus: null, picked: new Set() });
}

const act = (action) => conn?.send({ type: C2H.ACTION, action });

// ---------- events ----------

function readHomeForm() {
  const form = root.querySelector('[data-form=home]');
  const name = form.name.value.trim();
  const code = form.code.value.trim().toUpperCase();
  app.name = name;
  app.joinCode = code;
  store.set('avalon.name', name);
  return { name, code };
}

async function shareLink() {
  const url = app.joinLink;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Join my Avalon game', text: `Room ${app.room}`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('Link copied.');
  } catch (e) {
    if (e?.name !== 'AbortError') showToast(url);
  }
}

function onAction(el) {
  const { act: what, id } = el.dataset;
  switch (what) {
    case 'host': {
      const { name } = readHomeForm();
      if (!name) return update({ formError: 'Enter your name first.' });
      update({ formError: null });
      return hostRoom(newRoomCode());
    }
    case 'join': {
      const { name, code } = readHomeForm();
      if (!name) return update({ formError: 'Enter your name first.' });
      if (!/^[A-Z]{4}$/.test(code)) return update({ formError: 'Room codes are 4 letters.' });
      update({ formError: null });
      return joinRoom(code);
    }
    case 'leave': return leave();
    case 'share': return shareLink();
    case 'seat-up': return conn.send({ type: C2H.MOVE_SEAT, playerId: id, delta: -1 });
    case 'seat-down': return conn.send({ type: C2H.MOVE_SEAT, playerId: id, delta: 1 });
    case 'kick': return conn.send({ type: C2H.KICK, playerId: id });
    case 'start': return conn.send({ type: C2H.START });
    case 'new-game': return conn.send({ type: C2H.NEW_GAME });
    case 'pick': {
      const mode = pickMode(app.view, pid);
      if (!mode) return undefined;
      const picked = new Set(app.picked);
      if (picked.has(id)) picked.delete(id);
      else if (mode.max === 1) { picked.clear(); picked.add(id); }
      else if (picked.size < mode.max) picked.add(id);
      return update({ picked });
    }
    case 'propose': {
      const team = app.view.players.map((p) => p.id).filter((p) => app.picked.has(p));
      return act({ type: ACTIONS.PROPOSE_TEAM, team });
    }
    case 'vote': return act({ type: ACTIONS.VOTE, approve: id === 'yes' });
    case 'quest': return act({ type: ACTIONS.PLAY_QUEST_CARD, success: id === 'success' });
    case 'lady-examine': return act({ type: ACTIONS.LADY_EXAMINE, targetId: [...app.picked][0] });
    case 'assassinate': return act({ type: ACTIONS.ASSASSINATE, targetId: [...app.picked][0] });
    default: return undefined;
  }
}

function onToggle(el) {
  const { lobby } = app;
  if (el.dataset.act === 'lady') {
    return conn.send({ type: C2H.SET_OPTIONS, options: { ladyOfTheLake: el.checked } });
  }
  if (el.dataset.act !== 'character') return undefined;
  const on = new Set(CHARACTER_OPTIONS.filter((c) => c.roles.every((r) => lobby.options.roles.includes(r))).map((c) => c.key));
  if (el.checked) on.add(el.dataset.id); else on.delete(el.dataset.id);
  // Percival and Morgana need Merlin.
  for (const c of CHARACTER_OPTIONS) if (c.needs && !on.has(c.needs)) on.delete(c.key);
  const roles = CHARACTER_OPTIONS.filter((c) => on.has(c.key)).flatMap((c) => c.roles);
  return conn.send({ type: C2H.SET_OPTIONS, options: { roles } });
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.matches('input')) return;
  if (el.dataset.act === 'reveal') return;
  e.preventDefault();
  onAction(el);
});
root.addEventListener('submit', (e) => {
  e.preventDefault();
  onAction({ dataset: { act: 'join' } });
});
root.addEventListener('change', (e) => {
  if (e.target.matches('input[type=checkbox][data-act]')) onToggle(e.target);
});

// Hold to reveal: the role shows only while the button is pressed.
const hide = () => app.revealing && update({ revealing: false });
root.addEventListener('pointerdown', (e) => {
  if (e.target.closest('[data-act=reveal]')) {
    e.preventDefault();
    update({ revealing: true });
  }
});
for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, hide);
root.addEventListener('contextmenu', (e) => app.revealing && e.preventDefault());
root.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('[data-act=reveal]')) {
    e.preventDefault();
    if (!app.revealing) update({ revealing: true });
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') hide();
});

// Phones drop connections while asleep; reconnect as soon as the page is visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    conn?.reconnectNow();
    if (wantAwake) keepAwake();
  } else {
    hide();
  }
});

// The host's page runs the game: ask before closing it mid-game.
window.addEventListener('beforeunload', (e) => {
  if (app.isHost && app.view && app.view.phase !== 'GAME_OVER') e.preventDefault();
});

// Offline install and fast loading. Skipped on localhost so edits show up immediately.
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && params.get('sw') !== '0') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Local mode has no connection events, so say goodbye explicitly.
window.addEventListener('pagehide', () => LOCAL && conn?.send({ type: C2H.BYE }));

// ---------- start ----------

const stored = store.get(sessionKey);
const saved = stored && Date.now() - (stored.at ?? 0) < SESSION_MAX_AGE ? stored : null;
if (params.get('room')) {
  const room = params.get('room').toUpperCase();
  if (params.get('host') === '1') hostRoom(room, Boolean(saved?.host && saved.room === room));
  else joinRoom(room);
} else if (saved?.room) {
  if (saved.host) hostRoom(saved.room, true); else joinRoom(saved.room);
} else {
  update();
}

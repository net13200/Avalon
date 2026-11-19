// The app controller: identity, hosting or joining a room, and UI events.

import { HostSession, C2H, H2C } from '../host.js';
import { ACTIONS } from '../game.js';
import { localHostTransport, localClientTransport } from '../net/local.js';
import { CHARACTER_OPTIONS } from './text.js';
import { render, pickMode } from './render.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);

// ---------- storage (never throws) ----------

const store = {
  get(key) {
    try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch { /* private mode */ }
  },
};

function randomId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Local test mode keeps identity per tab (sessionStorage), so each tab is its own player.
// A ?pid= URL parameter overrides it, which the dev table uses for its iframes.
const pid = params.get('pid') ?? store.get('avalon.pid') ?? randomId();
if (!params.get('pid')) store.set('avalon.pid', pid);

const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRoomCode = () => Array.from({ length: 4 },
  () => ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)]).join('');

// ---------- app state ----------

const app = {
  pid,
  name: params.get('name') ?? store.get('avalon.name') ?? '',
  room: null,
  lobby: null,
  view: null,
  picked: new Set(),
  revealing: false,
  toast: null,
  rejected: null,
  formError: null,
};

let conn = null; // { send(msg), close() }
let toastTimer = null;
const sessionKey = `avalon.session.${pid}`;

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
  switch (msg.type) {
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

function hostRoom(room) {
  const snapKey = `avalon.host.${room}`;
  const session = new HostSession({
    hostId: pid,
    saved: store.get(snapKey),
    send: (to, msg) => (to === pid ? onHostMessage(msg) : transport.send(to, msg)),
  });
  const transport = localHostTransport(room, (from, msg) => session.receive(from, msg));
  session.onChange = () => store.set(snapKey, session.snapshot());
  conn = {
    send: (msg) => session.receive(pid, msg),
    close: () => transport.close(),
    forget: () => store.remove(snapKey),
  };
  store.set(sessionKey, { room, host: true });
  update({ room, rejected: null });
  conn.send({ type: C2H.HELLO, name: app.name });
}

function joinRoom(room) {
  let heard = false;
  const transport = localClientTransport(room, pid, (msg) => {
    heard = true;
    onHostMessage(msg);
  });
  // Keep saying hello until the host answers; it may not be open yet.
  const hello = () => transport.send({ type: C2H.HELLO, name: app.name });
  const retry = setInterval(() => (heard ? clearInterval(retry) : hello()), 1500);
  conn = {
    send: transport.send,
    close: () => { clearInterval(retry); transport.close(); },
    forget: () => {},
  };
  store.set(sessionKey, { room, host: false });
  update({ room, rejected: null });
  hello();
}

function disconnect() {
  conn?.close();
  conn = null;
}

function leave() {
  conn?.send({ type: C2H.LEAVE });
  conn?.forget();
  disconnect();
  store.remove(sessionKey);
  update({ room: null, lobby: null, view: null, rejected: null, picked: new Set() });
}

const act = (action) => conn?.send({ type: C2H.ACTION, action });

// ---------- events ----------

function readHomeForm() {
  const form = root.querySelector('[data-form=home]');
  const name = form.name.value.trim();
  const code = form.code.value.trim().toUpperCase();
  app.name = name;
  store.set('avalon.name', name);
  return { name, code };
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
    case 'seat-up': return conn.send({ type: C2H.MOVE_SEAT, playerId: id, delta: -1 });
    case 'seat-down': return conn.send({ type: C2H.MOVE_SEAT, playerId: id, delta: 1 });
    case 'kick': return conn.send({ type: C2H.KICK, playerId: id });
    case 'start': return conn.send({ type: C2H.START });
    case 'new-game': return conn.send({ type: C2H.NEW_GAME });
    case 'pick': {
      const mode = pickMode(app.view, pid);
      if (!mode) return;
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
  }
}

function onToggle(el) {
  const { lobby } = app;
  if (el.dataset.act === 'lady') {
    return conn.send({ type: C2H.SET_OPTIONS, options: { ladyOfTheLake: el.checked } });
  }
  if (el.dataset.act !== 'character') return;
  const on = new Set(CHARACTER_OPTIONS.filter((c) => c.roles.every((r) => lobby.options.roles.includes(r))).map((c) => c.key));
  if (el.checked) on.add(el.dataset.id); else on.delete(el.dataset.id);
  // Percival and Morgana need Merlin.
  for (const c of CHARACTER_OPTIONS) if (c.needs && !on.has(c.needs)) on.delete(c.key);
  const roles = CHARACTER_OPTIONS.filter((c) => on.has(c.key)).flatMap((c) => c.roles);
  conn.send({ type: C2H.SET_OPTIONS, options: { roles } });
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

// Tell the host when this device goes away; it rejoins with the same id.
window.addEventListener('pagehide', () => conn?.send({ type: C2H.BYE }));

// ---------- start ----------

const saved = store.get(sessionKey);
if (params.get('room')) {
  // Dev table and shared links: ?room=ABCD[&host=1]&name=…
  const room = params.get('room').toUpperCase();
  if (params.get('host') === '1') hostRoom(room); else joinRoom(room);
} else if (saved?.room) {
  if (saved.host) hostRoom(saved.room); else joinRoom(saved.room);
} else {
  update();
}

// Turns the app state into HTML. Pure functions; event handling lives in app.js.
// Buttons carry data-act (and data-id) attributes that app.js dispatches on.

import { ROLES, EVIL_COUNT, MIN_PLAYERS, MAX_PLAYERS, QUEST_SIZES } from '../rules.js';
import { ROLE_TEXT, CHARACTER_OPTIONS, WIN_TEXT, PHASE_TITLE } from './text.js';
import { emblem, icon } from './art.js';
import { qrcode } from '../../vendor/qrcode.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

const HOST_STATUS = {
  connecting: 'Connecting to the matchmaking server…',
  offline: "Can't reach the matchmaking server, so new players can't join right now. Connected players can keep playing.",
  error: 'Connection problem. Try leaving and hosting again.',
};
const CLIENT_STATUS = {
  connecting: 'Connecting…',
  'no-host': "Can't find this room yet. Check the code, and that the host's screen is on.",
  reconnecting: 'Lost the host. Reconnecting…',
  offline: 'No connection. Check your internet. Retrying…',
};

/** A connection warning, or nothing when all is well. */
function statusLine(app, always = false) {
  const text = (app.isHost ? HOST_STATUS : CLIENT_STATUS)[app.netStatus];
  if (!text) return '';
  return `<p class="status ${always ? 'plain' : ''}" role="status">${esc(text)}</p>`;
}

export function render(app) {
  return screen(app) + sheet(app);
}

function screen(app) {
  if (app.rejected) return rejectedScreen(app);
  if (!app.room) return homeScreen(app);
  if (app.view) return gameScreen(app);
  if (app.lobby) return lobbyScreen(app);
  return connectingScreen(app);
}

/** Header buttons: history (in a game), rules and sound. */
function tools(app, { history = false } = {}) {
  return `
    <span class="tools">
      ${history ? `<button class="icon-btn" data-act="sheet" data-id="history" aria-label="Game history" title="Game history">${icon('history')}</button>` : ''}
      <button class="icon-btn" data-act="sheet" data-id="rules" aria-label="How to play" title="How to play">${icon('rules')}</button>
      <button class="icon-btn" data-act="mute" aria-label="${app.muted ? 'Turn sound on' : 'Turn sound off'}" aria-pressed="${!app.muted}"
        title="${app.muted ? 'Sound off' : 'Sound on'}">${icon(app.muted ? 'sound-off' : 'sound-on')}</button>
    </span>`;
}

// ---------- home ----------

function homeScreen(app) {
  return `
  <main class="screen home">
    <header class="hero">
      <img class="crest" src="icon.svg" alt="" width="96" height="96" />
      <h1>Avalon</h1>
      <p class="tagline">Loyalty, deceit and quests: one phone per player.</p>
    </header>
    <form class="card stack" data-form="home">
      <label class="field">
        <span>Your name</span>
        <input name="name" maxlength="20" autocomplete="nickname" required value="${esc(app.name)}" />
      </label>
      ${app.joinCode ? '' : `<button class="btn primary" data-act="host" type="button">Host a new game</button>
      <div class="or"><span>or join one</span></div>`}
      <div class="row">
        <input name="code" class="code-input" maxlength="4" placeholder="CODE" autocapitalize="characters"
          autocomplete="off" aria-label="Room code" value="${esc(app.joinCode ?? '')}" />
        <button class="btn ${app.joinCode ? 'primary' : ''}" data-act="join" type="submit">Join</button>
      </div>
      ${app.formError ? `<p class="error" role="alert">${esc(app.formError)}</p>` : ''}
    </form>
    <button class="btn ghost small center-self" data-act="sheet" data-id="rules">How to play</button>
    ${app.joinCode ? '<p class="fineprint"><a href="?">Host a game instead</a></p>' : `
    <p class="fineprint">Everyone plays on their own phone. One player hosts and keeps the app open;
      the others join with the room code or by scanning the host's QR code.</p>`}
  </main>`;
}

function connectingScreen(app) {
  return `
  <main class="screen center">
    <div class="spinner" aria-hidden="true"></div>
    <p>${app.isHost ? 'Opening room' : 'Looking for room'} <strong class="code">${esc(app.room)}</strong>…</p>
    ${statusLine(app, true)}
    <button class="btn ghost" data-act="leave">Cancel</button>
  </main>`;
}

function rejectedScreen(app) {
  return `
  <main class="screen center">
    <h2>Not connected</h2>
    <p>${esc(app.rejected)}</p>
    <button class="btn primary" data-act="leave">Back</button>
  </main>`;
}

// ---------- lobby ----------

function lobbyScreen(app) {
  const { lobby } = app;
  const isHost = lobby.hostId === app.pid;
  const n = lobby.players.length;
  const roles = lobby.options.roles;

  const players = lobby.players.map((p, i) => `
    <li class="player ${p.connected ? '' : 'offline'}">
      <span class="seat">${i + 1}</span>
      <span class="name">${esc(p.name)}${p.id === app.pid ? ' <em>(you)</em>' : ''}${p.id === lobby.hostId ? ' <span class="chip">host</span>' : ''}</span>
      ${isHost ? `
        <span class="seat-tools">
          <button class="icon" data-act="seat-up" data-id="${p.id}" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon" data-act="seat-down" data-id="${p.id}" aria-label="Move ${esc(p.name)} down" ${i === n - 1 ? 'disabled' : ''}>▼</button>
          ${p.id !== lobby.hostId ? `<button class="icon" data-act="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
        </span>` : ''}
    </li>`).join('');

  const characters = CHARACTER_OPTIONS.map((c) => {
    const on = c.roles.every((r) => roles.includes(r));
    const blocked = c.needs && !roles.includes(c.needs);
    return `
      <label class="toggle ${blocked ? 'blocked' : ''}">
        <input type="checkbox" data-act="character" data-id="${c.key}" ${on ? 'checked' : ''} ${isHost && !blocked ? '' : 'disabled'} />
        <span class="emblems">${c.roles.map((r) => emblem(r, 26, ROLES[r].side)).join('')}</span>
        <span><strong>${c.label}</strong><small>${c.hint}</small></span>
      </label>`;
  }).join('');

  const evil = EVIL_COUNT[Math.min(Math.max(n, MIN_PLAYERS), MAX_PLAYERS)];
  return `
  <main class="screen">
    <header class="bar">
      <button class="btn ghost small" data-act="leave">Leave</button>
      <span>Room <strong class="code">${esc(app.room)}</strong></span>
      ${tools(app)}
    </header>
    ${statusLine(app)}
    <section class="card join-card">
      <p class="muted center-text">Players join with this code</p>
      <p class="big-code">${esc(app.room)}</p>
      ${isHost && !lobby.inGame ? `
        <div class="qr" aria-label="QR code to join room ${esc(app.room)}">${qrSvg(app.joinLink)}</div>
        <button class="btn small" data-act="share">Share the link</button>` : ''}
    </section>
    <section class="card">
      <h2>Players <span class="muted">${n}/${MAX_PLAYERS}</span></h2>
      <p class="muted small">Seat order is the order the leader passes in. ${isHost ? 'Match it to where people sit.' : ''}</p>
      <ol class="players">${players}</ol>
      ${n >= MIN_PLAYERS ? `<p class="muted small">${n - evil} good, ${evil} evil.</p>` : ''}
    </section>
    <section class="card">
      <h2>Characters</h2>
      <div class="toggles">
        ${characters}
        <label class="toggle">
          <input type="checkbox" data-act="lady" ${lobby.options.ladyOfTheLake ? 'checked' : ''} ${isHost ? '' : 'disabled'} />
          <span><strong>Lady of the Lake</strong><small>After quests 2–4 the holder secretly checks a player's loyalty. Best with 7+.</small></span>
        </label>
      </div>
    </section>
    ${isHost ? `
      ${lobby.setupError ? `<p class="muted center-text">${esc(lobby.setupError)}</p>` : ''}
      <button class="btn primary wide" data-act="start" ${lobby.canStart ? '' : 'disabled'}>Start the game</button>
    ` : '<p class="muted center-text">Waiting for the host to start…</p>'}
    ${toast(app)}
  </main>`;
}

// ---------- game ----------

function gameScreen(app) {
  const { view } = app;
  return `
  <main class="screen game phase-${view.phase.toLowerCase()}">
    <header class="bar">
      <span class="code">${esc(app.room)}</span>
      <span>${view.phase === 'GAME_OVER' ? 'Game over' : `Quest ${view.quest + 1} of 5`}</span>
      ${tools(app, { history: true })}
    </header>
    ${statusLine(app)}
    ${questTrack(view, app.fresh)}
    ${view.phase === 'GAME_OVER' ? gameOver(app) : phaseCard(app)}
    ${playerList(app)}
    ${lastVote(view, app.fresh)}
    ${view.phase === 'GAME_OVER' ? '' : roleButton(app)}
    ${app.revealing ? roleOverlay(app) : ''}
    ${toast(app)}
  </main>`;
}

const names = (view) => {
  const m = Object.fromEntries(view.players.map((p) => [p.id, p.name]));
  return (id) => m[id] ?? '?';
};
const nameList = (view, ids) => ids.map((id) => `<strong>${esc(names(view)(id))}</strong>`).join(', ');

function questTrack(view, fresh = {}) {
  const tokens = view.questSizes.map((size, q) => {
    const result = view.questResults[q];
    const cls = result ? (result.success ? 'success' : 'fail') : q === view.quest ? 'current' : '';
    const label = result
      ? `Quest ${q + 1}: ${result.success ? 'succeeded' : 'failed'} with ${plural(result.fails, 'fail')}`
      : `Quest ${q + 1}: team of ${size}${view.failsRequired[q] > 1 ? ', needs 2 fails to fail' : ''}`;
    return `
      <li class="quest ${cls} ${fresh.quest === q ? 'fresh' : ''}" title="${label}" aria-label="${label}">
        <span class="size">${result ? (result.success ? '✓' : '✗') : size}</span>
        ${view.failsRequired[q] > 1 ? '<span class="two">2 fails</span>' : ''}
      </li>`;
  }).join('');
  const dots = Array.from({ length: 5 }, (_, i) =>
    `<span class="dot ${i < view.rejections ? 'on' : ''} ${i === 4 ? 'last' : ''}"></span>`).join('');
  return `
    <section class="track">
      <ol class="quests">${tokens}</ol>
      <div class="rejects" aria-label="${view.rejections} of 5 teams rejected in a row">
        <span class="muted small">Rejected</span>${dots}
      </div>
    </section>`;
}

function phaseCard(app) {
  const { view, pid } = app;
  const name = names(view);
  const size = view.questSizes[view.quest];
  const waitingOn = view.awaiting.includes(pid);
  let body = '';

  // Announce the quest that just finished until the next team is proposed.
  const justDone = view.questResults.at(-1);
  const lastVote = view.history.at(-1);
  if (justDone && ['TEAM_BUILD', 'LADY', 'ASSASSINATION'].includes(view.phase)
      && lastVote?.approved && lastVote.quest === justDone.quest) {
    body += `<p class="announce ${justDone.success ? 'good' : 'evil'} ${app.fresh?.quest === justDone.quest ? 'fresh' : ''}">Quest ${justDone.quest + 1}
      ${justDone.success ? 'succeeded' : 'failed'}: ${plural(justDone.fails, 'Fail card')}.</p>`;
  }

  switch (view.phase) {
    case 'TEAM_BUILD':
      if (view.leader === pid) {
        const picked = app.picked.size;
        body += `
          <p>You lead. Pick <strong>${size}</strong> players for the quest, then propose the team.</p>
          ${view.failsRequired[view.quest] > 1 ? '<p class="muted small">This quest fails only with 2 or more Fail cards.</p>' : ''}
          <button class="btn primary wide" data-act="propose" ${picked === size ? '' : 'disabled'}>
            Propose team (${picked}/${size})
          </button>`;
      } else {
        body += `<p><strong>${esc(name(view.leader))}</strong> is choosing a team of ${size}.</p>
          <p class="muted small">Discuss who should go.</p>`;
      }
      break;

    case 'TEAM_VOTE':
      body += `<p>${esc(name(view.leader))} proposes: ${nameList(view, view.team)}</p>`;
      if (view.me.myVote === null) {
        body += `
          ${view.rejections === 4 ? '<p class="warn">If this team is rejected, evil wins.</p>' : ''}
          <div class="row two">
            <button class="btn approve" data-act="vote" data-id="yes">Approve</button>
            <button class="btn reject" data-act="vote" data-id="no">Reject</button>
          </div>`;
      } else {
        body += `<p class="muted">You voted <strong>${view.me.myVote ? 'Approve' : 'Reject'}</strong>. Waiting for ${plural(view.awaiting.length, 'more vote')}.</p>`;
      }
      break;

    case 'QUEST':
      body += `<p>The team: ${nameList(view, view.team)}</p>`;
      if (view.team.includes(pid) && view.me.myQuestCard === null) {
        body += `
          <p class="muted small">Your card is secret. Only the number of Fail cards is revealed.</p>
          <div class="row two">
            <button class="btn approve" data-act="quest" data-id="success">Success</button>
            <button class="btn reject" data-act="quest" data-id="fail" ${view.me.canFail ? '' : 'disabled title="Loyal servants of Arthur must play Success"'}>Fail</button>
          </div>`;
      } else if (view.team.includes(pid)) {
        body += `<p class="muted">Card played. Waiting for ${plural(view.awaiting.length, 'more card')}.</p>`;
      } else {
        body += `<p class="muted">Waiting for ${plural(view.awaiting.length, 'more card')}.</p>`;
      }
      break;

    case 'LADY':
      if (view.lady.holder === pid) {
        body += `<p>Choose a player to examine. Only you will learn their loyalty.</p>
          <button class="btn primary wide" data-act="lady-examine" ${app.picked.size === 1 ? '' : 'disabled'}>Examine</button>`;
      } else {
        body += `<p><strong>${esc(name(view.lady.holder))}</strong> holds the Lady of the Lake and is choosing who to examine.</p>`;
      }
      break;

    case 'ASSASSINATION':
      if (waitingOn) {
        body += `<p>Good completed three quests. Name Merlin to win for evil. Talk it over with your team first.</p>
          <button class="btn reject wide" data-act="assassinate" ${app.picked.size === 1 ? '' : 'disabled'}>Assassinate</button>`;
      } else if (view.me.side === 'evil') {
        body += '<p>Good completed three quests. Help the Assassin find Merlin.</p>';
      } else {
        body += '<p>Good completed three quests! The Assassin now tries to find Merlin. Stay calm.</p>';
      }
      break;
  }
  return `
    <section class="card phase ${waitingOn ? 'your-turn' : ''}" aria-live="polite">
      <h2>${PHASE_TITLE[view.phase]}${waitingOn ? ' <span class="chip turn">your turn</span>' : ''}</h2>
      ${body}
    </section>`;
}

/** Which players the current player may tap to select right now, and how many. */
export function pickMode(view, pid) {
  if (!view) return null;
  if (view.phase === 'TEAM_BUILD' && view.leader === pid) {
    return { max: view.questSizes[view.quest], allowed: view.players.map((p) => p.id) };
  }
  if (view.phase === 'LADY' && view.lady.holder === pid) return { max: 1, allowed: view.lady.targets };
  if (view.phase === 'ASSASSINATION' && view.awaiting.includes(pid)) {
    return { max: 1, allowed: view.players.map((p) => p.id).filter((id) => id !== pid) };
  }
  return null;
}

function playerList(app) {
  const { view, pid, lobby } = app;
  const mode = pickMode(view, pid);
  const connected = Object.fromEntries((lobby?.players ?? []).map((p) => [p.id, p.connected]));
  const over = view.phase === 'GAME_OVER';

  const rows = view.players.map((p, i) => {
    const chips = [];
    if (over) {
      const role = view.roles[p.id];
      chips.push(`<span class="chip role ${ROLES[role].side}">${emblem(role, 14)}${ROLES[role].name}</span>`);
    } else {
      if (p.id === view.leader) chips.push('<span class="chip leader">leader</span>');
      if (view.team.includes(p.id)) chips.push('<span class="chip team">team</span>');
      if (view.phase === 'TEAM_VOTE' && view.voted.includes(p.id)) chips.push('<span class="chip done">voted</span>');
      if (view.phase === 'QUEST' && view.played.includes(p.id)) chips.push('<span class="chip done">played</span>');
    }
    if (view.lady?.holder === p.id) chips.push('<span class="chip lady">lady</span>');
    if (connected[p.id] === false) chips.push('<span class="chip offline">offline</span>');

    const selectable = mode?.allowed.includes(p.id);
    const selected = app.picked.has(p.id);
    const tag = selectable ? 'button' : 'div';
    return `
      <li>
        <${tag} class="player ${selectable ? 'pickable' : ''} ${selected ? 'picked' : ''} ${p.id === pid ? 'self' : ''}"
          ${selectable ? `data-act="pick" data-id="${p.id}" aria-pressed="${selected}"` : ''}>
          <span class="seat">${i + 1}</span>
          <span class="name">${esc(p.name)}${p.id === pid ? ' <em>(you)</em>' : ''}</span>
          <span class="chips">${chips.join('')}</span>
        </${tag}>
      </li>`;
  }).join('');

  return `<section class="card"><ol class="players">${rows}</ol></section>`;
}

function lastVote(view, fresh = {}) {
  const last = view.history.at(-1);
  if (!last) return '';
  const name = names(view);
  const votes = view.players.map((p) =>
    `<li class="${last.votes[p.id] ? 'yes' : 'no'}"><span>${esc(p.name)}</span><span>${last.votes[p.id] ? 'Approve' : 'Reject'}</span></li>`).join('');
  const outcome = last.approved
    ? (last.fails === undefined ? 'Approved' : `Approved: quest ${last.fails < view.failsRequired[last.quest] ? 'succeeded' : 'failed'} with ${plural(last.fails, 'Fail card')}`)
    : 'Rejected';
  return `
    <details class="card last-vote ${fresh.vote === view.history.length - 1 ? 'fresh' : ''}" ${fresh.vote === view.history.length - 1 ? 'open' : ''}>
      <summary>Last vote: <strong>${outcome}</strong></summary>
      <p class="small">Quest ${last.quest + 1}, led by ${esc(name(last.leader))}: ${nameList(view, last.team)}</p>
      <ul class="votes">${votes}</ul>
      <button class="btn small" data-act="sheet" data-id="history">Full history (${plural(view.history.length, 'vote')})</button>
    </details>`;
}

function roleButton(app) {
  return `
    <div class="role-dock">
      <button class="btn role-btn ${app.roleSeen ? '' : 'pulse'}" data-act="reveal">${app.roleSeen ? 'Hold to see your role' : 'Hold here to see your secret role'}</button>
    </div>`;
}

function roleOverlay(app) {
  const { view } = app;
  const { me } = view;
  const name = names(view);
  const roles = view.options.roles;
  let knows = '';
  if (me.role === 'merlin') {
    knows = `<p>Evil: ${nameList(view, me.knows.map((k) => k.id)) || 'no one'}</p>
      ${roles.includes('mordred') ? '<p class="muted small">Mordred is evil but hidden from you.</p>' : ''}`;
  } else if (me.role === 'percival') {
    knows = me.knows.length > 1
      ? `<p>Merlin and Morgana: ${nameList(view, me.knows.map((k) => k.id))}. You don't know which is which.</p>`
      : `<p>Merlin: ${nameList(view, me.knows.map((k) => k.id))}</p>`;
  } else if (me.side === 'evil' && me.role !== 'oberon') {
    knows = `<p>Your evil allies: ${nameList(view, me.knows.map((k) => k.id)) || 'none'}</p>
      ${roles.includes('oberon') ? '<p class="muted small">Oberon is also evil, but you do not know who.</p>' : ''}`;
  }
  const lady = me.ladyFindings.map((f) =>
    `<p>Lady of the Lake: <strong>${esc(name(f.target))}</strong> is <strong class="${f.side}">${f.side}</strong>.</p>`).join('');
  return `
    <div class="overlay" role="dialog" aria-label="Your role">
      <div class="role-card ${me.side}">
        ${emblem(me.role, 88)}
        <p class="side">${me.side === 'good' ? 'Loyal to Arthur' : 'Minion of Mordred'}</p>
        <h2>${me.roleName}</h2>
        <p>${ROLE_TEXT[me.role]}</p>
        ${knows}
        ${lady}
        <p class="muted small">Release to hide</p>
      </div>
    </div>`;
}

function gameOver(app) {
  const { view, pid, lobby } = app;
  const name = names(view);
  const won = view.winner === view.me.side;
  const isHost = lobby?.hostId === pid;
  const findings = view.lady?.examinations ?? [];
  return `
    <section class="card phase over ${view.winner}">
      <h2>${view.winner === 'good' ? 'Good wins' : 'Evil wins'}</h2>
      <p>${WIN_TEXT[view.winReason]}</p>
      ${view.assassinTarget ? `<p>The Assassin named <strong>${esc(name(view.assassinTarget))}</strong>.</p>` : ''}
      <p class="result">${won ? 'You won!' : 'You lost.'}</p>
      ${findings.length ? `<p class="muted small">Lady of the Lake: ${findings.map((f) => `${esc(name(f.holder))} examined ${esc(name(f.target))}`).join('; ')}.</p>` : ''}
      <button class="btn wide" data-act="sheet" data-id="history">See the whole game</button>
      ${isHost ? '<button class="btn primary wide" data-act="new-game">Back to the lobby</button>' : '<p class="muted small">The host can start a new game.</p>'}
    </section>`;
}

function toast(app) {
  return app.toast ? `<div class="toast" role="alert">${esc(app.toast)}</div>` : '';
}

// ---------- sheets: history and rules ----------

function sheet(app) {
  if (!app.sheet) return '';
  const content = app.sheet === 'history' && app.view ? historySheet(app) : rulesSheet(app);
  const title = app.sheet === 'history' && app.view ? 'Game history' : 'How to play';
  return `
    <div class="sheet-backdrop" data-act="close-sheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="sheet-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon('close')}</button>
      </header>
      <div class="sheet-body">${content}</div>
    </section>`;
}

function historySheet(app) {
  const { view } = app;
  const name = names(view);
  const examinations = view.lady?.examinations ?? [];
  const quests = [];
  for (let q = 0; q <= Math.min(view.quest, 4); q++) {
    const proposals = view.history.filter((h) => h.quest === q);
    const result = view.questResults[q];
    if (!proposals.length && !result && q !== view.quest) continue;
    const status = result
      ? `<span class="chip ${result.success ? 'ok' : 'bad'}">${result.success ? 'Succeeded' : 'Failed'}: ${plural(result.fails, 'Fail card')}</span>`
      : view.phase === 'GAME_OVER' ? '' : '<span class="chip">in progress</span>';
    const items = proposals.map((h, i) => {
      const yes = view.players.filter((p) => h.votes[p.id]);
      const no = view.players.filter((p) => !h.votes[p.id]);
      return `
        <li class="proposal ${h.approved ? 'approved' : 'rejected'}">
          <p><strong>${esc(name(h.leader))}</strong> proposed ${nameList(view, h.team)}
            <span class="verdict">${h.approved ? 'Approved' : 'Rejected'} ${yes.length}–${no.length}</span></p>
          <p class="small"><span class="yes">Approve:</span> ${yes.map((p) => esc(p.name)).join(', ') || 'no one'}</p>
          <p class="small"><span class="no">Reject:</span> ${no.map((p) => esc(p.name)).join(', ') || 'no one'}</p>
        </li>`;
    }).join('');
    const lady = examinations.filter((e) => e.quest === q)
      .map((e) => `<p class="small lady-note">Lady of the Lake: ${esc(name(e.holder))} examined ${esc(name(e.target))}.</p>`).join('');
    quests.push(`
      <section class="quest-log">
        <h3>Quest ${q + 1} <span class="muted small">team of ${view.questSizes[q]}${view.failsRequired[q] > 1 ? ', 2 fails needed' : ''}</span> ${status}</h3>
        ${items ? `<ol class="proposals">${items}</ol>` : '<p class="muted small">No team proposed yet.</p>'}
        ${lady}
      </section>`);
  }
  return quests.join('') || '<p class="muted">Nothing has happened yet.</p>';
}

function rulesSheet(app) {
  const n = app.view?.players.length ?? app.lobby?.players.length ?? 0;
  const counts = n >= MIN_PLAYERS && n <= MAX_PLAYERS ? [n] : [5, 6, 7, 8, 9, 10];
  const sizes = counts.map((c) => `
    <tr><th>${c}</th><td>${c - EVIL_COUNT[c]} / ${EVIL_COUNT[c]}</td>${QUEST_SIZES[c].map((k, q) => `<td>${k}${q === 3 && c >= 7 ? '*' : ''}</td>`).join('')}</tr>`).join('');
  const role = (r, text) => `<li>${emblem(r, 28, ROLES[r].side)}<span><strong>${ROLES[r].name}</strong>: ${text}</span></li>`;
  return `
    <p>Good and evil players hide among each other. Good wins by completing <strong>3 quests</strong>; evil wins by failing 3, or if <strong>5 teams in a row</strong> are rejected.</p>
    <h3>Each round</h3>
    <ol class="steps">
      <li>The <strong>leader</strong> picks a team of the size shown on the quest track.</li>
      <li><strong>Everyone votes</strong> to approve or reject the team. Votes are revealed together; a tie rejects. If it's rejected, the next player leads.</li>
      <li>An approved team goes on the <strong>quest</strong>: each member secretly plays Success or Fail. Good players must play Success. One Fail card fails the quest (two on the 4th quest with 7+ players).</li>
      <li>The leader passes to the next player in seat order.</li>
    </ol>
    <p>If good completes 3 quests, the <strong>Assassin</strong> gets one guess at who Merlin is. A correct guess wins for evil.</p>
    <h3>Characters</h3>
    <ul class="role-list">
      ${role('merlin', 'knows who is evil (except Mordred). Must guide good without being spotted.')}
      ${role('percival', 'sees Merlin and Morgana, but not which is which.')}
      ${role('servant', 'knows nothing but what they observe.')}
      ${role('assassin', 'names Merlin at the end if good wins three quests.')}
      ${role('morgana', 'appears to Percival as a possible Merlin.')}
      ${role('mordred', 'is hidden from Merlin.')}
      ${role('oberon', 'is evil but unknown to the other evil players, and doesn\'t know them.')}
      ${role('minion', 'knows the other evil players (except Oberon).')}
    </ul>
    <p><strong>Lady of the Lake</strong> (optional): after quests 2, 3 and 4 its holder secretly learns one player's loyalty, then passes the Lady to them. Past holders can't be examined.</p>
    <h3>Team sizes</h3>
    <div class="table-wrap">
      <table class="sizes">
        <thead><tr><th>Players</th><th>Good / Evil</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th></tr></thead>
        <tbody>${sizes}</tbody>
      </table>
    </div>
    <p class="muted small">* needs two Fail cards to fail.</p>`;
}

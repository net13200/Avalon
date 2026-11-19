// End-to-end: plays complete games in a real browser, one page per player.
//   npm run e2e               both modes: BroadcastChannel, then real WebRTC
//   NET=local npm run e2e     BroadcastChannel only
//   NET=peer npm run e2e      WebRTC only, through a PeerJS server started here
//   SHOTS=dir npm run e2e     also save phone-sized screenshots of each phase
// Needs Playwright with Chromium, and `npm install` for the local PeerJS server.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

function serveFiles() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function startSignalServer() {
  const { PeerServer } = require('peer');
  return new Promise((resolve) => {
    const server = PeerServer({ port: 0, host: '127.0.0.1', path: '/' }, (s) => resolve(s));
  });
}

const NAMES = ['Ann', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn', 'Gil', 'Hana', 'Ido', 'Jo'];
const randomRoom = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

async function playGame(browser, base, n, { lady, shots, netParams, reload, label }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Fonts come from Google; block them so tests don't need the network.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const room = randomRoom();
  const pages = [];
  const errors = [];
  for (let i = 0; i < n; i++) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${NAMES[i]}: ${e.message}`));
    const q = new URLSearchParams({ room, pid: `e2e-${room}-${i}`, name: NAMES[i], ...netParams });
    if (i === 0) q.set('host', '1');
    await page.goto(`${base}/index.html?${q}`);
    pages.push(page);
  }
  const host = pages[0];
  const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${label}-${n}p-${name}.png`) });
  const everyone = (sel, timeout = 20000) => Promise.all(pages.map((p) => p.waitForSelector(sel, { timeout })));

  // Lobby: everyone listed and connected.
  await host.waitForFunction((k) => document.querySelectorAll('.players li:not(.offline)').length === k, n, { timeout: 30000 });
  if (lady) await host.click('[data-act=lady]');
  await host.waitForSelector('[data-act=start]:not([disabled])');
  await shot(host, 'lobby');
  await host.click('[data-act=sheet][data-id=rules]');
  await host.waitForSelector('.sheet .sizes');
  await host.waitForTimeout(400);
  await shot(host, 'rules');
  await host.keyboard.press('Escape');
  await host.waitForSelector('.sheet', { state: 'detached' });
  await shot(pages[1], 'lobby-player');
  await host.click('[data-act=start]');
  await everyone('.quests');

  // Hold to reveal the role.
  const box = await (await host.$('[data-act=reveal]')).boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.waitForSelector('.role-card');
  await shot(host, 'role');
  await host.mouse.up();
  await host.waitForSelector('.role-card', { state: 'detached' });

  const seen = new Set();
  let reloaded = false;
  for (let step = 0; step < 600; step++) {
    if (process.env.DEBUG) console.log(label, n, 'step', step);
    if (reload && !reloaded && step === 8) {
      // A player's phone reloads mid-game, then the host's does: everyone must recover.
      reloaded = true;
      await pages[2].reload();
      await pages[2].waitForSelector('.quests', { timeout: 30000 });
      await host.reload();
      await everyone('.quests:not(:has(+ .status))', 40000);
      await host.waitForFunction((k) => document.querySelectorAll('.players .chip.offline').length === 0, n, { timeout: 40000 });
      console.log(`   ${label}: a player and the host reloaded mid-game and everyone reconnected`);
    }
    let acted = false;
    for (const page of pages) {
      const phase = await page.$eval('main', (m) => m.className.match(/phase-(\w+)/)?.[1]);
      if (!phase || phase === 'game_over') continue;
      if (!seen.has(phase)) { seen.add(phase); await shot(page, phase); }

      if (await page.$('[data-act=propose]')) {
        const need = Number((await page.textContent('[data-act=propose]')).match(/\/(\d+)/)[1]);
        for (let k = 0; k < need; k++) await page.click('[data-act=pick]:not(.picked)');
        await page.click('[data-act=propose]:not([disabled])');
        acted = true;
      } else if (await page.$('[data-act=vote]')) {
        await page.click(`[data-act=vote][data-id=${step % 3 ? 'yes' : 'no'}]`);
        acted = true;
      } else if (await page.$('[data-act=quest]')) {
        const canFail = await page.$('[data-act=quest][data-id=fail]:not([disabled])');
        await page.click(`[data-act=quest][data-id=${canFail && step % 2 ? 'fail' : 'success'}]`);
        acted = true;
      } else if (await page.$('[data-act=lady-examine]')) {
        await page.click('[data-act=pick]');
        await page.click('[data-act=lady-examine]:not([disabled])');
        acted = true;
      } else if (await page.$('[data-act=assassinate]')) {
        await page.click('[data-act=pick]');
        await page.click('[data-act=assassinate]:not([disabled])');
        acted = true;
      }
      if (acted) break;
    }
    if (!acted) {
      const over = await Promise.all(pages.map((p) => p.$('.phase.over')));
      if (over.every(Boolean)) break;
      await host.waitForTimeout(50); // let messages arrive
    }
  }

  await everyone('.phase.over', 10000);
  await shot(host, 'over');

  // The history sheet lists every proposal of the game.
  await host.click('[data-act=sheet][data-id=history]');
  await host.waitForSelector('.sheet .proposal');
  const logged = await host.$$eval('.sheet .proposal', (els) => els.length);
  const quests = await host.$$eval('.quest.success, .quest.fail', (els) => els.length);
  assert.ok(logged >= quests, `history lists ${logged} proposals for ${quests} quests`);
  await host.waitForTimeout(400); // let the sheet finish sliding in
  await shot(host, 'history');
  await host.click('.sheet [data-act=close-sheet]');
  await host.waitForSelector('.sheet', { state: 'detached' });
  const winner = await host.textContent('.phase.over h2');
  assert.equal(await host.$$eval('.chip.role', (els) => els.length), n, 'all roles revealed at the end');

  // Back to the lobby with the same seats.
  await host.click('[data-act=new-game]');
  await everyone('.big-code');
  assert.deepEqual(errors, [], 'no page errors');
  await context.close();
  return { winner, phases: [...seen] };
}

/** Opens a 5-player lobby and returns its pages; seat 0 hosts. */
async function openLobby(browser, base, netParams, prefix) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Lets a test cut a page's WebRTC traffic in both directions, as when a phone loses
  // its network, without the connection reporting that it closed.
  await context.addInitScript(() => {
    const proto = RTCDataChannel.prototype;
    const send = proto.send;
    proto.send = function (data) {
      if (!window.__cut) send.call(this, data);
    };
    const desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(fn) { desc.set.call(this, fn && ((e) => { if (!window.__cut) fn.call(this, e); })); },
    });
  });
  const room = randomRoom();
  const pages = [];
  for (let i = 0; i < 5; i++) {
    const p = await context.newPage();
    const q = new URLSearchParams({ room, pid: `${prefix}-${room}-${i}`, name: NAMES[i], ...netParams });
    if (i === 0) q.set('host', '1');
    await p.goto(`${base}/index.html?${q}`);
    pages.push(p);
  }
  await pages[0].waitForSelector('[data-act=start]:not([disabled])', { timeout: 30000 });
  return { context, pages, room };
}

/** Cuts or restores a page's WebRTC traffic. */
const setCut = (page, cut) => page.evaluate((c) => { window.__cut = c; }, cut);

const offlineCount = (page) => page.$$eval('.player.offline, .chip.offline', (els) => els.length);

async function droppedConnections(browser, base, netParams) {
  const { context, pages } = await openLobby(browser, base, netParams, 'z');
  const [host, , sleeper] = pages;
  await host.click('[data-act=start]');
  for (const p of pages) await p.waitForSelector('.quests');

  // A player's phone loses its network: the host marks them offline within seconds.
  const t0 = Date.now();
  await setCut(sleeper, true);
  await host.waitForFunction(() => document.querySelectorAll('.chip.offline').length === 1, null, { timeout: 25000 });
  const noticed = (Date.now() - t0) / 1000;
  await setCut(sleeper, false);
  await host.waitForFunction(() => document.querySelectorAll('.chip.offline').length === 0, null, { timeout: 40000 });
  await sleeper.waitForSelector('.quests:not(:has(+ .status))');
  console.log(`   a player who lost their network was marked offline after ${noticed.toFixed(1)} s, and rejoined when it came back`);

  // The host's phone loses its network: players see that the host is gone, then everything resumes.
  await setCut(host, true);
  await pages[1].waitForSelector('text=Lost the host', { timeout: 25000 });
  await setCut(host, false);
  for (const p of pages.slice(1)) await p.waitForSelector('.quests:not(:has(+ .status))', { timeout: 40000 });
  await host.waitForFunction(() => document.querySelectorAll('.chip.offline').length === 0, null, { timeout: 40000 });
  console.log('   the host lost its network: players saw "Lost the host", then all reconnected');
  assert.equal(await offlineCount(host), 0);
  await context.close();
}

async function versionMismatch(browser, base, netParams) {
  const { context, pages, room } = await openLobby(browser, base, netParams, 'v');
  // An outdated phone: its own browser, serving it a host.js with an older protocol version.
  const oldContext = await browser.newContext();
  await oldContext.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await oldContext.route('**/src/host.js', async (route) => {
    const body = (await (await route.fetch()).text()).replace(/export const PROTOCOL = \d+;/, 'export const PROTOCOL = 0;');
    await route.fulfill({ body, contentType: 'text/javascript' });
  });
  const old = await oldContext.newPage();
  await old.goto(`${base}/index.html?${new URLSearchParams({ room, pid: `v-old-${room}`, name: 'Old', sw: '0', ...netParams })}`);
  await old.waitForSelector('text=Your app is out of date', { timeout: 30000 });
  await oldContext.close();
  assert.equal(await pages[0].$$eval('.players li', (els) => els.length), 5);
  await context.close();
}

async function installable(browser, base) {
  const context = await browser.newContext();
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.equal((await page.request.get(`${base}/${icon.src}`)).status(), 200, icon.src);
  // Reload with no network: the app still opens from the service worker's cache.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-act=host]');
  await page.goto(`${base}/index.html?join=ABCD`);
  await page.waitForSelector('input[name=code][value=ABCD]');
  await context.close();
}

async function strangerCannotJoin(browser, base, netParams) {
  const context = await browser.newContext();
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const room = randomRoom();
  const pages = [];
  for (let i = 0; i < 5; i++) {
    const p = await context.newPage();
    const q = new URLSearchParams({ room, pid: `s-${room}-${i}`, name: NAMES[i], ...netParams });
    if (i === 0) q.set('host', '1');
    await p.goto(`${base}/index.html?${q}`);
    pages.push(p);
  }
  await pages[0].waitForSelector('[data-act=start]:not([disabled])', { timeout: 30000 });
  await pages[0].click('[data-act=start]');
  // Someone opens the join link after the game started.
  const late = await context.newPage();
  await late.goto(`${base}/index.html?${new URLSearchParams({ join: room, ...netParams })}`);
  await late.fill('input[name=name]', 'Late');
  await late.click('[data-act=join]');
  await late.waitForSelector('text=This game has already started', { timeout: 30000 });
  await context.close();
}

(async () => {
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const modes = process.env.NET ? [process.env.NET] : ['local', 'peer'];
  const files = await serveFiles();
  const base = `http://127.0.0.1:${files.address().port}`;
  // Chromium hides local IPs behind mDNS names by default, which headless runs can't resolve.
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  let signal = null;
  try {
    await installable(browser, base);
    console.log('ok: installable, and opens offline from the service worker cache');
    for (const net of modes) {
      let netParams = { net: 'local' };
      if (net === 'peer') {
        signal = await startSignalServer();
        netParams = { signal: `127.0.0.1:${signal.address().port}` };
      }
      const games = net === 'peer'
        ? [[5, false, true], [7, true, false]]
        : [[5, false, false], [7, true, false], [10, true, false]];
      for (const [n, lady, reload] of games) {
        const r = await playGame(browser, base, n, { lady, shots, netParams, reload, label: net });
        console.log(`ok ${net}: ${n} players${lady ? ' + Lady' : ''}: ${r.winner}; phases: ${r.phases.join(', ')}`);
      }
      await strangerCannotJoin(browser, base, netParams);
      console.log(`ok ${net}: a stranger opening the join link mid-game is turned away`);
      if (net === 'peer') {
        await droppedConnections(browser, base, netParams);
        console.log('ok peer: dropped connections are detected and recover');
        await versionMismatch(browser, base, netParams);
        console.log('ok peer: an outdated app is asked to reload');
      }
    }
  } finally {
    await browser.close();
    files.close();
    signal?.close();
  }
})().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});

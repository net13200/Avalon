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
  const winner = await host.textContent('.phase.over h2');
  assert.equal(await host.$$eval('.chip.role', (els) => els.length), n, 'all roles revealed at the end');

  // Back to the lobby with the same seats.
  await host.click('[data-act=new-game]');
  await everyone('.big-code');
  assert.deepEqual(errors, [], 'no page errors');
  await context.close();
  return { winner, phases: [...seen] };
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

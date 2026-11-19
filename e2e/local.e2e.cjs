// End-to-end: plays complete games in a real browser, one page per player,
// connected over BroadcastChannel. Run with: npm run e2e  (needs Playwright + Chromium).
//   SHOTS=dir  saves phone-sized screenshots of each phase into dir.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
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

const NAMES = ['Ann', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn', 'Gil', 'Hana', 'Ido', 'Jo'];

async function playGame(browser, base, n, { lady, shots }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Fonts come from Google; block them so tests don't need the network.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const room = `T${n}${lady ? 'L' : 'N'}X`.slice(0, 4);
  const pages = [];
  for (let i = 0; i < n; i++) {
    const page = await context.newPage();
    page.on('pageerror', (e) => { throw new Error(`${NAMES[i]}: ${e.message}`); });
    const q = new URLSearchParams({ room, pid: `e2e-${i}`, name: NAMES[i] });
    if (i === 0) q.set('host', '1');
    await page.goto(`${base}/index.html?${q}`);
    pages.push(page);
  }
  const host = pages[0];
  const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${n}p-${name}.png`) });

  // Lobby: everyone listed.
  await host.waitForFunction((k) => document.querySelectorAll('.players li').length === k, n);
  if (lady) await host.click('[data-act=lady]');
  await host.waitForSelector('[data-act=start]:not([disabled])');
  await shot(host, 'lobby');
  await host.click('[data-act=start]');
  for (const p of pages) await p.waitForSelector('.quests');

  // Hold to reveal the role.
  const btn = await host.$('[data-act=reveal]');
  const box = await btn.boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.waitForSelector('.role-card');
  await shot(host, 'role');
  await host.mouse.up();
  await host.waitForSelector('.role-card', { state: 'detached' });

  const seen = new Set();
  for (let step = 0; step < 400; step++) {
    // Find a page with something to do and do it.
    let acted = false;
    for (const page of pages) {
      const phase = await page.$eval('main', (m) => m.className.match(/phase-(\w+)/)?.[1]);
      if (phase === 'game_over') continue;
      if (!seen.has(phase)) { seen.add(phase); await shot(page, phase); }

      if (await page.$('[data-act=propose]')) {
        const need = Number((await page.textContent('[data-act=propose]')).match(/\/(\d+)/)[1]);
        for (let k = 0; k < need; k++) await page.click('[data-act=pick]:not(.picked)');
        await page.click('[data-act=propose]:not([disabled])');
        acted = true;
      } else if (await page.$('[data-act=vote]')) {
        // Reject the first proposal of each quest to exercise the rejection track.
        const rejectFirst = await page.$eval('.dot.on', () => true).catch(() => false);
        await page.click(`[data-act=vote][data-id=${rejectFirst ? 'yes' : (step % 3 ? 'yes' : 'no')}]`);
        acted = true;
      } else if (await page.$('[data-act=quest]')) {
        const canFail = await page.$('[data-act=quest][data-id=fail]:not([disabled])');
        await page.click(`[data-act=quest][data-id=${canFail ? 'fail' : 'success'}]`);
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

  for (const p of pages) await p.waitForSelector('.phase.over', { timeout: 5000 });
  await shot(host, 'over');
  const winner = await host.textContent('.phase.over h2');
  const roles = await host.$$eval('.chip.role', (els) => els.length);
  assert.equal(roles, n, 'all roles revealed at the end');

  // Back to the lobby with the same seats.
  await host.click('[data-act=new-game]');
  for (const p of pages) await p.waitForSelector('.big-code');
  await context.close();
  return { winner, phases: [...seen] };
}

(async () => {
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [n, lady] of [[5, false], [7, true], [10, true]]) {
      const r = await playGame(browser, base, n, { lady, shots });
      console.log(`ok ${n} players${lady ? ' + Lady' : ''}: ${r.winner}; phases seen: ${r.phases.join(', ')}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

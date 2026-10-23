import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/package.json');
const { chromium } = require('playwright');

const OUT = process.env.OUT || '/home/user/Harvest-agent/docs/redesign/content-search';
const who = process.argv[2] || 'admin';
const creds = who === 'staff'
  ? { email: 'staff@grace.example.org', password: 'demo-password-1' }
  : { email: 'admin@grace.example.org', password: 'demo-password-1' };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2, colorScheme: 'light' });
await context.addCookies([{ name: 'tenantId', value: 'grace', url: 'http://localhost:3000' }]);
await context.addInitScript((c) => { localStorage.setItem('demoLogin', JSON.stringify(c)); localStorage.setItem('harvest-theme', 'light'); }, creds);
const page = await context.newPage();
const reads = [];
page.on('request', (r) => { if (r.url().includes('8080') && r.method() === 'POST') reads.push(r.url()); });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));

// First visit signs the demo user in (the funnel then tries to hop to the real subdomain, which is unreachable here).
await page.goto('http://localhost:3000/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.goto('http://localhost:3000/admin', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-sidebar="sidebar"]', { timeout: 120000 });
await page.waitForTimeout(2500);
console.log('url', page.url());

async function openPalette() {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[data-slot="command-input"]', { timeout: 10000 });
}
async function waitLoaded() {
  await page.waitForFunction(() => !document.querySelector('[data-search-loading]'), null, { timeout: 30000 });
}
async function shot(name, query, { clip = true } = {}) {
  const input = page.locator('[data-slot="command-input"]');
  await input.fill('');
  await input.pressSequentially(query, { delay: 40 });
  await page.waitForTimeout(450);
  const dialog = page.locator('[data-slot="dialog-content"]').first();
  const box = await dialog.boundingBox();
  const pad = 24;
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: clip && box ? { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } : undefined });
  const text = await page.locator('[data-slot="command-list"]').innerText();
  console.log(`--- ${name} [${query}]\n${text}`);
}

if (who === 'staff') {
  await openPalette();
  await waitLoaded();
  await shot('06-staff-role-sees-only-its-tabs', 'sermon');
  await page.locator('[data-slot="command-input"]').fill('');
  await shot('06b-staff-role-events-forms', 'e');
} else {
  const before = reads.length;
  if (process.env.LOADING === '1') {
  // Hold every Firestore call for a moment so the loading state can be seen.
  await page.route('**/google.firestore.v1.Firestore/**', async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue().catch(() => {}); });
  await openPalette();
  await shot('00-loading-state', 'ionescu');
  await page.unroute('**/google.firestore.v1.Firestore/**');
  await waitLoaded();
  await browser.close(); process.exit(0);
  }
  await openPalette();
  await waitLoaded();
  await page.locator('[data-slot="command-input"]').fill('');
  console.log('firestore POSTs during first open:', reads.length - before);
  await shot('01-search-a-name', 'ionescu');
  await shot('02-search-a-note-title', 'sermon outline');
  await shot('03-search-a-course', 'foundations');
  await shot('04-accent-insensitive', 'stefan');
  await shot('05-grouped-results-and-see-all', 'grace');
  await shot('07-no-results', 'zzzqx');
  await shot('08-empty-box-pages', '');
  // Enter opens the real page
  const input = page.locator('[data-slot="command-input"]');
  await input.fill('');
  await input.pressSequentially('sermon outline', { delay: 30 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-slot="dialog-content"]', { state: 'detached', timeout: 20000 }).catch(() => console.log('dialog did not detach'));
  await page.waitForTimeout(1500);
  console.log('palette still open after Enter?', await page.locator('[data-slot="command-input"]').count(), await page.evaluate(() => [...document.querySelectorAll('[data-slot="dialog-content"],[data-slot="dialog-overlay"]')].map((el) => el.getAttribute('data-slot') + ':' + [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-') && n !== 'data-slot').join(','))));
  await page.waitForTimeout(1500);
  console.log('after Enter on note ->', page.url());
  await page.screenshot({ path: `${OUT}/09-enter-opens-the-note.png` });
  // reopen: no new reads
  const n = reads.length;
  await openPalette();
  await page.waitForTimeout(800);
  console.log('firestore POSTs on reopen:', reads.length - n);
}
await browser.close();

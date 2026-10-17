// Тести карт: граф «Зв'язки» в Бюджеті і карта портфеля на «Інвестиції».
// Запуск: npm test:maps (або node tests/maps.mjs). Перевіряє порожні стани, приховані суми,
// згортання категорій, зміну валюти й очищення карт при виході з розділу.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'OK    ' : 'ПОМИЛКА ') + name + (ok ? '' : ' ' + extra)); if (!ok) failed++; };

const browser = await chromium.launch();
const errors = [];
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load|attribute|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForTimeout(900);
  return p;
}
// Записує стан у localStorage і перезавантажує сторінку. patch — функція від поточної дати (у Node).
async function setState(p, patch) {
  const data = patch(new Date());
  await p.evaluate(data => {
    const s = JSON.parse(localStorage.getItem('bella_proto2') || '{}');
    s.mod = 1; s.noct = 1; Object.assign(s, data);
    localStorage.setItem('bella_proto2', JSON.stringify(s));
  }, data);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
}
const day = (d, n) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(n).padStart(2, '0');
const expense = (id, desc, amount, cat, date, cur = 'UAH') => ({ id, type: 'expense', desc, amount, cur, cat, date });
const baseTxs = d => [expense(1, 'Сільпо', 1200, 'Харчування', day(d, 2)), expense(2, 'АТБ', 800, 'Харчування', day(d, 3)),
  expense(3, 'Оренда', 15000, 'Житло', day(d, 4))];
const openBudget = async p => { await p.keyboard.press('1'); await p.waitForTimeout(300); await p.getByRole('button', { name: "Зв'язки", exact: true }).click(); await p.waitForTimeout(1200); };
const openInvest = async p => { await p.keyboard.press('4'); await p.waitForTimeout(1200); };

// 1. Граф без витрат за місяць: жодного кола, без помилок
{
  const p = await page();
  await setState(p, d => ({ txs: [expense(1, 'Сільпо', 500, 'Харчування', day(d, 2))], month: '2001-01' }));
  await openBudget(p);
  check('граф порожній, коли за місяць немає витрат', await p.locator('#flow-map circle').count() === 0);
}

// 2. Приховані суми: у підказках замість сум лише «•••»
{
  const p = await page();
  await setState(p, d => ({ txs: baseTxs(d), hide: true }));
  await openBudget(p);
  const titles = await p.locator('#flow-map title').allTextContents();
  check('при «приховати суми» граф не показує суми', titles.length > 0 && titles.every(t => !/\d/.test(t)), titles.join(' | '));
}

// 3. Зміна валюти: підписи в доларах
{
  const p = await page();
  await setState(p, d => ({ txs: baseTxs(d), cur: 'USD' }));
  await openBudget(p);
  const titles = await p.locator('#flow-map title').allTextContents();
  check('граф у валюті перегляду (USD)', titles.some(t => t.includes('$')), titles.join(' | '));
}

// 4. Мапа: згортання і розгортання категорії повертає операції
{
  const p = await page();
  await setState(p, d => ({ txs: baseTxs(d), mapMode: 'mind' }));
  await openBudget(p);
  const full = await p.locator('#flow-map circle').count();
  await p.locator('#flow-map svg > g > g', { has: p.locator('title', { hasText: /^Житло ·/ }) }).locator('circle').click({ force: true });
  await p.waitForTimeout(1200);
  const collapsed = await p.locator('#flow-map circle').count();
  await p.locator('#flow-map svg > g > g', { has: p.locator('title', { hasText: /^Житло ·/ }) }).locator('circle').click({ force: true });
  await p.waitForTimeout(1200);
  const back = await p.locator('#flow-map circle').count();
  check('згортання й розгортання категорії повертає її операції', collapsed === full - 1 && back === full, `повне ${full}, згорнуте ${collapsed}, назад ${back}`);
}

// 5. Перехід з «Бюджет» на інший розділ прибирає граф (без помилок)
{
  const p = await page();
  await setState(p, d => ({ txs: baseTxs(d) }));
  await openBudget(p);
  await p.keyboard.press('0'); await p.waitForTimeout(800);
  check('граф зникає, коли вкладку не видно', await p.locator('#flow-map').count() === 0);
}

// 6. Портфель порожній: карта не малюється, є підказка
{
  const p = await page();
  await setState(p, () => ({ portfolio: [] }));
  await openInvest(p);
  const info = await p.locator('#port-map-info').innerText();
  check('порожній портфель: без кіл і з підказкою додати актив', await p.locator('#port-map circle').count() === 0 && /Додайте актив/.test(info), info);
}

// 7. Портфель лише з позицією без операцій: вузол є, результат «невідомий»
{
  const p = await page();
  await setState(p, () => ({ portfolio: [{ id: 7, name: 'Облігація', category: 'ОВДП', value: 5000, currency: 'UAH', profitPct: 0, ops: [] }] }));
  await openInvest(p);
  await p.locator('#port-map circle').nth(1).click({ force: true }); await p.waitForTimeout(200);
  const info = await p.locator('#port-map-info').innerText();
  check('позиція без операцій: тап каже «результат невідомий»', /Облігація/.test(info) && /невідомий/.test(info), info);
}

check('без помилок JavaScript у всіх сценаріях', errors.length === 0, errors.join('; '));

await browser.close();
server.close();
console.log(failed ? `\nПровалено: ${failed}` : '\nУсі тести карт пройшли');
process.exit(failed ? 1 : 0);

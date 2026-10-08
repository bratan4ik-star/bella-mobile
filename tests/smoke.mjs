// Автотести застосунку: запускають app/ у Chromium і перевіряють головні сценарії.
// Запуск: npm install && npx playwright install chromium && npm test
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
async function page(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const p = await ctx.newPage();
  // Зовнішні запити (курси НБУ, Google) у тестах недоступні й не потрібні.
  await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load|attribute|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  if (init) await p.addInitScript(init);
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForTimeout(900);
  return p;
}
const seed = (p, fn, arg) => p.evaluate(([f, a]) => { const s = JSON.parse(localStorage.getItem('bella_proto2') || '{}'); s.mod = 1; s.noct = 1; new Function('s', 'a', f)(s, a); localStorage.setItem('bella_proto2', JSON.stringify(s)); }, [fn.toString().replace(/^[^{]*\{|\}\s*$/g, ''), arg]);
const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem('bella_proto2') || '{}'));
const reload = async p => { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000); };

// 1. Усі розділи відкриваються, головні кнопки натискаються без помилок
{
  const p = await page();
  const names = ['home', 'budget', 'networth', 'ovdp', 'invest', 'goals', 'passive', 'import', 'data'];
  for (let k = 0; k < names.length; k++) {
    await p.keyboard.press(String(k)); await p.waitForTimeout(200);
    const n = await p.locator('button:visible').count();
    for (let i = 0; i < Math.min(n, 25); i++) {
      const b = p.locator('button:visible').nth(i);
      const label = ((await b.getAttribute('aria-label', { timeout: 400 }).catch(() => null)) || (await b.innerText({ timeout: 400 }).catch(() => ''))).trim();
      if (!label) continue;
      if (/Очист|Видал|дублікат|Заблок|PIN|Синхрон|JSON|CSV|Почати з нуля|шифрування|Підтвердити/i.test(label) || /^0\d/.test(label)) continue;
      await b.click({ timeout: 800 }).catch(() => {}); await p.waitForTimeout(40);
      await p.keyboard.press('Escape'); await p.keyboard.press(String(k)); await p.waitForTimeout(40);
    }
  }
  check('усі 9 розділів відкриваються без помилок JavaScript', errors.length === 0, errors.join('; '));
}

// 2. Новий пристрій: немає вигаданого графіка капіталу; початковий залишок додається до готівки
{
  const p = await page();
  check('немає вигаданої кривої капіталу', await p.locator('svg[viewBox="0 0 300 64"] polyline').count() === 0);
  await p.keyboard.press('2'); await p.waitForTimeout(300);
  await p.locator('summary').filter({ hasText: 'Початковий залишок готівки' }).click();
  const inp = p.locator('details', { hasText: 'Початковий залишок готівки' }).locator('input[type=number]').first(); await inp.fill('1500'); await inp.blur(); await p.waitForTimeout(300);
  check('початковий залишок збільшує готівку', (await p.locator('text=Готівка').first().locator('xpath=following-sibling::b').innerText()).replace(/\s/g, '').startsWith('1500'));
}

// 3. Повторювані операції додаються самі й без дублів
{
  const p = await page();
  await seed(p, () => {
    const d = new Date(), f = (y, m) => y + '-' + String(m).padStart(2, '0'), back = n => { const t = new Date(d.getFullYear(), d.getMonth() - n, 1); return f(t.getFullYear(), t.getMonth() + 1); };
    s.txs = [{ id: 1, type: 'expense', desc: 'Оренда', amount: 100, cur: 'UAH', cat: 'Житло', date: back(3) + '-01' }];
    s.recurring = [{ id: 11, type: 'expense', desc: 'Оренда', amount: 100, cur: 'UAH', cat: 'Житло', day: 1 }];
  });
  await reload(p); const n1 = (await stored(p)).txs.length; await reload(p); const n2 = (await stored(p)).txs.length;
  check('повторювана операція додана за пропущені місяці', n1 === 4, `було ${n1}`);
  check('повторний запуск не створює дублів', n2 === n1, `${n1} → ${n2}`);
}

// 4. Імпорт виписки підставляє категорії з історії й ваших виправлень
{
  const p = await page();
  await seed(p, () => { s.txs = [{ id: 1, type: 'expense', desc: "Кав'ярня Лате 12", amount: 70, cur: 'UAH', cat: 'Розваги', date: '2026-09-01' }]; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.statement.csv');
  fs.writeFileSync(csv, "Дата;Опис;Сума\n01.10.2026;Кав'ярня Лате 55;-80\n02.10.2026;Новий магазин ХХХ 7;-50\n");
  const imp = async () => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]); await fc.setFiles(csv); await p.waitForTimeout(700); return p.evaluate(() => [...document.querySelectorAll('select')].map(s => s.value).join(',')); };
  check('категорія з історії операцій', (await imp()).startsWith('Розваги'));
  await p.locator('select:visible').nth(1).selectOption("Здоров'я"); await p.waitForTimeout(300);
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  check('виправлення категорії запам\'ятовується', (await imp()) === "Розваги,Здоров'я");
  fs.rmSync(csv, { force: true });
}

// 5. Шифрування: у сховищі шифртекст, пароль потрібен, неправильний пароль відхиляється
{
  const p = await page();
  await seed(p, () => { s.txs = [{ id: 1, type: 'expense', desc: 'ТАЄМНИЦЯ', amount: 777, cur: 'UAH', cat: 'Інше', date: '2026-10-01' }]; });
  await reload(p); await p.keyboard.press('8'); await p.waitForTimeout(300);
  await p.locator('input[placeholder^="Пароль (від"]').fill('секрет-123'); await p.locator('input[placeholder="Повторіть пароль"]').fill('секрет-123');
  await p.getByRole('button', { name: 'Увімкнути шифрування' }).click(); await p.waitForTimeout(1500);
  const raw = await p.evaluate(() => localStorage.getItem('bella_proto2'));
  check('у сховищі шифртекст без відкритих даних', raw.includes('"enc":1') && !raw.includes('ТАЄМНИЦЯ'));
  await reload(p);
  check('після перезавантаження потрібен пароль', await p.locator('text=Введіть пароль даних').count() === 1);
  await p.locator('input[placeholder="Пароль"]').fill('не той'); await p.getByRole('button', { name: 'Розблокувати' }).click(); await p.waitForTimeout(1500);
  check('неправильний пароль відхиляється', await p.locator('text=Невірний пароль').count() === 1);
  await p.locator('input[placeholder="Пароль"]').fill('секрет-123'); await p.locator('input[placeholder="Пароль"]').press('Enter'); await p.waitForTimeout(1800);
  await p.keyboard.press('1'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Операції', exact: true }).click(); await p.waitForTimeout(200);
  check('правильний пароль повертає дані', await p.locator('text=ТАЄМНИЦЯ').count() > 0);
}

// 6. Android-міст: біометрія при блокуванні та нагадування
{
  const h = createHash('sha256').update('bella:1234').digest('hex');
  const p = await page({ viewport: { width: 390, height: 844 } }, () => {
    window.__calls = []; window.__rem = [];
    window.AndroidApp = { biometricAvailable: () => true, authenticate: id => { window.__calls.push(1); setTimeout(() => window.__bioCb(id, true), 80); },
      setReminders: j => window.__rem.push(JSON.parse(j)), signIn: () => {}, signOut: () => {}, save: () => {} };
  });
  await seed(p, () => {
    const d = new Date(), t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 20), m = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    s.pinHash = a[0]; s.autoLock = '5'; s.ovdpPos = [{ id: 1, lk: 5, broker: 'Тест', isin: 'X', amount: 100000, coupon: '10', maturity: m }]; s.portfolio = [];
  }, [h]);
  await reload(p); await p.waitForTimeout(1800);
  check('біометрія викликається і розблоковує', await p.evaluate(() => window.__calls.length) === 1 && await p.locator('text=Введіть PIN').count() === 0);
  const rem = await p.evaluate(() => window.__rem.at(-1) || []);
  check('заплановано нагадування про погашення і про копію', rem.filter(r => /Погашення/.test(r.title)).length === 2 && rem.some(r => /копію/.test(r.title)));
  check('суми не потрапляють у сповіщення при активному PIN', !rem.some(r => /₴/.test(r.text)));
}

// 7. Жоден розділ не ширший за екран телефона
{
  const p = await page({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true }, () => {
    window.AndroidApp = { biometricAvailable: () => true, authenticate: () => {}, setReminders: () => {}, signIn: () => {}, signOut: () => {}, save: () => {} };
  });
  const names = ['Головна', 'Бюджет', 'Net Worth', 'ОВДП', 'Інвестиції', 'Цілі', 'Пасивний дохід', 'Імпорт виписки', 'Дані та історія'];
  const wide = [];
  for (const n of names) {
    await p.locator('button[aria-label="Меню"]:visible').first().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(250);
    await p.locator('button:visible').filter({ hasText: new RegExp('^0\\d' + n) }).first().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(350);
    const over = await p.evaluate(() => { let m = 0; document.querySelectorAll('.sc *').forEach(e => { const b = e.getBoundingClientRect(); if (b.width && b.right > m) m = b.right; }); return m - innerWidth; });
    if (over > 1) wide.push(n + ' (+' + Math.round(over) + 'px)');
  }
  check('на екрані 360 px жоден розділ не виходить за краї', wide.length === 0, wide.join(', '));
}

// 8. Звіт за період і експорт у Excel
{
  const p = await page({ acceptDownloads: true });
  await seed(p, () => {
    const d = new Date(), mk = (n, day) => { const t = new Date(d.getFullYear(), d.getMonth() - n, day); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
    s.txs = [{ id: 1, type: 'income', desc: 'Зарплата', amount: 50000, cur: 'UAH', cat: 'Зарплата', date: mk(0, 2) },
      { id: 2, type: 'expense', desc: 'Сільпо & "Ко" <тест>', amount: 1200, cur: 'UAH', cat: 'Харчування', date: mk(0, 3) },
      { id: 3, type: 'expense', desc: 'Оренда', amount: 15000, cur: 'UAH', cat: 'Житло', date: mk(1, 5) }];
  });
  await reload(p); await p.keyboard.press('1'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Звіт', exact: true }).click(); await p.waitForTimeout(200);
  const body = await p.evaluate(() => document.body.innerText);
  check('звіт за період показує підсумки й категорії', /Разом/.test(body) && /ВИТРАТИ ЗА КАТЕГОРІЯМИ/i.test(body) && /Житло/.test(body));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Експорт у Excel (.xlsx)' }).first().click()]);
  const buf = fs.readFileSync(await dl.path());
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  check('експорт створює коректний xlsx (zip з 8 файлами)', buf.subarray(0, 2).toString() === 'PK' && eocd > 0 && buf.readUInt16LE(eocd + 10) === 8 && buf.includes('xl/workbook.xml'));
  check('у файлі є дані й спецсимволи екрановані', buf.includes('Оренда') && buf.includes('Сільпо &amp; &quot;Ко&quot; &lt;тест&gt;'));
}

// 9. Масові дії та правила категорій
{
  const p = await page();
  await seed(p, () => {
    s.txs = [{ id: 1, type: 'expense', desc: 'Сільпо 12', amount: 100, cur: 'UAH', cat: 'Інше', date: '2026-10-01' },
      { id: 2, type: 'expense', desc: 'Сільпо 99', amount: 200, cur: 'UAH', cat: 'Інше', date: '2026-10-02' },
      { id: 3, type: 'expense', desc: 'Кіно', amount: 300, cur: 'UAH', cat: 'Інше', date: '2026-10-03' },
      { id: 4, type: 'expense', desc: 'Сільпо Київ', amount: 400, cur: 'UAH', cat: 'Розваги', date: '2026-10-04' }];
    s.month = '';
  });
  await reload(p); await p.keyboard.press('1'); await p.waitForTimeout(400);
  // правило: «Сільпо» → Харчування, лише для «Інше»
  await p.getByRole('button', { name: 'Ліміти · правила', exact: true }).click(); await p.waitForTimeout(200);
  await p.locator('summary').filter({ hasText: 'Правила категорій' }).click();
  await p.locator('input[placeholder^="Текст в описі"]').fill('сільпо');
  await p.locator('select[aria-label="Категорія правила"]').selectOption('Харчування');
  await p.getByRole('button', { name: 'Додати правило' }).click(); await p.waitForTimeout(300);
  check('правило додається і зберігається', (await stored(p)).rules.length === 1);
  await p.getByRole('button', { name: /Застосувати до існуючих \(2\)/ }).click(); await p.waitForTimeout(400);
  let cats = (await stored(p)).txs.map(t => t.id + ':' + t.cat).sort().join(',');
  check('правило змінює лише операції «Інше» (1, 2), а не вручну призначену (4)', cats === '1:Харчування,2:Харчування,3:Інше,4:Розваги', cats);
  // масовий вибір
  await p.getByRole('button', { name: 'Операції', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Вибрати', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Усі видимі' }).click(); await p.waitForTimeout(200);
  check('«Усі видимі» вибирає всі операції', await p.locator('text=Вибрано: 4').count() === 1);
  await p.locator('select[aria-label="Нова категорія"]').selectOption('Транспорт');
  await p.getByRole('button', { name: 'Змінити', exact: true }).click(); await p.waitForTimeout(400);
  cats = (await stored(p)).txs.map(t => t.cat).join(',');
  check('масова зміна категорії застосовується до вибраних', cats.split(',').every(c => c === 'Транспорт'), cats);
  await p.getByRole('button', { name: 'Усі видимі' }).click();
  await p.getByRole('button', { name: /^Видалити \(4\)$/ }).click(); await p.waitForTimeout(200);
  check('видалення потребує підтвердження', (await stored(p)).txs.length === 4);
  await p.getByRole('button', { name: /Підтвердити видалення: 4/ }).click(); await p.waitForTimeout(400);
  check('після підтвердження вибрані операції видалено', (await stored(p)).txs.length === 0);
}

// 10. Щоденні копії на Google Drive (імітація Drive API) і відновлення
{
  const files = new Map(); let seq = 0;
  const p = await page({}, () => { window.AndroidApp = { signIn: (i, id) => setTimeout(() => window.__gAuthCb(id, 'tok', ''), 10), signOut: () => {}, save: () => {} }; });
  const part = s => s.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  await p.route('https://www.googleapis.com/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), path = u.pathname;
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m === 'GET' && path === '/drive/v3/files') {
      const q = u.searchParams.get('q') || '', ex = /name='([^']+)'/.exec(q), co = /name contains '([^']+)'/.exec(q);
      let l = [...files.values()]; if (ex) l = l.filter(f => f.name === ex[1]); else if (co) l = l.filter(f => f.name.includes(co[1]));
      return json({ files: l.map(f => ({ id: f.id, name: f.name })) });
    }
    const mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (mm && m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: files.get(mm[1]).body });
    if (mm && m === 'DELETE') { files.delete(mm[1]); return route.fulfill({ status: 204, body: '' }); }
    if (path === '/upload/drive/v3/files' && m === 'POST') {
      const b = (req.headers()['content-type'].match(/boundary=(.+)$/) || [])[1], parts = (req.postData() || '').split('--' + b);
      const meta = JSON.parse(part(parts[1])), id = 'f' + (++seq); files.set(id, { id, name: meta.name, body: part(parts[2]) }); return json({ id });
    }
    const up = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (up && m === 'PATCH') { files.get(up[1]).body = req.postData(); return json({ id: up[1] }); }
    return route.fulfill({ status: 404, body: '' });
  });
  const names = () => [...files.values()].map(f => f.name).sort();
  const day = new Date(); const T = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
  // 22 старі копії, щоб перевірити обрізання до 20
  for (let i = 1; i <= 22; i++) { const id = 'old' + i; files.set(id, { id, name: 'bella-backup-2026-01-' + String(i).padStart(2, '0') + '.json', body: '{}' }); }
  await seed(p, () => { s.txs = [{ id: 1, type: 'expense', desc: 'СТАРА', amount: 1, cur: 'UAH', cat: 'Інше', date: '2026-10-01' }]; });
  await reload(p); await p.keyboard.press('8'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Синхронізувати' }).click(); await p.waitForTimeout(1500);
  check('після синхронізації є основний файл і щоденна копія', names().includes('bella-sync.json') && names().includes('bella-backup-' + T + '.json'), names().join(','));
  check('копій не більше 20 (старі видаляються)', names().filter(n => n.startsWith('bella-backup-')).length === 20 && !names().includes('bella-backup-2026-01-01.json') && names().includes('bella-backup-' + T + '.json'));
  const n1 = names().length;
  await p.getByRole('button', { name: 'Синхронізувати' }).click(); await p.waitForTimeout(1200);
  check('повторна синхронізація того ж дня не створює нової копії', names().length === n1);
  // змінюємо дані, робимо ручну копію, потім відновлюємо денну
  await seed(p, () => { s.txs = [{ id: 1, type: 'expense', desc: 'НОВА', amount: 2, cur: 'UAH', cat: 'Інше', date: '2026-10-02' }]; });
  await reload(p); await p.keyboard.press('8'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Показати копії' }).click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Відновити', exact: true }).first().click(); await p.waitForTimeout(200);
  check('відновлення потребує підтвердження', (await stored(p)).txs[0].desc === 'НОВА');
  await p.getByRole('button', { name: 'Підтвердити', exact: true }).first().click(); await p.waitForTimeout(2500);
  check('після підтвердження дані повернулись із копії', (await stored(p)).txs[0].desc === 'СТАРА', JSON.stringify((await stored(p)).txs));
  check('перед відновленням створено захисну копію', names().some(n => n.includes('before-restore')));
}

// 11. Рахунки, перекази й операції з рахунком
{
  const p = await page({ viewport: { width: 390, height: 844 } });
  const cashText = async () => (await p.locator('text=Готівка').first().locator('xpath=following-sibling::b').innerText()).replace(/\s/g, '');
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dNet Worth/ }).first().click(); await p.waitForTimeout(400);
  const addAcc = async (name, cur, open) => {
    await p.locator('input[aria-label="Назва рахунку"]').fill(name); await p.locator('select[aria-label="Валюта рахунку"]').selectOption(cur);
    await p.locator('input[aria-label="Початковий залишок рахунку"]').fill(String(open)); await p.getByRole('button', { name: 'Додати рахунок' }).click(); await p.waitForTimeout(300);
  };
  await addAcc('Mono', 'UAH', 1000); await addAcc('USD картка', 'USD', 100);
  check('рахунки додаються й входять у готівку (1000 + 100 USD за курсом 41,2)', (await cashText()).startsWith('5120'), await cashText());
  await p.locator('select[aria-label="З рахунку"]').selectOption({ label: 'Mono · UAH' });
  await p.locator('select[aria-label="На рахунок"]').selectOption({ label: 'USD картка · USD' });
  await p.locator('input[aria-label="Сума переказу"]').fill('300'); await p.locator('input[aria-label="Сума зарахування"]').fill('7');
  await p.getByRole('button', { name: 'Переказати' }).click(); await p.waitForTimeout(400);
  check('переказ між валютними рахунками рахується за вказаною сумою (700 + 107 USD)', (await cashText()).startsWith('5108'), await cashText());
  check('переказ не потрапляє в операції бюджету', (await stored(p)).txs.length === 0);
  // операція з вибором рахунку
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dБюджет/ }).first().click(); await p.waitForTimeout(400);
  await p.locator('button[aria-label="Додати операцію"]:visible').first().click(); await p.waitForTimeout(300);
  await p.locator('input[aria-label="Сума"]').fill('200');
  await p.locator('select[aria-label="Рахунок"]').last().selectOption({ label: 'Mono · UAH' });
  await p.getByRole('button', { name: 'Зберегти запис' }).click(); await p.waitForTimeout(500);
  const st = await stored(p), mono = st.accounts.find(a => a.name === 'Mono');
  check('операція зберігає рахунок', st.txs.length === 1 && st.txs[0].acc === mono.id);
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dNet Worth/ }).first().click(); await p.waitForTimeout(400);
  check('витрата з рахунку зменшує готівку (700 - 200 + 107 USD)', (await cashText()).startsWith('4908'), await cashText());
  // видалення рахунку (з підтвердженням) прибирає його перекази й відв'язує операції
  await p.locator('button[aria-label="Видалити рахунок"]').first().click(); await p.waitForTimeout(200);
  check('видалення рахунку потребує підтвердження', (await stored(p)).accounts.length === 2);
  await p.locator('button', { hasText: 'Точно?' }).click(); await p.waitForTimeout(400);
  const st2 = await stored(p);
  check('після видалення рахунку зникають його перекази, операція лишається без рахунку', st2.accounts.length === 1 && st2.transfers.length === 0 && st2.txs.length === 1 && !st2.txs[0].acc);
}

// 12. Борги й кредити
{
  const p = await page();
  const nwText = async () => (await p.locator('text=Усього').first().locator('xpath=following-sibling::div').first().innerText()).replace(/\s/g, '');
  await p.keyboard.press('2'); await p.waitForTimeout(300);
  await p.locator('summary').filter({ hasText: 'Борги та кредити' }).click();
  const add = async (who, dir, amt) => {
    await p.getByRole('button', { name: dir, exact: true }).click(); await p.locator('input[aria-label="Кому або від кого"]').fill(who);
    await p.locator('input[aria-label="Сума боргу"]').fill(String(amt)); await p.getByRole('button', { name: 'Додати борг' }).click(); await p.waitForTimeout(300);
  };
  await add('Іван', 'Я винен', 1000); await add('Петро', 'Мені винні', 500);
  check('борг «Я винен» зменшує капітал, «Мені винні» збільшує (−1000 + 500)', (await nwText()).startsWith('-500') || (await nwText()).startsWith('−500'), await nwText());
  await p.locator('input[aria-label="Сума платежу"]').first().fill('400'); await p.getByRole('button', { name: 'Платіж', exact: true }).first().click(); await p.waitForTimeout(400);
  const d = (await stored(p)).debts;
  check('платіж зменшує залишок боргу й не створює операцій бюджету', d[0].pay.length === 1 && d[0].pay[0].amt === 400 && (await stored(p)).txs.length === 0);
  check('капітал після платежу (−600 + 500)', /^[-−]100/.test(await nwText()), await nwText());
  await p.locator('button[aria-label="Видалити борг"]').first().click(); await p.locator('button', { hasText: 'Точно?' }).click(); await p.waitForTimeout(300);
  check('борг видаляється після підтвердження', (await stored(p)).debts.length === 1);
}

// 13. В APK поле Client ID приховане
{
  const web = await page(); await web.keyboard.press('8'); await web.waitForTimeout(300);
  const apk = await page({}, () => { window.AndroidApp = { signIn: () => {}, signOut: () => {}, save: () => {} }; }); await apk.keyboard.press('8'); await apk.waitForTimeout(300);
  check('у браузері є поле Client ID', await web.locator('text=Client ID (Google Cloud)').count() === 1);
  check('в APK поля Client ID немає, натомість пояснення', await apk.locator('text=Client ID (Google Cloud)').count() === 0 && await apk.locator('text=Ключ доступу вже вбудовано').count() === 1);
}

// 14. Тривісне злиття синхронізації: спільна, локальна нова, з Drive нова, видалена локально
{
  const op = (id, desc) => ({ id, type: 'expense', desc, amount: 1, cur: 'UAH', cat: 'Інше', date: '2026-10-01' });
  const remote = { updated: '2099-01-01T00:00:00Z', data: { txs: [op(1, 'СПІЛЬНА'), op(3, 'ВИДАЛЕНА ЛОКАЛЬНО'), op(4, 'З ДРАЙВА')] } };
  const p = await page({}, () => { window.AndroidApp = { signIn: (i, id) => setTimeout(() => window.__gAuthCb(id, 'tok', ''), 10), signOut: () => {}, save: () => {} }; });
  let patched = null;
  await p.route('https://www.googleapis.com/**', r => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'PATCH') { patched = req.postData(); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (u.pathname === '/drive/v3/files') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'sync1', name: 'bella-sync.json' }] }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
  });
  await seed(p, () => { const o = (id, desc) => ({ id, type: 'expense', desc, amount: 1, cur: 'UAH', cat: 'Інше', date: '2026-10-01' }); s.txs = [o(1, 'СПІЛЬНА'), o(2, 'ЛОКАЛЬНА НОВА')]; s.gcid = 'x'; s.lastEdit = '2000-01-01T00:00:00Z'; });
  await p.evaluate(() => localStorage.setItem('bella_base', JSON.stringify({ txs: [{ id: 1, type: 'expense', desc: 'СПІЛЬНА', amount: 1, cur: 'UAH', cat: 'Інше', date: '2026-10-01' }, { id: 3, type: 'expense', desc: 'ВИДАЛЕНА ЛОКАЛЬНО', amount: 1, cur: 'UAH', cat: 'Інше', date: '2026-10-01' }] })));
  await reload(p); await p.keyboard.press('8'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Синхронізувати' }).click(); await p.waitForTimeout(1500);
  const st = await stored(p), descs = st.txs.map(t => t.desc).sort().join('|');
  check('злиття: спільна + локальна нова + з Drive; видалена локально не воскресає', descs === 'З ДРАЙВА|ЛОКАЛЬНА НОВА|СПІЛЬНА', descs);
  check('злиття записане в журнал з лічильниками', st.log.some(l => /операцій 2 → 3/.test(l.text)));
  check('злитий результат вивантажено на Drive', patched && patched.includes('ЛОКАЛЬНА НОВА') && patched.includes('З ДРАЙВА') && !patched.includes('ВИДАЛЕНА ЛОКАЛЬНО'));
  const base = await p.evaluate(() => JSON.parse(localStorage.getItem('bella_base')));
  check('база оновлена до злитого стану', base.txs.map(t => t.id).sort().join(',') === '1,2,4', JSON.stringify(base.txs.map(t => t.id)));
}

// 15. Вкладки в Бюджеті: кожна показує свій розділ
{
  const p = await page({ viewport: { width: 390, height: 844 } });
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dБюджет/ }).first().click(); await p.waitForTimeout(400);
  const shown = async t => p.locator('text=' + t).first().isVisible().catch(() => false);
  check('за замовчуванням видно «Огляд» (вільні кошти), а не список', await shown('Вільно до кінця місяця') && !(await shown('Ліміти витрат, ₴')));
  await p.getByRole('button', { name: 'Операції', exact: true }).click(); await p.waitForTimeout(200);
  check('вкладка «Операції» показує фільтри й історію', await p.locator('text=Фільтри').first().isVisible() && await shown('Історія операцій'));
  await p.getByRole('button', { name: 'Звіт', exact: true }).click(); await p.waitForTimeout(200);
  check('вкладка «Звіт» показує звіт за період', await shown('Звіт за період'));
  await p.getByRole('button', { name: 'Ліміти · правила', exact: true }).click(); await p.waitForTimeout(200);
  check('вкладка «Ліміти · правила» показує ліміти, правила й повторювані', await shown('Ліміти витрат') && await shown('Правила категорій') && await shown('Повторювані щомісяця'));
}

check('жодної помилки JavaScript у консолі за весь час', errors.length === 0, errors.join('; '));
await browser.close(); server.close();
console.log(failed ? `\nНевдалих перевірок: ${failed}` : '\nУсі перевірки пройдено');
process.exit(failed ? 1 : 0);

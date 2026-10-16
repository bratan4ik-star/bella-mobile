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

// 4б. Картка з виписки визначається за останніми цифрами: існуючий рахунок або новий з початковим залишком
{
  const p = await page();
  await seed(p, () => { s.accounts = [{ id: 'aMono', name: 'Mono', cur: 'UAH', open: 0, last4: '2222' }]; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.card.csv');
  fs.writeFileSync(csv, 'Дата;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n' +
    '02.10.2026;4000 **** **** 1111;Сільпо;-100;UAH;900;UAH\n' +
    '01.10.2026;4000 **** **** 1111;Сільпо;-50;UAH;1000;UAH\n' +
    '01.10.2026;4000 **** **** 2222;Зарплата;300;UAH;5300;UAH\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
  await fc.setFiles(csv); await p.waitForTimeout(700);
  const preview = await p.locator('body').innerText();
  check('перегляд показує розпізнані картки', preview.includes('···1111') && preview.includes('···2222') && preview.includes('рахунок «Mono»'));
  await p.locator('button:visible').filter({ hasText: /^Імпортувати/ }).first().click(); await p.waitForTimeout(500);
  const st = await stored(p);
  const acc1111 = (st.accounts || []).find(a => a.last4 === '1111');
  const mono = (st.accounts || []).find(a => a.id === 'aMono');
  check('для нової картки створено рахунок з початковим залишком', !!acc1111 && acc1111.open === 1050 && acc1111.cur === 'UAH', JSON.stringify(acc1111));
  check('картка 2222 потрапила на наявний рахунок Mono', !!mono && (st.txs || []).filter(t => t.acc === 'aMono').length === 1, JSON.stringify(st.txs));
  check('операції картки 1111 прив\'язані до нового рахунку', !!acc1111 && (st.txs || []).filter(t => t.acc === acc1111.id).length === 2);
  check('нових рахунків не створено повторно', (st.accounts || []).length === 2);
  fs.rmSync(csv, { force: true });
}

// 4г. Перекази між своїми картками стають переказами між рахунками, а не операціями Бюджету
{
  const p = await page();
  await seed(p, () => { s.accounts = []; s.txs = []; s.transfers = []; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.own.csv');
  fs.writeFileSync(csv, 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n' +
    '02.10.2026;Переказ на свою картку;4000 **** **** 1111;На свою картку *2222;-500;UAH;1000;UAH\n' +
    '02.10.2026;Зарахування зі своєї картки;4000 **** **** 2222;Зі своєї картки *1111;500;UAH;5500;UAH\n' +
    '01.10.2026;Супермаркети та продукти;4000 **** **** 1111;Магазин;-100;UAH;1500;UAH\n' +
    '01.10.2026;Заощадження;4000 **** **** 2222;10% від доходів на Скарбничку;-50;UAH;5000;UAH\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
  await fc.setFiles(csv); await p.waitForTimeout(700);
  await p.locator('button:visible').filter({ hasText: /^Імпортувати/ }).first().click(); await p.waitForTimeout(500);
  check('звірка балансу з випискою збігається', await p.getByText('збігається з випискою').count() > 0, '');
  const st = await stored(p);
  const a1111 = (st.accounts || []).find(a => a.last4 === '1111');
  const a2222 = (st.accounts || []).find(a => a.last4 === '2222');
  const jar = (st.accounts || []).find(a => a.name === 'Скарбничка');
  check('переказ між картками один, без дзеркального дубля', (st.transfers || []).filter(t => t.amount === 500).length === 1 && !!a1111 && !!a2222 && st.transfers.some(t => t.amount === 500 && t.from === a1111.id && t.to === a2222.id), JSON.stringify(st.transfers));
  check('Скарбничка створюється як окремий рахунок', !!jar && st.transfers.some(t => t.from === a2222.id && t.to === jar.id && t.amount === 50));
  check('у Бюджет потрапляє лише звичайна покупка', (st.txs || []).length === 1 && st.txs[0].cat === 'Харчування' && st.txs[0].acc === a1111.id, JSON.stringify(st.txs));
  fs.rmSync(csv, { force: true });
}

// 4д. Картка, створена як контрагент без виписки, приймає валюту й початок з пізнішої виписки
{
  const p = await page();
  await seed(p, () => { s.accounts = []; s.txs = []; s.transfers = []; });
  const imp = async (text, name) => {
    await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
    const csv = path.join(ROOT, '..', 'tests', name);
    fs.writeFileSync(csv, text);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
    await fc.setFiles(csv); await p.waitForTimeout(700);
    await p.locator('button:visible').filter({ hasText: /^Імпортувати \d/ }).first().click(); await p.waitForTimeout(500);
    fs.rmSync(csv, { force: true });
  };
  const H = 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n';
  await imp(H + '02.10.2026;Зарахування зі своєї картки;4000 **** **** 1111;Зі своєї картки *3333;200;UAH;1200;UAH\n' +
    '01.10.2026;Супермаркети та продукти;4000 **** **** 1111;Магазин;-100;UAH;1000;UAH\n', '.adopt1.csv');
  await imp(H + '03.10.2026;Супермаркети та продукти;5000 **** **** 3333;Кав\'ярня;-10;USD;100;USD\n' +
    '02.10.2026;Переказ на свою картку;5000 **** **** 3333;На свою картку *1111;-40;USD;110;USD\n' +
    '01.10.2026;Поповнення;5000 **** **** 3333;Поповнення;150;USD;150;USD\n', '.adopt2.csv');
  const st = await stored(p);
  const a3333 = (st.accounts || []).find(a => a.last4 === '3333');
  check('картка з другої виписки отримала валюту USD', !!a3333 && a3333.cur === 'USD', JSON.stringify(a3333));
  check('старі перекази з цим рахунком замінено новими', (st.transfers || []).filter(t => t.from === (a3333 || {}).id || t.to === (a3333 || {}).id).length === 1, JSON.stringify(st.transfers));
  check('рахунок отримав початок з другої виписки (0 USD)', !!a3333 && a3333.open === 0, String(a3333 && a3333.open));
}

// 4е. Картка, на яку відкрито депозит, називається депозитом
{
  const p = await page();
  await seed(p, () => { s.accounts = []; s.txs = []; s.transfers = []; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.dep.csv');
  fs.writeFileSync(csv, 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n' +
    '09.08.2025;Заощадження;4000 **** **** 2222;Відкриття депозиту *7777;-60000;UAH;100000;UAH\n' +
    '10.08.2025;Заощадження;4000 **** **** 2222;Видача частини депозиту;5000;UAH;105000;UAH\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
  await fc.setFiles(csv); await p.waitForTimeout(700);
  await p.locator('button:visible').filter({ hasText: /^Імпортувати \d/ }).first().click(); await p.waitForTimeout(500);
  const st = await stored(p);
  const dep = (st.accounts || []).find(a => a.last4 === '7777');
  check('рахунок за депозитом названо депозитом', !!dep && dep.name === 'Депозит ···7777', JSON.stringify(dep));
  check('виведення з депозиту — переказ із депозиту, а не дохід у Бюджеті', (st.transfers || []).some(t => dep && t.from === dep.id && t.amount === 5000) && (st.txs || []).every(t => t.desc !== 'Видача частини депозиту'));
  check('депозит, відкритий у виписці, не потрапляє в попередження', await p.getByText('Депозит ···7777').count() === 0 || await p.getByText('Без виписки').count() === 0);
  fs.rmSync(csv, { force: true });
}

// 4є. Купівля ОВДП з картки йде в портфель і зменшує баланс картки (без подвійного обліку)
{
  const p = await page();
  await seed(p, () => { s.accounts = []; s.txs = []; s.transfers = []; s.portfolio = []; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.ovdp.csv');
  fs.writeFileSync(csv, 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n' +
    '02.10.2026;Інше;4000 **** **** 2222;Купівля державних облігацій;-1000;UAH;4000;UAH\n' +
    '01.10.2026;Зарахування;4000 **** **** 2222;Зарплата;5000;UAH;5000;UAH\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
  await fc.setFiles(csv); await p.waitForTimeout(700);
  const idx = await p.evaluate(() => [...document.querySelectorAll('select')].findIndex(s => (s.parentElement.firstElementChild || {}).textContent?.includes('Купівля державних облігацій')));
  await p.locator('select').nth(idx).selectOption('ОВДП'); await p.waitForTimeout(300);
  await p.locator('button:visible').filter({ hasText: /Нова позиція/ }).first().click(); await p.waitForTimeout(300);
  await p.locator('button:visible').filter({ hasText: /^Імпортувати \d/ }).first().click(); await p.waitForTimeout(500);
  check('звірка з випискою враховує купівлю ОВДП', await p.getByText('···2222 збігається з випискою').count() > 0);
  const st = await stored(p);
  const a = (st.accounts || []).find(x => x.last4 === '2222');
  const bal = a ? a.open + (st.txs || []).filter(t => t.acc === a.id).reduce((x, t) => x + (t.type === 'income' ? 1 : -1) * t.amount, 0) + (st.portfolio || []).flatMap(x => x.ops || []).filter(o => o.acc === a.id).reduce((x, o) => x + Number(o.accAmt), 0) : null;
  check('баланс картки після купівлі ОВДП = 4000, позиція = 1000', bal === 4000 && (st.portfolio || []).some(x => x.value === 1000), String(bal));
  fs.rmSync(csv, { force: true });
}

// 4ж. Купівля ОВДП, що вже лежить у Бюджеті як витрата, при повторному імпорті переходить у портфель без зміни балансу
{
  const p = await page();
  await seed(p, () => { s.accounts = []; s.txs = []; s.transfers = []; s.portfolio = []; });
  const H = 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку\n';
  const body = H + '02.10.2026;Інше;4000 **** **** 2222;Купівля державних облігацій;-1000;UAH;4000;UAH\n' + '01.10.2026;Зарахування;4000 **** **** 2222;Зарплата;5000;UAH;5000;UAH\n';
  const run = async mark => {
    await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
    const csv = path.join(ROOT, '..', 'tests', '.ovdp2.csv'); fs.writeFileSync(csv, body);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
    await fc.setFiles(csv); await p.waitForTimeout(700);
    if (mark) {
      const idx = await p.evaluate(() => [...document.querySelectorAll('select')].findIndex(s => (s.parentElement.firstElementChild || {}).textContent?.includes('Купівля державних облігацій')));
      await p.locator('select').nth(idx).selectOption('ОВДП'); await p.waitForTimeout(300);
      await p.locator('button:visible').filter({ hasText: /Нова позиція/ }).first().click(); await p.waitForTimeout(300);
    }
    await p.locator('button:visible').filter({ hasText: /^Імпортувати \d/ }).first().click(); await p.waitForTimeout(500);
    fs.rmSync(csv, { force: true });
  };
  await run(false); await run(true);
  const st = await stored(p);
  const a = (st.accounts || []).find(x => x.last4 === '2222');
  const bal = a.open + (st.txs || []).filter(t => t.acc === a.id).reduce((x, t) => x + (t.type === 'income' ? 1 : -1) * t.amount, 0) + (st.portfolio || []).flatMap(x => x.ops || []).filter(o => o.acc === a.id).reduce((x, o) => x + Number(o.accAmt), 0);
  check('після повторного імпорту баланс картки лишився 4000', bal === 4000, String(bal));
  check('купівля пішла в портфель і зникла з Бюджету', (st.portfolio || []).some(x => x.value === 1000) && !(st.txs || []).some(t => t.desc === 'Купівля державних облігацій'), JSON.stringify(st.txs));
}

// 4з. Операція з рахунку, віднесена в Бюджеті до ОВДП, зберігає зв'язок з рахунком (баланс картки зменшується)
{
  const p = await page({ viewport: { width: 390, height: 844 } });
  await seed(p, () => { s.accounts = [{ id: 'aT', name: 'Mono', cur: 'UAH', open: 1000 }]; s.txs = []; s.transfers = []; s.portfolio = []; });
  await reload(p);
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dБюджет/ }).first().click(); await p.waitForTimeout(400);
  await p.locator('button[aria-label="Додати операцію"]:visible').first().click(); await p.waitForTimeout(300);
  await p.locator('input[aria-label="Сума"]').fill('300');
  await p.locator('select[aria-label="Рахунок"]').last().selectOption({ label: 'Mono · UAH' });
  await p.locator('button:visible').filter({ hasText: /^ОВДП$/ }).first().click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Зберегти запис' }).click(); await p.waitForTimeout(400);
  await p.locator('button:visible').filter({ hasText: /Нова позиція/ }).first().click(); await p.waitForTimeout(500);
  const st = await stored(p);
  const op = ((st.portfolio || [])[0] || { ops: [] }).ops[0];
  check('інвестиційна операція зберігає рахунок і суму списання', !!op && op.acc === 'aT' && op.accAmt === -300, JSON.stringify(op));
  check('операція зникла з Бюджету, але баланс рахунку зменшився', (st.txs || []).length === 0 && !!op);
}

// 4и. Закритий рахунок не входить у капітал і списки, а його перекази не ламають баланс інших рахунків
{
  const p = await page({ viewport: { width: 390, height: 844 } });
  await seed(p, () => { s.accounts = [{ id: 'aA', name: 'Основна', cur: 'UAH', open: 1000 }, { id: 'aB', name: 'Стара', cur: 'UAH', open: 500 }]; s.txs = []; s.portfolio = []; s.transfers = [{ id: 1, date: '2026-01-01', from: 'aB', to: 'aA', amount: 200, amountTo: '' }]; });
  await reload(p);
  await p.locator('button[aria-label="Меню"]:visible').first().click(); await p.waitForTimeout(250);
  await p.locator('button:visible').filter({ hasText: /^0\dNet Worth/ }).first().click(); await p.waitForTimeout(400);
  const cash = () => p.evaluate(() => { const L = document.body.innerText.split('\n').map(x => x.trim()); return L[L.indexOf('Готівка') + 1]; });
  const before = await cash();
  await p.locator('button[aria-label="Закрити рахунок"]').nth(1).click(); await p.waitForTimeout(400);
  const after = await cash();
  const st = await stored(p);
  check('до закриття в готівці 1 500 (1 200 + 300)', before.startsWith('1') && /1\s?500/.test(before), before);
  check('закритий рахунок виходить із готівки, баланс основного лишається 1 200', /1\s?200/.test(after), after);
  check('рахунок позначено закритим, переказ збережено', (st.accounts || []).find(a => a.id === 'aB').closed === true && (st.transfers || []).length === 1);
  check('у Net Worth є розділ закритих рахунків', await p.getByText('Закриті рахунки').count() > 0);
}

// 4в. Категорії банку переводяться в ваші, решта стає новими категоріями одразу
{
  const p = await page();
  await seed(p, () => { s.accounts = []; });
  await reload(p); await p.keyboard.press('7'); await p.waitForTimeout(300);
  const csv = path.join(ROOT, '..', 'tests', '.bankcat.csv');
  fs.writeFileSync(csv, 'Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки\n' +
    '02.10.2026;Супермаркети та продукти;4000 **** **** 1111;Магазин;-100;UAH\n' +
    '01.10.2026;Побутова техніка;4000 **** **** 1111;Фокстрот;-500;UAH\n' +
    '01.10.2026;Зарахування;4000 **** **** 1111;Зарплата, ТОВ;300;UAH\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button[style*="dashed"]:visible').first().click()]);
  await fc.setFiles(csv); await p.waitForTimeout(700);
  const st = await stored(p);
  check('нові категорії з виписки додано до списку', ['Побутова техніка'].every(c => (st.categories || []).includes(c)), JSON.stringify(st.categories));
  const cats = await p.evaluate(() => [...document.querySelectorAll('select')].map(x => x.value).join(','));
  check('категорія банку переведена у вашу (Супермаркети → Харчування)', cats.startsWith('Харчування'), cats);
  check('зарплата розпізнається за описом', cats.includes('Зарплата'), cats);
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

// 16. «Очистити все» стирає всі особисті дані, включно з рахунками, боргами і калькулятором ОВДП
{
  const p = await page();
  await seed(p, () => {
    const d = new Date(), mk = n => d.getFullYear() + '-' + String(d.getMonth() + 1 - n).padStart(2, '0') + '-01';
    s.txs = [{ id: 1, type: 'expense', desc: 'Тест', amount: 500, cur: 'UAH', cat: 'Інше', date: mk(0) }];
    s.accounts = [{ id: 'a1', name: 'Картка', cur: 'UAH', open: 9000 }];
    s.debts = [{ id: 'd1', who: 'Іван', dir: 'owe', cur: 'UAH', total: 4000, due: '', pay: [] }];
    s.openBal = { UAH: '700', USD: '', EUR: '', PLN: '' };
    s.rules = [{ id: 1, t: 'тест', c: 'Інше' }];
  });
  await reload(p); await p.keyboard.press('8'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Очистити все' }).click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Підтвердити очищення' }).click(); await p.waitForTimeout(400);
  const st = await stored(p);
  check('після очищення немає операцій, рахунків, боргів, правил і початкового залишку',
    st.txs.length === 0 && st.accounts.length === 0 && st.debts.length === 0 && st.rules.length === 0 && !(st.openBal.UAH));
  await p.keyboard.press('0'); await p.waitForTimeout(400);
  const nw = (await p.locator('text=Загальний капітал').first().locator('xpath=following-sibling::*[1]').innerText()).replace(/\s/g, '');
  check('головний екран показує нуль, без залишків', /^0₴?$/.test(nw) || nw.startsWith('0'), nw);
  check('картка ОВДП не показує демонстраційних 16,4%', (await p.locator('text=16,4% YTM').count()) === 0);
}

check('жодної помилки JavaScript у консолі за весь час', errors.length === 0, errors.join('; '));
await browser.close(); server.close();
console.log(failed ? `\nНевдалих перевірок: ${failed}` : '\nУсі перевірки пройдено');
process.exit(failed ? 1 : 0);

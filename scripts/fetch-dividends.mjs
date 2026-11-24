// Считает топ-10 акций MOEX по дивидендной доходности за 1/3/5 лет в data/dividends.json.
// Доходность = сумма выплат за период / цена на начало периода.
// Источники: список бумаг и цены — MOEX ISS, дивиденды — ДОХОДЪ (dohod.ru).
// Запуск: node scripts/fetch-dividends.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { get } from './http.mjs';

const OUT_FILE = fileURLToPath(new URL('../data/dividends.json', import.meta.url));
const TOP = 10;
const WINDOWS = [
  { id: '1y', years: 1, label: '1 год' },
  { id: '3y', years: 3, label: '3 года' },
  { id: '5y', years: 5, label: '5 лет' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const iso = (d) => d.toISOString().slice(0, 10);
const shiftDays = (date, days) => new Date(date.getTime() + days * 86400000);

async function getJson(url, timeout = 30_000) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text } = await get(url, { timeout });
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function getText(url, timeout = 30_000) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { text } = await get(url, { timeout });
      return text;
    } catch (err) {
      if (err.status === 404) return null;
      lastError = err;
      if (attempt < 4) await sleep(err.status === 429 || err.status === 403 ? 4000 * attempt : 1500 * attempt);
    }
  }
  throw lastError;
}

// МОЕХ: все бумаги с последней ценой на основной доске акций.
async function listTickers() {
  const url =
    'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off';
  const j = await getJson(url);
  const { columns, data } = j.securities;
  const idx = (name) => columns.indexOf(name);
  const out = [];
  for (const row of data) {
    const prev = row[idx('PREVPRICE')];
    if (typeof prev !== 'number' || prev <= 0) continue;
    out.push({ ticker: row[idx('SECID')], name: row[idx('SHORTNAME')] });
  }
  return out;
}

// МОЕХ: цены закрытия всех бумаг на дату (или на ближайший торговый день до неё).
async function pricesAt(date, maxBack = 7) {
  for (let back = 0; back <= maxBack; back++) {
    const day = iso(shiftDays(date, -back));
    const out = new Map();
    for (let start = 0; ; start += 100) {
      const url =
        'https://iss.moex.com/iss/history/engines/stock/markets/shares/boards/TQBR/securities.json' +
        `?date=${day}&iss.meta=off&history.columns=SECID,CLOSE&limit=100&start=${start}`;
      const j = await getJson(url);
      const { columns, data } = j.history;
      const secIdx = columns.indexOf('SECID');
      const closeIdx = columns.indexOf('CLOSE');
      for (const row of data) {
        const close = row[closeIdx];
        if (typeof close === 'number' && close > 0) out.set(row[secIdx], close);
      }
      const total = j['history.cursor']?.data?.[0]?.[1] ?? 0;
      if (start + 100 >= total || !data.length) break;
      await sleep(120);
    }
    if (out.size) return { date: day, prices: out };
  }
  return null;
}

// ДОХОДЪ: выплаченные дивиденды (дата закрытия реестра, сумма). Прогнозы пропускаем.
function parseDohodPayments(html) {
  const tail = html.slice(html.indexOf('Все выплаты'));
  const out = [];
  for (const row of tail.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (/forecast/i.test(row[1])) continue;
    const cells = [...row[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 4) continue;
    const reg = cells[1].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const amount = Number(cells[3].replace(',', '.'));
    if (!reg || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ date: `${reg[3]}-${reg[2]}-${reg[1]}`, amount });
  }
  return out;
}

async function dividendsOf(ticker) {
  const html = await getText(`https://www.dohod.ru/ik/analytics/dividend/${ticker.toLowerCase()}`);
  return html ? parseDohodPayments(html) : [];
}

// Простой пул: не больше limit задач одновременно, результат по индексу.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = { error: err.message };
      }
      await sleep(120);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const today = new Date();
  const starts = WINDOWS.map((w) => {
    const d = new Date(today.getTime());
    d.setUTCFullYear(d.getUTCFullYear() - w.years);
    return { ...w, start: iso(d) };
  });

  const tickers = await listTickers();
  console.log(`Бумаг на TQBR с ценой: ${tickers.length}`);

  const prices = {};
  for (const s of starts) {
    const found = await pricesAt(new Date(`${s.start}T00:00:00Z`));
    if (!found) throw new Error(`MOEX не отдал цены на ${s.start}`);
    prices[s.id] = found;
    console.log(`${s.id}: старт ${s.start}, цены на ${found.date}, бумаг ${found.prices.size}`);
  }

  // Дивиденды тянем по всем бумагам один раз; ошибки отдельных бумаг не роняют расчёт.
  let empty = 0;
  let errors = 0;
  const divs = await pool(tickers, 2, async (t, i) => {
    if (i % 50 === 0) console.log(`дивиденды: ${i}/${tickers.length}`);
    const list = await dividendsOf(t.ticker);
    if (!list.length) empty++;
    return list;
  });
  for (const d of divs) if (!Array.isArray(d)) errors++;
  console.log(`Дивидендных историй нет: ${empty}; ошибок запросов: ${errors} из ${tickers.length}`);

  const results = {};
  for (const s of starts) {
    const { prices: byTicker } = prices[s.id];
    const items = [];
    tickers.forEach((t, i) => {
      const price = byTicker.get(t.ticker);
      if (!price) return;
      const list = Array.isArray(divs[i]) ? divs[i] : [];
      const paid = list.filter((p) => p.date > s.start && p.date <= iso(new Date()));
      if (!paid.length) return;
      const sum = paid.reduce((acc, p) => acc + p.amount, 0);
      // Больше 100% в год на акцию — почти всегда артефакт дробления/консолидации
      // (например, ВТБ: историческая цена до консолидации 2024 года в 5000 раз меньше).
      if (sum / price / s.years > 1) return;
      items.push({
        ticker: t.ticker,
        name: t.name,
        divs: Math.round(sum * 10000) / 10000,
        price: Math.round(price * 10000) / 10000,
        yield: Math.round((sum / price) * 1000) / 10,
        payments: paid.length,
      });
    });
    items.sort((a, b) => b.yield - a.yield);
    results[s.id] = {
      from: s.start,
      to: iso(new Date()),
      considered: items.length,
      items: items.slice(0, TOP),
    };
    console.log(`${s.id}: посчитано ${items.length}, топ: ${items.slice(0, 3).map((x) => `${x.ticker} ${x.yield}%`).join(', ')}`);
  }

  const payload = {
    updated: iso(new Date()),
    source: 'MOEX ISS + ДОХОДЪ',
    sourceUrl: 'https://www.dohod.ru/ik/analytics/dividend',
    note: 'Доходность = сумма дивидендов за период / цена на начало периода',
    periods: results,
  };

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), 'utf8');
  console.log(`Записано в ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

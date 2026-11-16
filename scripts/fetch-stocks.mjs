// Забирает историю цен акций с Московской биржи (ISS API) в data/stocks.json.
// Запуск: node scripts/fetch-stocks.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const START = '2021-01-01';
const OUT_FILE = fileURLToPath(new URL('../data/stocks.json', import.meta.url));

// Порядок задаёт и порядок плиток на странице.
const STOCKS = [
  { ticker: 'TRNFP', name: 'Транснефть ап' },
  { ticker: 'SBER', name: 'Сбербанк' },
  { ticker: 'MOEX', name: 'Московская биржа' },
  { ticker: 'GAZP', name: 'Газпром' },
  { ticker: 'X5', name: 'ИКС 5' },
  { ticker: 'MTSS', name: 'МТС' },
  { ticker: 'TRMK', name: 'ТМК' },
  { ticker: 'OZPH', name: 'Озон Фармацевтика' },
  { ticker: 'DATA', name: 'Группа Аренадата' },
  { ticker: 'MGNT', name: 'Магнит' },
  { ticker: 'OZON', name: 'Озон' },
  { ticker: 'LSRG', name: 'Группа ЛСР' },
  { ticker: 'RTKMP', name: 'Ростелеком ап' },
  { ticker: 'RUAL', name: 'РУСАЛ' },
  { ticker: 'ASTR', name: 'Группа Астра' },
  { ticker: 'T', name: 'Т-Технологии' },
  { ticker: 'KMAZ', name: 'КАМАЗ' },
  { ticker: 'SGZH', name: 'Сегежа' },
  { ticker: 'DIAS', name: 'Диасофт' },
  { ticker: 'AFLT', name: 'Аэрофлот' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candlesUrl = (ticker, start) =>
  'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/' +
  `${ticker}/candles.json?from=${START}&interval=24&iss.meta=off&limit=500&start=${start}`;

async function fetchCandles(ticker) {
  const byDate = new Map();

  for (let start = 0; ; start += 500) {
    let response = null;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(candlesUrl(ticker, start), {
          headers: { 'User-Agent': 'personal-charts/1.0 (+github actions cron)' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        response = await res.json();
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep(2000 * attempt);
      }
    }
    if (!response) throw new Error(`${ticker}: ${lastError?.message ?? 'неизвестная ошибка'}`);

    const { columns, data } = response.candles ?? { columns: [], data: [] };
    const dateIdx = columns.indexOf('begin');
    const closeIdx = columns.indexOf('close');

    for (const row of data) {
      const date = String(row[dateIdx]).slice(0, 10);
      const close = row[closeIdx];
      if (typeof close === 'number' && close > 0) byDate.set(date, Math.round(close * 10_000) / 10_000);
    }

    if (data.length < 500) break;
    await sleep(250);
  }

  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function main() {
  const series = {};
  const order = [];

  for (const { ticker, name } of STOCKS) {
    const points = await fetchCandles(ticker);
    if (!points.length) throw new Error(`${ticker}: биржа вернула пустую историю`);
    series[ticker] = { name, points };
    order.push(ticker);
    console.log(`${ticker.padEnd(6)} ${String(points.length).padStart(5)} точек, последняя ${points.at(-1).join(' = ')}`);
    await sleep(250);
  }

  const updated = Object.values(series)
    .map((s) => s.points.at(-1)[0])
    .sort()
    .at(-1);

  const payload = {
    updated,
    source: 'Мосбиржа (MOEX ISS)',
    sourceUrl: 'https://www.moex.com/',
    order,
    series,
  };

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), 'utf8');
  console.log(`Записано в ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

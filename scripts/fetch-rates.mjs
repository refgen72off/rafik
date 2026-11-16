// Забирает официальные курсы ЦБ РФ и складывает их в data/rates.json.
// Запуск: node scripts/fetch-rates.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const START_YEAR = 2016;
const OUT_FILE = fileURLToPath(new URL('../data/rates.json', import.meta.url));

// Чтобы добавить валюту — допишите строку: id берётся из XML ЦБ (R01235 — USD, R01239 — EUR,
// R01375 — CNY, R01280 — JPY).
const CURRENCIES = [
  { code: 'USD', id: 'R01235', label: 'Доллар США' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchYear(id, year) {
  const url =
    'https://www.cbr.ru/scripts/XML_dynamic.asp' +
    `?date_req1=01.01.${year}&date_req2=31.12.${year}&VAL_NM_RQ=${id}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'personal-charts/1.0 (+github actions cron)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = new TextDecoder('windows-1251').decode(await res.arrayBuffer());

      const points = [];
      for (const m of xml.matchAll(
        /<Record Date="(\d{2})\.(\d{2})\.(\d{4})"[^>]*>([\s\S]*?)<\/Record>/g,
      )) {
        const [, dd, mm, yyyy, body] = m;
        const rate = body.match(/<VunitRate>([\d.,]+)<\/VunitRate>/);
        const value = rate ? Number(rate[1].replace(',', '.')) : Number.NaN;
        if (Number.isFinite(value)) points.push([`${yyyy}-${mm}-${dd}`, value]);
      }
      return points;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  throw new Error(`${id}, ${year}: ${lastError?.message ?? 'неизвестная ошибка'}`);
}

async function main() {
  const series = {};

  for (const { code, id, label } of CURRENCIES) {
    const byDate = new Map();
    for (let year = START_YEAR; year <= new Date().getFullYear(); year++) {
      const points = await fetchYear(id, year);
      for (const [date, value] of points) byDate.set(date, value);
      console.log(`${code} ${year}: ${points.length}`);
      await sleep(300);
    }
    const points = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
    series[code] = { label, unit: '₽', points };
  }

  const updated = Object.values(series)
    .map((s) => s.points.at(-1)?.[0] ?? '')
    .sort()
    .at(-1);

  const payload = {
    updated,
    source: 'ЦБ РФ',
    sourceUrl: 'https://www.cbr.ru/currency_base/dynamics/',
    series,
  };

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), 'utf8');

  for (const [code, s] of Object.entries(series)) {
    console.log(`${code}: ${s.points.length} точек, последняя ${s.points.at(-1)?.join(' = ')}`);
  }
  console.log(`Записано в ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

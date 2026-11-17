// Забирает курс продажи USD в Примсоцбанке (Екатеринбург, наличные) в data/pskb.json.
// История накапливается: каждый запуск дописывает (или обновляет) точку за текущий день —
// на сайте банка истории нет, только «курс на сегодня».
// Запуск: node scripts/fetch-pskb.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { fileURLToPath } from 'node:url';

const CITY_ID = 15; // Екатеринбург (id из списка городов на сайте)
const CITY_NAME = 'Екатеринбург';
const OUT_FILE = fileURLToPath(new URL('../data/pskb.json', import.meta.url));

// Сайт подписан УЦ Минцифры: этого корня нет в стандартном наборе Node и на раннере
// GitHub Actions, а промежуточный сертификат сервер не отдаёт. Кладём оба рядом и
// проверяем цепочку по-настоящему, без отключения TLS. Промежуточный взят из AIA
// сертификата сайта (subca_ssl_rsa2024.crt):
//   root — SHA-256 D2:6D:2D:02:…:8E:CF:31, до 2032-02-27;
//   sub  — SHA-256 21:55:78:50:…:88:A3:F2, до 2029-07-19 (когда истечёт — обновить файл).
const ROOT_CA = await readFile(new URL('./certs/russian_trusted_root_ca.pem', import.meta.url), 'utf8');
const SUB_CA = await readFile(new URL('./certs/russian_trusted_sub_ca_ssl_rsa2024.pem', import.meta.url), 'utf8');
const TRUSTED = [ROOT_CA, SUB_CA];

const UA = 'personal-charts/1.0 (+github actions cron)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Дата по Москве: крон ходит в 17:40 МСК, и точка не должна съезжать на соседний день.
const todayMoscow = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());

function httpsGet(url, { headers = {}, timeout = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'User-Agent': UA, ...headers }, ca: TRUSTED, timeout }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 400) reject(new Error(`HTTP ${status} (${url})`));
        else resolve({ status, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`таймаут (${url})`)));
    req.on('error', reject);
    req.end();
  });
}

// Город на сайте хранится в сессии: сначала setcity, потом страница с той же кукой.
async function fetchSession() {
  const res = await httpsGet(`https://pskb.com/ajax/setcity.php?city=${CITY_ID}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    timeout: 30_000,
  });
  const cookies = [res.headers['set-cookie'] ?? []].flat();
  const session = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
  if (!session) throw new Error('setcity: в Set-Cookie нет PHPSESSID');
  return session;
}

async function fetchSell(cookie) {
  const { text: html } = await httpsGet('https://pskb.com/currency/', { headers: { Cookie: cookie } });

  // Страховка: без города в сессии сайт отдаст Владивосток, и курс молча запишется чужой.
  if (!html.includes(CITY_NAME)) throw new Error(`на странице нет города «${CITY_NAME}» — сессия не применилась`);

  const offline = html.match(/id="offline"[\s\S]*?<\/table>/)?.[0];
  if (!offline) throw new Error('не нашлась таблица «Наличные»');

  // Строка USD: <td>покупка</td><td>продажа</td>, берём третью колонку.
  const row = offline.match(/<td><strong>USD<\/strong>[\s\S]*?<td>([\d.,]+)<\/td>\s*<td>([\d.,]+)<\/td>/);
  if (!row) throw new Error('в таблице «Наличные» нет строки USD');

  const sell = Number(row[2].replace(',', '.'));
  if (!Number.isFinite(sell) || sell <= 0) throw new Error(`странное значение продажи: ${row[2]}`);
  return sell;
}

async function loadPoints() {
  try {
    const payload = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    return payload.series?.PSKB_SELL?.points ?? [];
  } catch {
    return [];
  }
}

async function main() {
  let sell;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const cookie = await fetchSession();
      sell = await fetchSell(cookie);
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  if (sell === undefined) throw new Error(lastError?.message ?? 'неизвестная ошибка');

  const byDate = new Map(await loadPoints());
  const date = todayMoscow();
  byDate.set(date, sell);
  const points = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const payload = {
    updated: points.at(-1)[0],
    source: 'Примсоцбанк',
    sourceUrl: 'https://pskb.com/currency/',
    city: CITY_NAME,
    series: {
      PSKB_SELL: { label: 'Примсоцбанк, продажа', unit: '₽', points },
    },
  };

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), 'utf8');

  console.log(`Примсоцбанк (${CITY_NAME}): продажа USD ${sell} на ${date}; точек: ${points.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

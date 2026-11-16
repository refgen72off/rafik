'use strict';

// ---------- настройки ----------

const RANGES = [
  { id: '1m', label: '1М', months: 1 },
  { id: '3m', label: '3М', months: 3 },
  { id: '6m', label: '6М', months: 6 },
  { id: '1y', label: '1Г', months: 12 },
  { id: '3y', label: '3Г', months: 36 },
  { id: '5y', label: '5Г', months: 60 },
  { id: 'all', label: 'Всё', months: null },
];
const DEFAULT_RANGE = '1y';

const ACCENT = '#5b9dff';
const UP = '#4ade80';
const DOWN = '#f87171';
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// ---------- форматирование ----------

const num = (value, max = 2) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Math.min(2, max),
    maximumFractionDigits: max,
  }).format(value);

// Цены: до рубля — копейки, дешевле рубля — четыре знака.
const priceText = (value) => num(value, Math.abs(value) < 1 ? 4 : 2);

const longDate = (iso) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

const shortDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

// ---------- работа с рядами ----------

const monthStart = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

const spanDays = (points) => {
  const first = new Date(`${points[0][0]}T00:00:00Z`);
  const last = new Date(`${points[points.length - 1][0]}T00:00:00Z`);
  return (last - first) / 86400000;
};

const tickUnit = (days) => (days <= 75 ? 'day' : days <= 1100 ? 'month' : 'quarter');

const tickFormatter = (days) => (value) => {
  const d = new Date(value);
  const month = MONTHS[d.getMonth()];
  return days <= 75 ? `${d.getDate()} ${month}` : `${month} ${String(d.getFullYear()).slice(2)}`;
};

const prettyDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// Оставляет не больше max точек, равномерно по ряду — для миниатюр.
const downsample = (points, max = 80) => {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.min(points.length - 1, Math.round(i * step))]);
};

function sliceRange(points, rangeId, lastDate) {
  const cfg = RANGES.find((r) => r.id === rangeId);
  if (!cfg?.months || points.length < 3) return points;
  const since = monthStart(lastDate, cfg.months).toISOString().slice(0, 10);
  const slice = points.filter(([d]) => d >= since);
  return slice.length > 1 ? slice : points.slice(-2);
}

const seriesPoints = (points) => points.map(([date, value]) => ({ x: `${date}T00:00:00`, y: value }));

// ---------- графики ----------

function tooltipPlugin(unit) {
  return {
    backgroundColor: 'rgba(12, 18, 28, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    padding: 10,
    titleColor: '#e8edf5',
    bodyColor: '#e8edf5',
    displayColors: false,
    callbacks: {
      title: (items) => longDate(String(items[0].raw.x).slice(0, 10)),
      label: (item) => `${priceText(item.parsed.y)} ${unit}`,
    },
  };
}

function createDetailChart(canvas, points, unit = '₽') {
  const ctx = canvas.getContext('2d');

  const fill = (c) => {
    const { chartArea } = c.chart;
    if (!chartArea) return 'transparent';
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, 'rgba(91, 157, 255, 0.32)');
    g.addColorStop(1, 'rgba(91, 157, 255, 0)');
    return g;
  };

  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Цена',
          data: seriesPoints(points),
          borderColor: ACCENT,
          borderWidth: 2,
          fill: true,
          backgroundColor: fill,
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: ACCENT,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: tooltipPlugin(unit),
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'dd.MM.yyyy', unit: tickUnit(spanDays(points)) },
          grid: { display: false },
          border: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: {
            color: '#8b97ab',
            maxRotation: 0,
            autoSkipPadding: 24,
            callback: tickFormatter(spanDays(points)),
          },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          border: { display: false },
          ticks: {
            color: '#8b97ab',
            callback: (value) => `${priceText(value)} ${unit}`,
          },
        },
      },
    },
  });
}

function updateDetailChart(chart, points, unit = '₽') {
  const days = spanDays(points);
  chart.data.datasets[0].data = seriesPoints(points);
  chart.options.scales.x.time.unit = tickUnit(days);
  chart.options.scales.x.ticks.callback = tickFormatter(days);
  chart.options.plugins.tooltip = tooltipPlugin(unit);
  chart.update();
}

function createSpark(canvas) {
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { datasets: [{ data: [], borderWidth: 1.5, pointRadius: 0, tension: 0.25, borderColor: ACCENT }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// ---------- статистика ----------

function renderStats(container, points, unit = '₽') {
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map(([, v]) => v);
  const diff = last[1] - first[1];
  const pct = first[1] ? (diff / first[1]) * 100 : 0;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';

  container.innerHTML = `
    <div><dt>Изменение за период</dt><dd class="${cls}">${sign}${priceText(Math.abs(diff))} ${unit} · ${sign}${num(Math.abs(pct), 1)} %</dd></div>
    <div><dt>Минимум</dt><dd>${priceText(Math.min(...values))} ${unit}</dd></div>
    <div><dt>Максимум</dt><dd>${priceText(Math.max(...values))} ${unit}</dd></div>
  `;
}

// ---------- переключатель периодов ----------

function createRanges(container, initial, onChange) {
  let range = initial;

  for (const r of RANGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'range';
    btn.textContent = r.label;
    btn.dataset.range = r.id;
    btn.setAttribute('aria-pressed', String(r.id === range));
    btn.addEventListener('click', () => {
      range = r.id;
      for (const other of container.children) other.setAttribute('aria-pressed', String(other === btn));
      onChange(range);
    });
    container.append(btn);
  }

  return initial;
}

// ---------- карточка валюты ----------

async function initCurrency() {
  const metaEl = document.getElementById('usd-meta');
  const valueEl = document.getElementById('usd-value');
  const statsEl = document.getElementById('usd-stats');
  const errorEl = document.getElementById('usd-error');
  const canvas = document.getElementById('usd-chart');
  const rangesEl = document.getElementById('usd-ranges');
  const updatedEl = document.getElementById('updated-fx');

  let data;
  try {
    const res = await fetch('data/rates.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    metaEl.textContent = 'данные не загрузились';
    errorEl.hidden = false;
    errorEl.textContent = `Не удалось загрузить data/rates.json (${err.message}).`;
    return;
  }

  const all = data.series?.USD?.points;
  if (!all?.length) {
    metaEl.textContent = 'в данных нет ряда USD';
    return;
  }

  const lastDate = all[all.length - 1][0];
  let chart = null;

  const draw = (range) => {
    const points = sliceRange(all, range, lastDate);
    renderStats(statsEl, points);
    metaEl.textContent = `ЦБ РФ · ${shortDate(points[0][0])} — ${shortDate(points[points.length - 1][0])}`;
    if (!chart) chart = createDetailChart(canvas, points);
    else updateDetailChart(chart, points);
  };

  valueEl.textContent = `${num(all[all.length - 1][1], 4)} ₽`;
  if (updatedEl && data.updated) updatedEl.textContent = longDate(data.updated);
  createRanges(rangesEl, DEFAULT_RANGE, draw);
  draw(DEFAULT_RANGE);
}

// ---------- карточка акций ----------

async function initStocks() {
  const metaEl = document.getElementById('stocks-meta');
  const nameEl = document.getElementById('stock-name');
  const valueEl = document.getElementById('stock-value');
  const statsEl = document.getElementById('stock-stats');
  const errorEl = document.getElementById('stocks-error');
  const canvas = document.getElementById('stock-chart');
  const rangesEl = document.getElementById('stocks-ranges');
  const tilesEl = document.getElementById('stock-tiles');
  const updatedEl = document.getElementById('updated-stocks');

  let data;
  try {
    const res = await fetch('data/stocks.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    metaEl.textContent = 'данные не загрузились';
    errorEl.hidden = false;
    errorEl.textContent = `Не удалось загрузить data/stocks.json (${err.message}).`;
    return;
  }

  const order = (data.order ?? Object.keys(data.series ?? {})).filter((t) => data.series?.[t]?.points?.length);
  if (!order.length) {
    metaEl.textContent = 'в данных нет ни одной бумаги';
    return;
  }

  const lastDate = (ticker) => data.series[ticker].points.at(-1)[0];
  const tiles = new Map();
  let selected = order[0];
  let currentRange = DEFAULT_RANGE;
  let chart = null;

  for (const ticker of order) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tile';
    el.dataset.ticker = ticker;
    el.setAttribute('aria-pressed', String(ticker === selected));
    el.innerHTML = `
      <span class="tile-name">${data.series[ticker].name}</span>
      <span class="tile-ticker">${ticker}</span>
      <span class="spark"><canvas></canvas></span>
      <span class="tile-price">—</span>
      <span class="tile-change">—</span>
    `;
    el.addEventListener('click', () => {
      selected = ticker;
      draw(currentRange);
    });
    tilesEl.append(el);

    tiles.set(ticker, {
      el,
      spark: createSpark(el.querySelector('canvas')),
      price: el.querySelector('.tile-price'),
      change: el.querySelector('.tile-change'),
    });
  }

  const draw = (range) => {
    currentRange = range;

    for (const ticker of order) {
      const tile = tiles.get(ticker);
      const points = sliceRange(data.series[ticker].points, range, lastDate(ticker));
      const first = points[0][1];
      const last = points[points.length - 1][1];
      const diff = last - first;
      const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
      const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';

      tile.spark.data.datasets[0].data = seriesPoints(downsample(points));
      tile.spark.data.datasets[0].borderColor = diff >= 0 ? UP : DOWN;
      tile.spark.update();

      tile.price.textContent = `${priceText(last)} ₽`;
      tile.change.textContent = `${sign}${num(Math.abs(first ? (diff / first) * 100 : 0), 1)} %`;
      tile.change.className = `tile-change ${cls}`;
      tile.el.setAttribute('aria-pressed', String(ticker === selected));
    }

    const series = data.series[selected];
    const points = sliceRange(series.points, range, lastDate(selected));
    const first = points[0][1];
    const last = points[points.length - 1][1];
    const pct = first ? ((last - first) / first) * 100 : 0;

    nameEl.textContent = series.name;
    valueEl.textContent = `${priceText(last)} ₽`;
    valueEl.title = `${pct >= 0 ? '+' : '−'}${num(Math.abs(pct), 1)} % за период`;
    renderStats(statsEl, points);
    metaEl.textContent = `${selected} · Мосбиржа · ${shortDate(points[0][0])} — ${shortDate(points[points.length - 1][0])}`;

    if (!chart) chart = createDetailChart(canvas, points);
    else updateDetailChart(chart, points);
  };

  if (updatedEl && data.updated) updatedEl.textContent = longDate(data.updated);
  createRanges(rangesEl, DEFAULT_RANGE, draw);
  draw(DEFAULT_RANGE);
}

// ---------- запуск ----------

initCurrency();
initStocks();

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
const RATE_COLOR = '#f7b955';
const PSB_COLOR = '#4ade80';
const INDEX_COLOR = '#c084fc';
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

// Для ступенчатой ставки нужна точка, действовавшая на начало периода,
// иначе линия начнётся только с первого изменения внутри окна.
// Дата этой точки заменяется на fromDate: со своей исходной датой (например,
// последним решением ЦБ) она растягивает общую ось X за пределы выбранного периода.
function sliceRatePoints(ratePoints, fromDate) {
  const next = ratePoints.findIndex(([date]) => date > fromDate);
  const slice = next === -1 ? ratePoints.slice(-1) : ratePoints.slice(Math.max(0, next - 1));
  return slice.map(([date, value], i) => (i === 0 && date < fromDate ? [fromDate, value] : [date, value]));
}

// Продлевает последнюю ставку до конца окна: иначе ступенька обрывается на дате
// последнего решения ЦБ, хотя эта ставка действует до сих пор.
function extendRate(ratePoints, marketPoints) {
  if (!ratePoints.length || !marketPoints.length) return ratePoints;
  const end = marketPoints[marketPoints.length - 1][0];
  const last = ratePoints[ratePoints.length - 1];
  return last[0] >= end ? ratePoints : [...ratePoints, [end, last[1]]];
}

const ts = (iso) => new Date(`${iso}T00:00:00`).getTime();

// Границы, за которые зум/сдвиг не выходят: только даты из текущего ряда.
function applyZoomLimits(chart, points) {
  const plugin = chart.options.plugins?.zoom;
  if (!plugin) return;
  plugin.limits = {
    x: {
      min: ts(points[0][0]),
      max: ts(points[points.length - 1][0]),
      minRange: 3 * 86400000,
    },
  };
}

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
      label: (item) => {
        const suffix = item.dataset.unit ?? unit;
        const value = suffix === '%' ? num(item.parsed.y, 2) : priceText(item.parsed.y);
        return `${item.dataset.label ?? 'Курс'}: ${value} ${suffix}`;
      },
    },
  };
}

// Ключевая ставка — ступенчатая линия на своей оси, поверх курса.
function rateDataset(points, visible = true) {
  return {
    id: 'rate',
    label: 'Ключевая ставка',
    unit: '%',
    data: seriesPoints(points),
    yAxisID: 'rate',
    borderColor: RATE_COLOR,
    borderWidth: 1.8,
    borderDash: [5, 4],
    fill: false,
    stepped: true,
    pointRadius: 0,
    pointHitRadius: 8,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: RATE_COLOR,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    spanGaps: true,
    hidden: !visible,
  };
}

// Курс продажи доллара в Примсоцбанке — зелёная линия на той же оси ₽, что и курс ЦБ.
function psbDataset(points, visible = true) {
  return {
    id: 'pskb',
    label: 'Примсоцбанк, продажа',
    unit: '₽',
    data: seriesPoints(points),
    borderColor: PSB_COLOR,
    borderWidth: 2,
    fill: false,
    // пока в истории одна-две точки, линия не рисуется — показываем маркеры
    pointRadius: points.length < 3 ? 3 : 0,
    pointHitRadius: 8,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: PSB_COLOR,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    spanGaps: true,
    tension: 0.15,
    hidden: !visible,
  };
}

// Ваши точки по курсу Примсоцбанка за прошлые даты — только маркеры, без линии:
// даты редкие, линия между ними врала бы про непрерывность.
function psbHistoryDataset(points, visible = true) {
  return {
    id: 'pskb-history',
    label: 'Примсоцбанк, ваши точки',
    unit: '₽',
    data: seriesPoints(points),
    showLine: false,
    borderColor: PSB_COLOR,
    backgroundColor: PSB_COLOR,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointHitRadius: 10,
    hidden: !visible,
  };
}

const RATE_SCALE = {
  position: 'left',
  min: 0,
  grid: { display: false },
  border: { display: false },
  ticks: {
    color: '#8b97ab',
    padding: 6,
    // ставка бывает дробной (14,25), поэтому без принудительных нулей
    callback: (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} %`,
  },
};

// Индекс МосБиржи — пункты, а не рубли: своя левая ось, чтобы не ломать масштаб цен.
const INDEX_SCALE = {
  position: 'left',
  grid: { display: false },
  border: { display: false },
  ticks: {
    color: '#8b97ab',
    padding: 6,
    callback: (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value),
  },
};

function indexDataset(points, label, visible = true) {
  return {
    id: 'imoex',
    label,
    unit: 'п.',
    data: seriesPoints(points),
    yAxisID: 'index',
    borderColor: INDEX_COLOR,
    borderWidth: 1.8,
    fill: false,
    pointRadius: 0,
    pointHitRadius: 8,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: INDEX_COLOR,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    spanGaps: true,
    tension: 0.2,
    hidden: !visible,
  };
}

function createDetailChart(
  canvas,
  points,
  {
    unit = '₽',
    resetButton = null,
    ratePoints = null,
    showRate = true,
    psbPoints = null,
    showPsb = true,
    historyPoints = null,
    indexPoints = null,
    indexLabel = 'Индекс МосБиржи',
    showIndex = true,
    priceLabel = 'ЦБ РФ',
  } = {},
) {
  const ctx = canvas.getContext('2d');
  let chart = null;

  const syncReset = () => {
    if (resetButton) resetButton.hidden = !chart?.isZoomedOrPanned();
  };

  const fill = (c) => {
    const { chartArea } = c.chart;
    if (!chartArea) return 'transparent';
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, 'rgba(91, 157, 255, 0.32)');
    g.addColorStop(1, 'rgba(91, 157, 255, 0)');
    return g;
  };

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          id: 'cbr',
          label: priceLabel,
          unit: '₽',
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
        ...(ratePoints?.length ? [rateDataset(ratePoints, showRate)] : []),
        ...(psbPoints?.length ? [psbDataset(psbPoints, showPsb)] : []),
        ...(historyPoints?.length ? [psbHistoryDataset(historyPoints, showPsb)] : []),
        ...(indexPoints?.length ? [indexDataset(indexPoints, indexLabel, showIndex)] : []),
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
        zoom: {
          pan: { enabled: true, mode: 'x', threshold: 6, onPanComplete: syncReset },
          zoom: {
            wheel: { enabled: true, speed: 0.08 },
            pinch: { enabled: true },
            mode: 'x',
            onZoomComplete: syncReset,
          },
          limits: {
            x: { min: ts(points[0][0]), max: ts(points[points.length - 1][0]), minRange: 3 * 86400000 },
          },
        },
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
        ...(ratePoints?.length ? { rate: { ...RATE_SCALE } } : {}),
        ...(indexPoints?.length ? { index: { ...INDEX_SCALE } } : {}),
      },
    },
  });

  chart.syncReset = syncReset;
  resetButton?.addEventListener('click', () => {
    chart.resetZoom();
    syncReset();
  });

  return chart;
}

function updateDetailChart(
  chart,
  points,
  unit = '₽',
  ratePoints = null,
  psbPoints = null,
  historyPoints = null,
  indexPoints = null,
  indexLabel = null,
  priceLabel = null,
) {
  const byId = (id) => chart.data.datasets.find((d) => d.id === id);
  const days = spanDays(points);
  const priceDs = byId('cbr');
  priceDs.data = seriesPoints(points);
  if (priceLabel) priceDs.label = priceLabel;
  const rateDs = byId('rate');
  if (rateDs) rateDs.data = seriesPoints(ratePoints ?? []);
  const psbDs = byId('pskb');
  if (psbDs) {
    psbDs.data = seriesPoints(psbPoints ?? []);
    psbDs.pointRadius = (psbPoints?.length ?? 0) < 3 ? 3 : 0;
  }
  const historyDs = byId('pskb-history');
  if (historyDs) historyDs.data = seriesPoints(historyPoints ?? []);
  else if (historyPoints?.length) chart.data.datasets.push(psbHistoryDataset(historyPoints));
  const indexDs = byId('imoex');
  if (indexDs) {
    indexDs.data = seriesPoints(indexPoints ?? []);
    if (indexLabel) indexDs.label = indexLabel;
  } else if (indexPoints?.length) {
    chart.data.datasets.push(indexDataset(indexPoints, indexLabel ?? 'Индекс МосБиржи'));
    chart.options.scales.index = { ...INDEX_SCALE };
  }
  chart.options.scales.x.time.unit = tickUnit(days);
  chart.options.scales.x.ticks.callback = tickFormatter(days);
  chart.options.plugins.tooltip = tooltipPlugin(unit);
  applyZoomLimits(chart, points);
  chart.update('none');
  chart.resetZoom('none');
  chart.syncReset?.();
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
  const errorEl = document.getElementById('usd-error');
  const canvas = document.getElementById('usd-chart');
  const rangesEl = document.getElementById('usd-ranges');
  const resetButton = document.getElementById('usd-reset');
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
  const rate = data.series?.RATE?.points ?? [];

  // Курс Примсоцбанка — отдельный файл: его отсутствие не должно ломать график ЦБ.
  let psb = [];
  try {
    const res = await fetch('data/pskb.json', { cache: 'no-cache' });
    if (res.ok) psb = (await res.json()).series?.PSKB_SELL?.points ?? [];
  } catch {
    /* линии Примсоцбанка просто не будет */
  }
  const psbLastDate = psb.length ? psb[psb.length - 1][0] : null;

  // Ваши точки по прошлым датам — отдельный файл, только маркеры.
  let psbHistory = [];
  try {
    const res = await fetch('data/pskb-history.json', { cache: 'no-cache' });
    if (res.ok) psbHistory = (await res.json()).series?.PSKB_HISTORY?.points ?? [];
  } catch {
    /* точек не будет, линия остаётся */
  }

  const psbToggle = document.getElementById('pskb-toggle');
  let showPsb = psb.length > 0 || psbHistory.length > 0;
  let chart = null;

  if (psbToggle) {
    psbToggle.hidden = !(psb.length || psbHistory.length);
    psbToggle.setAttribute('aria-pressed', String(showPsb));
    psbToggle.addEventListener('click', () => {
      showPsb = !showPsb;
      psbToggle.setAttribute('aria-pressed', String(showPsb));
      if (!chart) return;
      chart.data.datasets.forEach((dataset, index) => {
        if (dataset.id === 'pskb' || dataset.id === 'pskb-history') chart.setDatasetVisibility(index, showPsb);
      });
      chart.update();
    });
  }

  const rateToggle = document.getElementById('rate-toggle');
  let showRate = rate.length > 0;

  if (rateToggle) {
    rateToggle.hidden = !rate.length;
    rateToggle.setAttribute('aria-pressed', String(showRate));
    rateToggle.addEventListener('click', () => {
      showRate = !showRate;
      rateToggle.setAttribute('aria-pressed', String(showRate));
      if (!chart) return;
      const index = chart.data.datasets.findIndex((d) => d.id === 'rate');
      if (index >= 0) chart.setDatasetVisibility(index, showRate);
      chart.options.scales.rate.display = showRate;
      chart.update();
    });
  }

  const draw = (range) => {
    const points = sliceRange(all, range, lastDate);
    const ratePoints = rate.length ? extendRate(sliceRatePoints(rate, points[0][0]), points) : [];
    const psbPoints = psb.length ? sliceRange(psb, range, psbLastDate) : [];
    // Точки режем по окну графика (по ЦБ), а не по своей последней дате:
    // иначе редкие старые точки растягивали ось за пределы выбранного периода.
    const historyPoints = psbHistory.length ? psbHistory.filter(([d]) => d >= points[0][0]) : [];
    metaEl.textContent = `ЦБ РФ · ${shortDate(points[0][0])} — ${shortDate(points[points.length - 1][0])}`;
    if (!chart)
      chart = createDetailChart(canvas, points, {
        resetButton,
        ratePoints,
        showRate,
        psbPoints,
        showPsb,
        historyPoints,
      });
    else updateDetailChart(chart, points, '₽', ratePoints, psbPoints, historyPoints);
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
  const errorEl = document.getElementById('stocks-error');
  const canvas = document.getElementById('stock-chart');
  const rangesEl = document.getElementById('stocks-ranges');
  const resetButton = document.getElementById('stock-reset');
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
  const indexData = data.index?.points?.length ? data.index : null;
  const tiles = new Map();
  let selected = order[0];
  let currentRange = DEFAULT_RANGE;
  let chart = null;

  const indexToggle = document.getElementById('imoex-toggle');
  let showIndex = !!indexData;

  if (indexToggle) {
    indexToggle.hidden = !indexData;
    indexToggle.setAttribute('aria-pressed', String(showIndex));
    indexToggle.addEventListener('click', () => {
      showIndex = !showIndex;
      indexToggle.setAttribute('aria-pressed', String(showIndex));
      if (!chart) return;
      const index = chart.data.datasets.findIndex((d) => d.id === 'imoex');
      if (index >= 0) chart.setDatasetVisibility(index, showIndex);
      chart.options.scales.index.display = showIndex;
      chart.update();
    });
  }

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
    metaEl.textContent = `${selected} · Мосбиржа · ${shortDate(points[0][0])} — ${shortDate(points[points.length - 1][0])}`;

    // Индекс режем по окну выбранной бумаги: иначе его крайние даты растянут ось X.
    const indexPoints = indexData
      ? indexData.points.filter(([d]) => d >= points[0][0] && d <= points[points.length - 1][0])
      : [];

    if (!chart)
      chart = createDetailChart(canvas, points, {
        resetButton,
        indexPoints,
        indexLabel: indexData?.name,
        showIndex,
        priceLabel: series.name,
      });
    else updateDetailChart(chart, points, '₽', null, null, null, indexPoints, indexData?.name, series.name);
  };

  if (updatedEl && data.updated) updatedEl.textContent = longDate(data.updated);
  createRanges(rangesEl, DEFAULT_RANGE, draw);
  draw(DEFAULT_RANGE);
}

// ---------- свободная раскладка окон ----------

const LAYOUT_KEY = 'rafik.layout.v1';
const MIN_W = 360;
const MIN_H = 300;

function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function saveLayout(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* приватный режим: раскладка просто не запомнится */
  }
}

function initDesk() {
  const desk = document.getElementById('desk');
  if (!desk) return;

  const panels = [...desk.querySelectorAll('.panel')];
  const resetBtn = document.getElementById('layout-reset');
  const isDesktop = () => window.matchMedia('(min-width: 901px)').matches;

  let layout = loadLayout();
  const hasSavedLayout = () => !!layout && Object.keys(layout).length > 0;
  let custom = hasSavedLayout();
  let lastWidth = -1;
  let zTop = 1;

  const defaultLayout = () => {
    const width = desk.clientWidth;
    const out = {};
    let y = 0;
    for (const panel of panels) {
      const height = panel.dataset.panel === 'fx' ? 640 : 860;
      out[panel.dataset.panel] = { x: 0, y, w: width, h: height };
      y += height + 24;
    }
    return out;
  };

  const place = (panel, box) => {
    panel.style.left = `${box.x}px`;
    panel.style.top = `${box.y}px`;
    panel.style.width = `${box.w}px`;
    panel.style.height = `${box.h}px`;
  };

  const clearInline = () => {
    desk.style.height = '';
    for (const panel of panels) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
    }
  };

  const fitDesk = () => {
    let bottom = 0;
    for (const panel of panels) {
      const box = layout[panel.dataset.panel];
      if (box) bottom = Math.max(bottom, box.y + box.h);
    }
    desk.style.height = `${bottom + 24}px`;
  };

  const clampAll = () => {
    const width = desk.clientWidth;
    for (const panel of panels) {
      const box = layout[panel.dataset.panel];
      if (!box) continue;
      box.w = Math.max(MIN_W, Math.min(box.w, width));
      box.x = Math.max(0, Math.min(box.x, Math.max(0, width - box.w)));
      box.h = Math.max(MIN_H, box.h);
      box.y = Math.max(0, box.y);
    }
  };

  const render = () => {
    if (!isDesktop()) return;
    // пока пользователь не двигал окна, раскладка следует за шириной экрана
    if (!custom) layout = defaultLayout();
    clampAll();
    for (const panel of panels) place(panel, layout[panel.dataset.panel]);
    fitDesk();
    if (resetBtn) resetBtn.hidden = false;
    lastWidth = desk.clientWidth;
  };

  layout = layout ?? defaultLayout();
  render();

  // Chart.js 4.4 откладывает resize() до следующего draw, если анимация «запущена»,
  // поэтому после смены размеров панели графики нужно явно перерисовать.
  const resizeCharts = () => {
    for (const chart of Object.values(Chart.instances)) {
      chart.resize();
      chart.draw();
    }
  };

  // Ширина «стола» меняется, когда появляется вертикальный скроллбар или двигается окно:
  // раскладка по умолчанию подстраивается, пользовательская — только поджимается.
  const deskObserver = new ResizeObserver(() => {
    if (!isDesktop()) return;
    if (Math.abs(desk.clientWidth - lastWidth) < 1) return;
    render();
    resizeCharts();
  });
  deskObserver.observe(desk);

  const beginMove = (panel, mode, event) => {
    if (!isDesktop() || event.button !== 0) return;
    event.preventDefault();

    const key = panel.dataset.panel;
    const origin = { ...layout[key] };
    const from = { x: event.clientX, y: event.clientY };
    const cursor =
      mode === 'drag' ? 'grabbing' : mode === 'e' ? 'ew-resize' : mode === 's' ? 'ns-resize' : 'nwse-resize';

    panel.style.zIndex = String(++zTop + 1);
    panel.dataset.active = 'true';
    document.body.classList.add('is-moving');
    document.body.style.cursor = cursor;

    const move = (e) => {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      const box = { ...origin };

      if (mode === 'drag') {
        box.x = Math.max(0, Math.min(desk.clientWidth - 80, origin.x + dx));
        box.y = Math.max(0, origin.y + dy);
      } else {
        if (mode.includes('e')) box.w = Math.max(MIN_W, Math.min(desk.clientWidth - origin.x, origin.w + dx));
        if (mode.includes('s')) box.h = Math.max(MIN_H, origin.h + dy);
      }

      layout[key] = box;
      place(panel, box);
      fitDesk();
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      document.body.classList.remove('is-moving');
      document.body.style.cursor = '';
      delete panel.dataset.active;
      custom = true;
      saveLayout(layout);
      resizeCharts();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  for (const panel of panels) {
    for (const dir of ['e', 's', 'se']) {
      const grip = document.createElement('span');
      grip.className = `grip grip-${dir}`;
      grip.dataset.resize = dir;
      grip.setAttribute('aria-hidden', 'true');
      panel.append(grip);
      grip.addEventListener('pointerdown', (event) => beginMove(panel, dir, event));
    }

    panel.querySelector('[data-drag]')?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, a, input')) return;
      beginMove(panel, 'drag', event);
    });
  }

  resetBtn?.addEventListener('click', () => {
    custom = false;
    layout = defaultLayout();
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      /* ничего не поделать, просто сбрасываем в памяти */
    }
    render();
    resizeCharts();
  });

  window.addEventListener('resize', () => {
    if (!isDesktop()) {
      clearInline();
      if (resetBtn) resetBtn.hidden = true;
      return;
    }
    render();
    resizeCharts();
  });
}

// ---------- таблица дивидендов ----------

const DIVIDEND_WINDOWS = [
  { id: '1y', label: '1 год' },
  { id: '3y', label: '3 года' },
  { id: '5y', label: '5 лет' },
];

async function initDividends() {
  const metaEl = document.getElementById('dividends-meta');
  const rangesEl = document.getElementById('dividends-ranges');
  const bodyEl = document.getElementById('dividends-body');
  const errorEl = document.getElementById('dividends-error');
  if (!bodyEl || !rangesEl) return;

  let data;
  try {
    const res = await fetch('data/dividends.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    metaEl.textContent = 'данные не загрузились';
    errorEl.hidden = false;
    errorEl.textContent = `Не удалось загрузить data/dividends.json (${err.message}).`;
    return;
  }

  const draw = (periodId) => {
    const period = data.periods?.[periodId];
    const items = period?.items ?? [];
    bodyEl.textContent = '';

    if (!items.length) {
      errorEl.hidden = false;
      errorEl.textContent = 'за этот период данных нет';
      metaEl.textContent = '—';
      return;
    }
    errorEl.hidden = true;

    for (const [i, item] of items.entries()) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="div-rank">${i + 1}</td>
        <td class="div-name"><span class="div-company">${item.name}</span><span class="div-ticker">${item.ticker}</span></td>
        <td class="div-num">${priceText(item.divs)} ₽</td>
        <td class="div-num">${priceText(item.price)} ₽</td>
        <td class="div-num div-yield">+${num(item.yield, 1)} %</td>
      `;
      bodyEl.append(tr);
    }

    const updated = data.updated ? ` · данные на ${shortDate(data.updated)}` : '';
    metaEl.textContent = `${shortDate(period.from)} — ${shortDate(period.to)} · дивиденды ÷ цена на начало${updated}`;
  };

  let current = '1y';
  for (const w of DIVIDEND_WINDOWS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'range';
    btn.textContent = w.label;
    btn.dataset.period = w.id;
    btn.setAttribute('aria-pressed', String(w.id === current));
    btn.addEventListener('click', () => {
      current = w.id;
      for (const other of rangesEl.children) other.setAttribute('aria-pressed', String(other === btn));
      draw(w.id);
    });
    rangesEl.append(btn);
  }

  draw(current);
}

// ---------- запуск ----------

initDesk();

// Отрисовка графиков меняет высоту страницы, из-за чего появляется вертикальный
// скроллбар и «стол» становится уже — пересчитываем раскладку после загрузки данных.
Promise.allSettled([initCurrency(), initStocks(), initDividends()]).then(() => {
  window.dispatchEvent(new Event('resize'));
});

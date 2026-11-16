'use strict';

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

const num = (value, max = 2) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Math.min(2, max),
    maximumFractionDigits: max,
  }).format(value);

const rouble = (value, max = 4) => `${num(value, max)} ₽`;

const longDate = (iso) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

const shortDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const monthStart = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

const accent = '#5b9dff';

function gradientFill(ctx, area) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, 'rgba(91, 157, 255, 0.32)');
  g.addColorStop(1, 'rgba(91, 157, 255, 0)');
  return g;
}

const spanDays = (points) => {
  const first = new Date(`${points[0][0]}T00:00:00Z`);
  const last = new Date(`${points[points.length - 1][0]}T00:00:00Z`);
  return (last - first) / 86400000;
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// Шаг подписей по оси X: дни на коротких периодах, месяцы и кварталы на длинных.
const tickUnit = (days) => (days <= 75 ? 'day' : days <= 1100 ? 'month' : 'quarter');

const tickFormatter = (days) => (value) => {
  const d = new Date(value);
  const month = MONTHS[d.getMonth()];
  return days <= 75 ? `${d.getDate()} ${month}` : `${month} ${String(d.getFullYear()).slice(2)}`;
};

function buildChart(canvas, points) {
  const ctx = canvas.getContext('2d');

  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Курс ЦБ РФ',
          data: points.map(([date, value]) => ({ x: `${date}T00:00:00`, y: value })),
          borderColor: accent,
          borderWidth: 2,
          fill: true,
          backgroundColor: (c) => (c.chart.chartArea ? gradientFill(ctx, c.chart.chartArea) : 'transparent'),
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: accent,
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
      animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(12, 18, 28, 0.94)',
          borderColor: 'rgba(255, 255, 255, 0.12)',
          borderWidth: 1,
          padding: 10,
          titleColor: '#e8edf5',
          bodyColor: '#e8edf5',
          displayColors: false,
          callbacks: {
            title: (items) => longDate(items[0].raw.x.slice(0, 10)),
            label: (item) => `${num(item.parsed.y, 4)} ₽`,
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
            callback: (value) => `${num(value, 0)} ₽`,
          },
        },
      },
    },
  });
}

function renderStats(container, points) {
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map(([, v]) => v);
  const diff = last[1] - first[1];
  const pct = (diff / first[1]) * 100;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';

  container.innerHTML = `
    <div><dt>Изменение за период</dt><dd class="${cls}">${sign}${num(Math.abs(diff), 2)} ₽ · ${sign}${num(Math.abs(pct), 1)} %</dd></div>
    <div><dt>Минимум</dt><dd>${rouble(Math.min(...values), 2)}</dd></div>
    <div><dt>Максимум</dt><dd>${rouble(Math.max(...values), 2)}</dd></div>
  `;
}

async function main() {
  const metaEl = document.getElementById('usd-meta');
  const valueEl = document.getElementById('usd-value');
  const rangesEl = document.getElementById('usd-ranges');
  const statsEl = document.getElementById('usd-stats');
  const errorEl = document.getElementById('usd-error');
  const canvas = document.getElementById('usd-chart');

  let series;
  try {
    const res = await fetch('data/rates.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    series = data.series?.USD;
    if (!series?.points?.length) throw new Error('в данных нет ряда USD');
    document.getElementById('updated').textContent = data.updated ? longDate(data.updated) : '—';
  } catch (err) {
    metaEl.textContent = 'данные не загрузились';
    errorEl.hidden = false;
    errorEl.textContent = `Не удалось загрузить data/rates.json (${err.message}).`;
    return;
  }

  const all = series.points;
  const lastDate = all[all.length - 1][0];
  let chart = null;
  let range = DEFAULT_RANGE;

  const visible = () => {
    const cfg = RANGES.find((r) => r.id === range);
    if (!cfg.months) return all;
    const since = monthStart(lastDate, cfg.months).toISOString().slice(0, 10);
    const slice = all.filter(([d]) => d >= since);
    return slice.length > 1 ? slice : all.slice(-2);
  };

  const draw = () => {
    const points = visible();
    renderStats(statsEl, points);
    metaEl.textContent = `ЦБ РФ · ${shortDate(points[0][0])} — ${shortDate(points[points.length - 1][0])}`;

    if (!chart) chart = buildChart(canvas, points);
    else {
      chart.data.datasets[0].data = points.map(([date, value]) => ({ x: `${date}T00:00:00`, y: value }));
      chart.options.scales.x.time.unit = tickUnit(spanDays(points));
      chart.options.scales.x.ticks.callback = tickFormatter(spanDays(points));
      chart.update();
    }
  };

  for (const r of RANGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'range';
    btn.textContent = r.label;
    btn.dataset.range = r.id;
    btn.setAttribute('aria-pressed', String(r.id === range));
    btn.addEventListener('click', () => {
      range = r.id;
      for (const other of rangesEl.children) {
        other.setAttribute('aria-pressed', String(other === btn));
      }
      draw();
    });
    rangesEl.append(btn);
  }

  valueEl.textContent = rouble(all[all.length - 1][1]);
  draw();
}

main();

# rafik — правила для агентов

Статическая страница с графиками. Репозиторий `refgen72off/rafik` (публичный), сайт
`https://refgen72off.github.io/rafik/`. Ветка `main` — корень сайта (GitHub Pages, deploy from
branch), поэтому пуш в `main` = деплой через 1–2 минуты.

`README.md` — общая картина проекта. Этот файл — процедуры изменения и грабли, проверенные на опыте.

## Устройство

- `index.html` — каркас: карточка валюты (`usd-*`) и карточка акций (`stock-*`, `stocks-*`).
- `app.js` — вся логика. `RANGES` — общий список периодов для всех карточек; `createDetailChart`
  + `updateDetailChart` — большой график, `createSpark` — миниатюра в плитке, `createRanges` —
  кнопки периодов, `renderStats` — изменение/мин/макс, `initCurrency` и `initStocks` — карточки.
- `styles.css` — тёмная тема; ключевые классы `.card`, `.stocks-body` (сетка «график + колонка
  плиток»), `.tiles`, `.tile`, `.spark`, `.stats`. Страница прижата к левому краю окна:
  `.wrap { margin: 0 }`.
- `data/rates.json`, `data/stocks.json` — сгенерированные ряды, руками не править.
- `scripts/fetch-rates.mjs` (ЦБ РФ), `scripts/fetch-stocks.mjs` (MOEX ISS),
  `.github/workflows/update-rates.yml` — ежедневный крон 14:40 UTC.

## Добавить бумагу в блок «Акции»

1. В `scripts/fetch-stocks.mjs` дописать строку в `STOCKS`: `{ ticker: 'LKOH', name: 'ЛУКОЙЛ' }`.
   Тикер сверять по TQBR:
   `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&securities=LKOH`
   (поле `SHORTNAME` — имя для плитки).
2. Запустить `node scripts/fetch-stocks.mjs`.
3. Закоммитить и запушить `data/stocks.json`.

Готово, когда: в `data/stocks.json` появился новый тикер, на странице
`document.querySelectorAll('.tile').length` равно числу строк `STOCKS`, плитка открывает свой
график, в консоли нет ошибок.

## Добавить вторую карточку (валюта, индекс)

Сценарий: карточка EUR рядом с USD.

1. `scripts/fetch-rates.mjs`: в `CURRENCIES` дописать `{ code: 'EUR', id: 'R01239', label: 'Евро' }`
   (USD `R01235`, EUR `R01239`, CNY `R01375`, JPY `R01280`), запустить скрипт.
2. `index.html`: скопировать `<section class="card">` валюты, заменить префикс `usd-` на `eur-`.
3. `app.js`: `initCurrency` прибита к `usd-*` и `data.series.USD`. Сначала вынести это в параметры
   (`initCurrency({ prefix: 'eur', seriesKey: 'EUR' })`), иначе копия карточки не заработает.
4. Поднять `?v=N` у `styles.css` и `app.js` в `index.html` (см. грабли о кэше).

Готово, когда: обе карточки рисуют свой график, периоды переключаются независимо, консоль чистая.

## Грабли (проверено)

- **CORS**: `cbr.ru` и `iss.moex.com` не отдают `Access-Control-Allow-Origin`. Данные забираются
  только скриптом (локально или в Action); `fetch` из браузера к источникам блокируется.
- **Кэш Pages**: статика кэшируется ~10 минут. Если HTML обновился, а `app.js` старый — страница
  ломается целиком. После правки `app.js`/`styles.css` поднимать `?v=N` в `index.html` и проверять
  уже живой URL, а не только локальный.
- **Права gh-токена**: `contents: write` есть, `pages: write` и `actions: write` — нет. Pages
  включён человеком вручную, `Run workflow` запускает человек. Проверка деплоя: `Invoke-WebRequest`
  по живому URL до появления признака новой версии (~2 минуты).
- **MOEX ISS**: доска `TQBR`, `interval=24`, пагинация `limit=500` + `start`, `iss.meta=off`.
  Цены не скорректированы на сплиты и дивиденды — стыки видны на длинных периодах.
- **Chart.js**: CDN `chart.js@4.4.7` + `chartjs-adapter-date-fns@3.0.0` (без адаптера не работает
  ось `type: 'time'`). При смене версии проверять обе ссылки в `index.html`.
- **Воркфлоу**: каждый источник — отдельный шаг с `continue-on-error: true`, чтобы падение MOEX
  не отменяло обновление курсов ЦБ.

## Локальный запуск

```powershell
npx serve .                     # страница: http://localhost:3000 (fetch из file:// не работает)
node scripts/fetch-rates.mjs    # обновить курсы ЦБ
node scripts/fetch-stocks.mjs   # обновить котировки MOEX (~30 тыс. точек, 1–2 минуты)
```

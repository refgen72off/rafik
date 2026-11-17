# rafik — правила для агентов

Статическая страница с графиками. Репозиторий `refgen72off/rafik` (публичный), сайт
`https://refgen72off.github.io/rafik/`. Ветка `main` — корень сайта (GitHub Pages, deploy from
branch), поэтому пуш в `main` = деплой через 1–2 минуты.

`README.md` — общая картина проекта. Этот файл — процедуры изменения и грабли, проверенные на опыте.

## Устройство

- `index.html` — каркас: две панели в `.desk` — валюта (`usd-*`) и акции (`stock-*`, `stocks-*`).
- `app.js` — вся логика. `RANGES` — общий список периодов для всех карточек; `createDetailChart`
  + `updateDetailChart` — большой график, `createSpark` — миниатюра в плитке, `createRanges` —
  кнопки периодов, `initCurrency` и `initStocks` — карточки (блока статистики под графиком
  больше нет: остались цена в шапке и подпись периода).
  Свободная раскладка окон — `initDesk`: перетаскивание за шапку, размер за край/угол, раскладка
  в `localStorage` под ключом `rafik.layout.v1` (пиксели относительно `.desk`).
  Масштаб и сдвиг графика — `chartjs-plugin-zoom` (настройки в `plugins.zoom` внутри
  `createDetailChart`), границы — `applyZoomLimits`, сброс — кнопка `.chart-reset`.
- `styles.css` — тёмная тема; ключевые классы `.card`, `.stocks-body` (график сверху, плитки
  под ним), `.tiles`, `.tile`, `.spark`, `.chip`. Страница занимает всю ширину окна
  (`.wrap { max-width: none }`).
- `data/rates.json`, `data/stocks.json` — сгенерированные ряды, руками не править.
  В `rates.json`, кроме курса USD (`series.USD`), лежит ключевая ставка ЦБ (`series.RATE`):
  только даты изменения, источник — HTML-таблица `hd_base/KeyRate` (XML-выгрузки для ставки нет).
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
- **Зум/пан**: `chartjs-plugin-zoom` требует `hammerjs` (без Hammer панорамирование молча
  не работает, колесо — работает). Hammer слушает `PointerEvent` на `window`, поэтому проверка
  в браузере делается `PointerEvent`-ами (`pointerdown` на canvas, `pointermove` на `window`),
  а не `MouseEvent` — синтетические mouse-события он игнорирует. `limits` держат окно внутри
  текущего ряда, поэтому до увеличения сдвигать нечего: пан включается после зума.
  Смена периода (`createRanges`) пересоздаёт границы и сбрасывает масштаб.
- **Ключевая ставка**: нарисована второй линией (`rateDataset`, пунктир, `stepped: true`)
  на собственной оси `rate` (левая, в процентах); переключатель — чип `#rate-toggle`.
  Чтобы ступенька доходила до края, `extendRate` дописывает последнюю ставку датой конца окна,
  а `sliceRatePoints` берёт ставку, действовавшую на начало периода.
- **Раскладка окон**: панели — `position: absolute` внутри `.desk`, высота «стола» считается
  в `fitDesk()`. Пока пользователь не двигал окна, раскладка пересчитывается от ширины `.desk`
  (флаг `custom`); после первого перетаскивания она фиксируется в пикселях. Ширина стола
  меняется, когда появляется вертикальный скроллбар, поэтому после загрузки данных
  `app.js` ещё раз шлёт `resize` — иначе панели остаются шире стола на 15px.
  После смены размера панели Chart.js сам не перерисовывается: в 4.4.7
  `chart.resize()` при «запущенной» анимации откладывается до следующего `draw()`, поэтому
  `resizeCharts()` делает `resize()` + `draw()`. Ниже 901px раскладка отключается: JS снимает
  инлайн-стили, CSS возвращает панели в обычный поток (иначе на телефоне перетаскивание
  мешает прокрутке).

## Локальный запуск

```powershell
npx serve .                     # страница: http://localhost:3000 (fetch из file:// не работает)
node scripts/fetch-rates.mjs    # обновить курсы ЦБ
node scripts/fetch-stocks.mjs   # обновить котировки MOEX (~30 тыс. точек, 1–2 минуты)
```

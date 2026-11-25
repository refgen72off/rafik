# rafik — правила для агентов

Личная статика: курс USD/руб с ключевой ставкой ЦБ и 20 бумаг MOEX (+ линия IMOEX).
Репозиторий `refgen72off/rafik` (публичный), сайт `https://refgen72off.github.io/rafik/`.
Ветка `main` — корень сайта (Pages, deploy from branch): пуш в `main` деплоит за 1–2 минуты.

Сборки, зависимостей и тестов нет: ни `package.json`, ни линтера, ни тест-раннера. Проверка —
страница в браузере плюс запуск `node scripts/*.mjs`; в CI Node 22, локально Node в PATH
(здесь v26.13.1). Что где лежит и откуда данные — `README.md`; здесь процедуры, проверки и грабли.

## Устройство

- `index.html` — каркас: две панели (`section.card.panel`) в `.desk` — валюта (`usd-*`) и акции
  (`stock-*`). Версии ассетов — суффиксом: `styles.css?v=16`, `app.js?v=18`.
- `app.js` — вся логика: `RANGES` (периоды всех карточек, по умолчанию `1y`),
  `createDetailChart`/`updateDetailChart` (большой график), `createSpark` (миниатюра в плитке),
  `createRanges` (кнопки периодов), `initCurrency`/`initStocks` (карточки),
  `initDesk` (перетаскивание окон, раскладка в `localStorage` под ключом `rafik.layout.v1`).
  Данные грузятся через `fetch(..., { cache: 'no-cache' })`.
- `styles.css` — тёмная тема; `.stocks-body` = график сверху, `.tiles` под ним; на всю ширину окна.
- `data/rates.json` — `series.USD` (курс) и `series.RATE` (ключевая ставка: только даты решений).
- `data/stocks.json` — `order` + `series` (20 бумаг) + `index.points` (IMOEX).
- `data/pskb.json` — накопленный курс Примсоцбанка; `data/pskb-history.json` — покупки,
  введённые руками (`series.PSKB_HISTORY.points`).
- `scripts/http.mjs` — единственный способ ходить в сеть из скриптов (см. грабли о TLS).

## Проверка

```powershell
npx serve .        # http://localhost:3000; из file:// fetch не работает
```

Готово, когда страница открывается, в консоли нет ошибок, `.tile` столько же, сколько строк
`STOCKS` (сейчас 20), плитка открывает свой график. После правки `app.js`/`styles.css` подними
`?v=N` в `index.html`; после пуша смотри живой URL, а не локальный.

## Добавить бумагу в блок «Акции»

1. `scripts/fetch-stocks.mjs`: строка в `STOCKS` — `{ ticker: 'LKOH', name: 'ЛУКОЙЛ' }`. Тикер
   сверять по TQBR: `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&securities=LKOH` (имя для плитки — `SHORTNAME`).
2. `node scripts/fetch-stocks.mjs` (1–2 минуты, ~30 тыс. точек).
3. Закоммитить и запушить `data/stocks.json`.

## Добавить вторую карточку (пример: EUR)

1. `scripts/fetch-rates.mjs`: в `CURRENCIES` дописать `{ code: 'EUR', id: 'R01239', label: 'Евро' }`
   (USD `R01235`, CNY `R01375`, JPY `R01280`), запустить скрипт.
2. `index.html`: скопировать `<section class="card panel">` валюты, заменить префикс `usd-` на `eur-`.
3. `app.js`: `initCurrency` прибита к `usd-*` и `series.USD` — сначала параметризовать
   (`initCurrency({ prefix: 'eur', seriesKey: 'EUR' })`), иначе копия карточки не заработает.
4. Поднять `?v=N` у `styles.css` и `app.js`.

Готово, когда обе карточки рисуют свой ряд, периоды переключаются независимо, консоль чистая.

## Грабли (проверено)

- **Сеть только через `scripts/http.mjs`.** `cbr.ru`, `iss.moex.com` и `pskb.com` подписаны УЦ
  Минцифры, которого нет в стандартном наборе Node, а промежуточный сертификат сервер может не
  отдавать. `get()` добавляет `scripts/certs/*.pem` к стандартным корням. Голый `fetch` падает
  с `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` (2026-11-24, ISS сменил серт).
- **CORS**: источники данных не отдают `Access-Control-Allow-Origin`, поэтому данные забирает
  скрипт (локально или в Action), а страница читает только `data/*.json`.
- **Кэш Pages**: статика живёт ~10 минут. Новый `index.html` со старым `app.js` ломает страницу
  целиком — правки `app.js`/`styles.css` идут с поднятым `?v=N`.
- **Деплой**: Pages включён человеком вручную; у gh-токена есть `contents: write`, но нет
  `pages: write` и `actions: write`, поэтому `Run workflow` жмёт человек. Признак деплоя —
  новый ответ живого URL (`Invoke-WebRequest`, ~2 минуты).
- **MOEX ISS**: доска `TQBR`, `interval=24`, старт 2021-01-01, пагинация `limit=500` + `start`,
  `iss.meta=off`. Цены без поправки на сплиты и дивиденды — на длинных периодах видны стыки.
- **Chart.js 4.4.7 + `chartjs-adapter-date-fns@3.0.0`** (без адаптера не работает ось
  `type: 'time'`), зум — `chartjs-plugin-zoom@2.2.0` + `hammerjs@2.0.8`. Меняешь версию —
  правь обе ссылки в `index.html` и проверяй график.
- **Зум/пан**: без Hammer панорамирование молча не работает (колесо работает). Hammer слушает
  `PointerEvent` на `window`, поэтому проверка в браузере — `pointerdown` на canvas плюс
  `pointermove` на `window`; синтетические `MouseEvent` он игнорирует. `limits` держат окно внутри
  ряда, так что до зума двигать нечего; смена периода (`createRanges`) пересоздаёт границы
  и сбрасывает масштаб.
- **Ставка ЦБ**: вторая линия (`rateDataset`, пунктир, `stepped: true`) на своей левой оси `rate`,
  чип `#rate-toggle`, в ряду только даты решений. `extendRate` дописывает последнюю ставку датой
  конца окна, `sliceRatePoints` берёт ставку, действовавшую на начало периода, и переписывает её
  дату на начало окна — иначе 1М/3М показывали ось с даты последнего решения.
- **Примсоцбанк**: ряд накапливается по точке в день (`fetch-pskb.mjs`, дата по Москве). Город
  банк держит в сессии: `GET /ajax/setcity.php?city=15` → `PHPSESSID` → `/currency/` с этой кукой;
  без сессии отдаёт Владивосток, поэтому скрипт проверяет «Екатеринбург». `pskb.com` не пускает
  зарубежные IP: из Actions запросы висят до таймаута, поэтому точку дописывает задача
  планировщика Windows **`rafik-pskb`** (10:00, догоняющий запуск). Она вызывает
  `scripts/update-pskb.ps1`: fetch → коммит `Данные ПСКБ: YYYY-MM-DD` →
  `git pull --rebase --autostash` → push, так что запускай её на чистом дереве.
- **Точки покупок** (`pskb-history.json`): отдельный датасет без линии (`showLine: false`) —
  даты редкие, линия между ними врала бы про непрерывность. Режутся по началу окна ЦБ, как `pskb.json`.
- **IMOEX**: `indexDataset` (`id: 'imoex'`) на своей левой оси `index` в пунктах — на оси ₽ он
  сплющил бы цены. Чип `#imoex-toggle`, плитки у индекса нет. Точки режутся по обеим границам
  окна выбранной бумаги, `spanGaps` соединяет пропуски (у акций есть вечерние и выходные сессии).
- **Раскладка окон**: панели `position: absolute` внутри `.desk`, высота стола — в `fitDesk()`.
  Пока окна не двигали (`custom === false`), раскладка считается от ширины `.desk`; после первого
  перетаскивания фиксируется в пикселях. Скроллбар меняет ширину стола, поэтому после загрузки
  данных `app.js` ещё раз шлёт `resize` — иначе панели шире стола на 15px. Chart.js сам не
  перерисовывается при смене размера: в 4.4.7 `chart.resize()` откладывается до `draw()`, поэтому
  `resizeCharts()` делает оба. Ниже 901px (`matchMedia('(min-width: 901px)')`, CSS
  `max-width: 900px`) раскладка отключается: JS снимает инлайн-стили, панели идут в обычный поток.
- **Ряды приходят из скриптов**: CI коммитит `Данные: YYYY-MM-DD`, задача ПСКБ — `Данные ПСКБ:
  YYYY-MM-DD`. `rates.json`, `stocks.json` и `pskb.json` перегенерируются — править их руками
  смысла нет; `pskb-history.json` наоборот, живёт только ручными правками.

## Локальный запуск

```powershell
npx serve .                     # страница: http://localhost:3000
node scripts/fetch-rates.mjs    # курсы ЦБ + ключевая ставка (~1 мин)
node scripts/fetch-pskb.mjs     # курс Примсоцбанка, дописывает точку за сегодня
node scripts/fetch-stocks.mjs   # котировки MOEX (~30 тыс. точек, 1–2 минуты)
powershell -ExecutionPolicy Bypass -File scripts\update-pskb.ps1   # ПСКБ + коммит и пуш
```

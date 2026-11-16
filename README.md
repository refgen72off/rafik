# Графики

Личная страница с графиками: курс доллара США к рублю (ЦБ РФ) и цены акций Московской
биржи (20 бумаг из личного списка).

## Как это работает

- `data/rates.json` — курсы валют с 2016 года из XML-выгрузки ЦБ РФ (`XML_dynamic.asp`).
- `data/stocks.json` — дневные цены закрытия с 2021 года из MOEX ISS
  (`iss.moex.com/.../candles.json`, режим TQBR).
- `.github/workflows/update-rates.yml` — GitHub Action: раз в день (17:40 МСК) заново забирает
  оба ряда и коммитит их, если данные изменились. Запуск вручную: вкладка Actions →
  *Обновление данных* → *Run workflow*.
- Страница статическая: `index.html` + `styles.css` + `app.js`, графики рисует Chart.js с CDN.
  GitHub Pages кэширует файлы на ~10 минут, поэтому при правке `app.js` или `styles.css`
  поднимайте номер `?v=` в `index.html` — иначе браузер покажет старую версию.

Данные забираются в скриптах, а не в браузере, потому что ни ЦБ РФ, ни MOEX ISS не отдают
CORS-заголовки — прямой `fetch` со страницы был бы заблокирован.

## Обновить данные локально

```powershell
node scripts/fetch-rates.mjs
node scripts/fetch-stocks.mjs
```

Посмотреть страницу локально (`fetch` из `file://` не работает, нужен http-сервер):

```powershell
npx serve .
```

## Добавить бумагу

1. В `scripts/fetch-stocks.mjs` допишите строку в `STOCKS` — тикер и короткое имя
   (например `{ ticker: 'LKOH', name: 'ЛУКОЙЛ' }`).
2. Запустите `node scripts/fetch-stocks.mjs` и закоммитьте `data/stocks.json`.
3. Плитка и график появятся сами: порядок плиток = порядок в `STOCKS`.

## Добавить валюту

1. В `scripts/fetch-rates.mjs` допишите валюту в `CURRENCIES`
   (`R01235` — USD, `R01239` — EUR, `R01375` — CNY, `R01280` — JPY).
2. В `index.html` скопируйте карточку валюты с новым `id`, в `app.js` — вызовите
   `initCurrency` с новыми id (сейчас функция зашита на один блок `usd-*`).

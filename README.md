# Графики

Личная страница с графиками. Сейчас на ней один график — официальный курс доллара США к
рублю по данным ЦБ РФ.

## Как это работает

- `data/rates.json` — ряд курсов с 2016 года, генерируется скриптом `scripts/fetch-rates.mjs`
  из XML-выгрузки ЦБ РФ (`XML_dynamic.asp`).
- `.github/workflows/update-rates.yml` — GitHub Action, раз в день (17:40 МСК) заново забирает
  курсы и коммитит `data/rates.json`, если данные изменились. Запустить вручную можно через
  вкладку Actions → *Обновление курсов* → *Run workflow*.
- Страница статическая: `index.html` + `styles.css` + `app.js`, график рисует Chart.js с CDN.

## Обновить данные локально

```powershell
node scripts/fetch-rates.mjs
```

Посмотреть страницу локально (fetch из `file://` не работает, нужен http-сервер):

```powershell
npx serve .
```

## Добавить ещё одну валюту

1. В `scripts/fetch-rates.mjs` допишите валюту в `CURRENCIES`
   (`R01235` — USD, `R01239` — EUR, `R01375` — CNY, `R01280` — JPY), запустите скрипт.
2. В `index.html` скопируйте блок `<section class="card">` с новым `id`.
3. В `app.js` вызовите ту же логику для новой карточки (сейчас зашита одна — `main()`).

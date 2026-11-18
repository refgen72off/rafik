# Ежедневное обновление курса Примсоцбанка с домашней машины.
# Сайт банка недоступен с зарубежных IP: шаг в GitHub Actions падает с таймаутом,
# поэтому точку за сегодня дописывает эта задача (сайт видит только домашний IP).
# Запуск вручную: powershell -ExecutionPolicy Bypass -File scripts\update-pskb.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

node scripts/fetch-pskb.mjs
if ($LASTEXITCODE -ne 0) { throw 'fetch-pskb завершился с ошибкой' }

git add data/pskb.json
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Output 'Данные не изменились'
  exit 0
}

$date = Get-Date -Format 'yyyy-MM-dd'
git commit -m "Данные ПСКБ: $date"

# Крон Actions успевает запушить другие файлы — забираем их перед пушем.
git pull --rebase --autostash origin main
git push origin main
Write-Output "ПСКБ: точка за $date отправлена"

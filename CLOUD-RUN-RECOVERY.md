# Публикация сайта из GitHub через Cloud Shell

Этот способ обходит архив публикации AI Studio: Cloud Build собирает обычный контейнер по `Dockerfile`. Готовый интерфейс обслуживает Nginx на существующем порту 3000. Разработку можно продолжать в AI Studio и сохранять в GitHub.

Используются прежний сервис `silk-road-logistics-crm`, регион `asia-east1` и проект `logisticsapp-216d5`. Адреса сайта остаются прежними. Firebase Authentication, именованная Firestore, `crmApi`, `warehouseMailing` и Telegram не публикуются этой командой. `.gcloudignore` и `.dockerignore` включают только файлы сборки интерфейса.

## Подготовить новую версию

В Google Cloud Shell под рабочим аккаунтом из актуальной копии `main`:

```sh
git pull --ff-only origin main &&
gcloud run deploy silk-road-logistics-crm \
  --project=logisticsapp-216d5 \
  --region=asia-east1 \
  --source=. \
  --port=3000 \
  --clear-base-image \
  --command='' \
  --args='' \
  --workdir=/ \
  --no-traffic \
  --tag=web-recovery
```

Cloud Build сам устанавливает зависимости и собирает интерфейс. `--command=''` и `--args=''` сбрасывают прежний запуск `/bin/sh ... npm start`, чтобы использовать команду Nginx из контейнера. `--workdir=/` задаёт существующую рабочую папку нового контейнера. `--clear-base-image` отключает прежнюю конфигурацию базового образа для запуска из архива. Остальные настройки сервиса не задаются заново.

`--no-traffic` сохраняет обслуживание пользователей прежней версией. После успешной сборки команда напечатает ссылку новой версии с тегом `web-recovery`. До переключения нужно проверить на этом адресе главную страницу, `/gps-map`, `/healthz`, загрузку JavaScript/CSS; `/assets/missing.js` и `/api/health` должны возвращать 404. Вход через Google проверяется на основном адресе: временный домен тега не добавляется в Firebase Authentication.

## Переключить проверенную версию

Получить назначение тега:

```sh
gcloud run services describe silk-road-logistics-crm \
  --project=logisticsapp-216d5 --region=asia-east1 \
  --format='yaml(status.traffic,status.latestReadyRevisionName)'
```

После проверки подставить точный `revisionName` записи с `tag: web-recovery`:

```sh
gcloud run services update-traffic silk-road-logistics-crm \
  --project=logisticsapp-216d5 --region=asia-east1 \
  --to-revisions=ИМЯ_ПРОВЕРЕННОЙ_РЕВИЗИИ=100
```

Указывать конкретную проверенную ревизию, а не `--to-latest`: параллельная публикация из AI Studio может создать другую версию. После переключения обновить главную страницу, войти через Google и проверить данные CRM и диагностику рассылки.

Перевод названий товаров при Excel-импорте сейчас использует `GEMINI_API_KEY` во время сборки Vite. Эта сборка не переносит приватные ключи из окружения AI Studio в браузер; при отсутствии ключа существующий импорт сохраняет исходные названия. Остальные API CRM используют прежнюю Firebase-функцию.

Документация: [публикация Cloud Run из исходников](https://docs.cloud.google.com/run/docs/deploying-source-code), [параметры публикации](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy).

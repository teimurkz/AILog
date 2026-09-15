# Outlook → Power Automate → CRM

Этот способ использует уже подключённый ящик Office 365 Outlook в Power Automate.
Регистрация собственного приложения Entra и OAuth-токены в CRM не требуются.
Действие HTTP требует соответствующей лицензии Power Automate; корпоративные
правила должны разрешать передачу документов в ваш Firebase. Наличие карточки
HTTP в редакторе ещё не подтверждает лицензию: проверьте Save / Flow checker.

## 1. Обновить CRM и Firebase

В каталоге репозитория в авторизованном Google Cloud Shell:

```bash
git pull --ff-only origin main &&
npm ci &&
npm --prefix functions ci &&
firebase deploy --only functions:crm:crmApi,firestore:rules --project logisticsapp-216d5
```

Затем подтяните этот же коммит и опубликуйте приложение в AI Studio.
Правила Firestore закрывают коллекцию `outlook_private`, где хранится хеш ключа.
Для этого способа функция `outlookShipments` не требуется: передачу запускает
Power Automate. Существующая настройка прямого Outlook остаётся доступной.

## 2. Создать ключ в CRM

Администратор открывает **Отправления → Почта Outlook → Подключение через Power Automate**.
Укажите рабочий адрес, отправителя, начало периода и ожидаемый срок перевозки.
Если рабочий логин и адрес ящика различаются, используйте один выбранный адрес
ящика последовательно в настройках CRM; переподключать Outlook из-за псевдонима не нужно.

Включите **Принимать письма от Power Automate**, нажмите **Создать ключ подключения**.
Скопируйте показанный ключ в HTTP Headers потока. Сервер хранит только хеш:
закрытый ключ не попадает в статус, Git, параметры URL или журналы CRM.
После закрытия страницы ключ нельзя прочитать повторно; кнопка **Заменить ключ подключения**
выдаёт новый и немедленно отключает прежний. Снимите флажок и сохраните для остановки приёма.

## 3. Flow — English interface

The flow contains three steps:

**When a new email arrives (V3) → Export email (V2) → HTTP**

### When a new email arrives (V3) — Office 365 Outlook

| Parameter | Value |
|---|---|
| Folder | Inbox / Входящие, or the actual folder where the partner's emails arrive |
| From | Your partner's email address, matching the sender configured in CRM |
| Include Attachments | No |
| Only with Attachments | Yes |
| Importance | Any |
| To, CC, To or CC, Subject Filter | Leave empty |

### Export email (V2) — Office 365 Outlook

Click **+ between the trigger and HTTP → Add an action**. Search for **Export email (V2)**.

- **Message Id:** select **Message Id** from **When a new email arrives (V3)** using Dynamic content.
- **Original Mailbox Address:** leave empty for your own connected mailbox. This optional field is for shared mailboxes.
- Under **Settings**, enable **Secure outputs**, so the original email is hidden in run history.

Export email downloads the complete EML including attachments. No attachment loop
or separate Get Attachment action is needed for this flow.

### HTTP

**URI:**

```text
https://asia-east1-logisticsapp-216d5.cloudfunctions.net/crmApi/api/outlook/power-automate/receive
```

**Method:** `POST`

**Headers:**

| Key | Value |
|---|---|
| Content-Type | `message/rfc822` |
| X-CRM-Ingest-Key | Paste the key generated in CRM |
| X-CRM-Received-At | Select **Received Time** from the email trigger |

**Body:** select **Body** under **Export email (V2)** in Dynamic content.
Use the exported binary body, not the HTML Body from the trigger, and do not wrap it in JSON or base64 text.

Microsoft can preserve the export's original media type when forwarding binary
content. The receiver accepts raw EML with `message/rfc822`,
`application/octet-stream`, or `text/plain` (including charset parameters).
All three paths preserve the original bytes and still validate the key, sender,
received time, message identity, attachments and 25 MB size limit. JSON objects
and the trigger's HTML body are not substitutes for an exported email.

If expressions are needed, Received Time for the V3 trigger is `triggerBody()?['receivedDateTime']`.
For the HTTP Body, prefer Dynamic content so the designer inserts the actual action name.

Under HTTP **Settings**:

- Enable **Secure inputs** and **Secure outputs** to hide the key and documents in run history.
- Under **Content transfer**, set **Allow chunking: Off**. Send the complete EML in one request (up to 25 MB).
- Use a bounded retry policy, for example **Fixed interval**, **Count: 4**, **Interval: PT1M**.
- Set **Asynchronous pattern: Off** if this option is shown; the endpoint returns the final result directly.

**Allow chunking** and **Asynchronous pattern** are different settings. The CRM
receiver does not implement Microsoft's multi-request upload protocol. With
chunking enabled, HTTP can first send an empty POST to negotiate the upload,
before sending the actual email. Turn chunking off for this receiver.

## 4. Проверка работы

Нажмите **Save**, проверьте сообщения о лицензии и правилах доступа. Затем **Test → Manually**
и дождитесь нового письма выбранного отправителя в отслеживаемой папке.
Создание потока не импортирует старую переписку автоматически.

Успех: HTTP отвечает `200` со `shipmentId`, а в CRM появляется карточка инвойса с
документами и исходным письмом. Отсчёт начинается с Received Time, а не с текущего
времени или даты инвойса. Повторная передача того же письма не создаёт дубль.
Если ту же переписку ранее импортировали напрямую через Graph, используется тот же журнал
по адресу ящика и Internet Message ID.

| HTTP status | Meaning / next step |
|---|---|
| 401 | Key missing, incorrect or replaced. Copy the new key from CRM. |
| 403 | Receiving is disabled in CRM. |
| 400 | Missing or invalid X-CRM-Received-At. Choose Received Time from the trigger. |
| 413 | Original EML exceeds 25 MB. Handle this message manually. |
| 415 | Check the received Content-Type in the error and select Body from Export email (V2). If the error still says only message/rfc822 is allowed, deploy the updated crmApi. |
| 422 | Sender, invoice or document format needs review. Read the error in CRM. |
| 429 | Another import is running; retry after one minute. |
| 503 | Temporary failure. Retry; completed shipments will not duplicate. |

Для исправленного письма или после исправления разбора можно повторно запустить
неудачную передачу через **Run history → Resubmit**. Неполная загрузка файлов
не создаёт отправление; новые версии документов дополняют существующее.

При ошибке `415 UnsupportedMediaType`, несмотря на настроенный заголовок
`message/rfc822`, обновите сервер: прежняя версия отклоняла бинарный экспорт
Outlook с другим типом содержимого. В Google Cloud Shell из каталога проекта:

```bash
git pull --ff-only origin main &&
npm ci &&
npm --prefix functions ci &&
firebase deploy --only functions:crm:crmApi --project logisticsapp-216d5
```

Для этого исправления достаточно публикации `crmApi`. Ключ и настройки
отправителя остаются прежними. После успешной публикации повторите неудачный
запуск через **Resubmit**. Если меняли сам поток, сохраните его и проверьте новым
письмом. Отправитель в CRM должен соответствовать выбранному тестовому письму.

Если новая ошибка показывает `Content-Type: не указан`, обновлённый сервер уже
отвечает, но в запросе отсутствует заголовок формата. В **Edit → HTTP → Settings →
Content transfer** проверьте **Allow chunking: Off**. Затем в **Parameters**
проверьте заголовок `Content-Type: message/rfc822` и **Body из Export email (V2)**.
Сохраните поток и выполните новый тест с новым письмом. Для изменения этих
параметров повторная публикация функции не требуется.

Если Outlook показывает письмо без вложений во время проверки Microsoft Defender,
Export email нужно выполнить заново после появления документов: повтор одного
HTTP-запроса передаёт прежний экспорт. CRM в этом случае возвращает 503 и не отмечает письмо завершённым.

Ограничения: исходное EML до 25 МБ, максимум 100 вложений; исходная дата получения обязательна.
Защищённые/зашифрованные письма, файлы по ссылкам и вложенные письма могут потребовать ручной проверки.
Содержимое писем не исполняется; CRM не отправляет, не удаляет и не отмечает письма прочитанными.
Отбор по отправителю не заменяет проверку подлинности письма корпоративной почтой.

Официальные источники:
[Outlook connector / Export email (V2)](https://learn.microsoft.com/en-us/connectors/office365/),
[email triggers](https://learn.microsoft.com/en-us/power-automate/email-triggers),
[content types and binary forwarding](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-content-type),
[HTTP chunking protocol](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-handle-large-messages),
[Power Automate licensing](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq).

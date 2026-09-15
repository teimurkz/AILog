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

If expressions are needed, Received Time for the V3 trigger is `triggerBody()?['receivedDateTime']`.
For the HTTP Body, prefer Dynamic content so the designer inserts the actual action name.

Under HTTP **Settings**:

- Enable **Secure inputs** and **Secure outputs** to hide the key and documents in run history.
- Use a bounded retry policy, for example **Fixed interval**, **Count: 4**, **Interval: PT1M**.
- Set **Asynchronous pattern: Off** if this option is shown; the endpoint returns the final result directly.

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
| 415 | Set Content-Type to message/rfc822. |
| 422 | Sender, invoice or document format needs review. Read the error in CRM. |
| 429 | Another import is running; retry after one minute. |
| 503 | Temporary failure. Retry; completed shipments will not duplicate. |

Для исправленного письма или после исправления разбора можно повторно запустить
неудачную передачу через **Run history → Resubmit**. Неполная загрузка файлов
не создаёт отправление; новые версии документов дополняют существующее.

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
[Power Automate licensing](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq).

# API

## GET /api/health

Проверка backend. Возвращает статус сервиса и подключение Timeweb-агента.

По умолчанию не раскрывает пользователей, порт, источники env и ID агента. Для временной диагностики можно включить `DEBUG_HEALTH=true`.

## POST /api/auth/register

Ограничен rate limit, чтобы защитить регистрацию и вход от перебора.

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

## POST /api/auth/login

Ограничен rate limit, чтобы защитить регистрацию и вход от перебора.

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

## GET /api/config

Требует Bearer token. Возвращает настройки аккаунта, статус Timeweb-агента и настройки Telegram.

## POST /api/config

Требует Bearer token. Сохраняет только настройки Telegram-публикации.

```json
{
  "telegramBotToken": "...",
  "telegramChatId": "@channel"
}
```

## POST /api/ai/test

Требует Bearer token. Проверяет, отвечает ли Timeweb-агент, настроенный через `TIMEWEB_API_KEY` и `TIMEWEB_AGENT_ID` на сервере. Ограничен AI rate limit.

## POST /api/generate

Требует Bearer token. Генерация контента идёт только через Timeweb-агента. Ограничен AI rate limit и дневным лимитом демо-клиента.

```json
{
  "project": {
    "name": "KUBIK.DM",
    "niche": "перформанс-маркетинг",
    "offer": "лендинг + Яндекс.Директ + аналитика",
    "audience": "владельцы бизнеса",
    "pain": "реклама тратит бюджет, но заявки не окупаются",
    "common": "лендинг",
    "proof": "первый экран, квиз, аналитика",
    "tone": "прямой, экспертный, без воды"
  },
  "settings": {
    "ideaCount": 10,
    "style": "острый, экспертный, без воды",
    "objective": "заявки"
  },
  "platform": "telegram"
}
```

## POST /api/upload

Требует Bearer token. FormData: `file`, `projectId`. Ограничен publish/upload rate limit.

## POST /api/publish/telegram

Требует Bearer token. Публикация сгенерированного и отредактированного контента в привязанный Telegram-канал или чат. Ограничен publish/upload rate limit.

## POST /api/generate-image

Требует Bearer token. Генерирует изображение по промпту, сохраняет в `/uploads` и возвращает медиа-объект. Ограничен AI rate limit и дневным лимитом демо-клиента.

## POST /api/publish/instagram

Требует Bearer token. Публикует Reels через Instagram Graph API. Нужны `instagramAccessToken`, `instagramUserId` и видео.

## GET /api/auth/youtube

Требует Bearer token. Запускает OAuth-подключение YouTube.

## POST /api/publish/youtube

Требует Bearer token. Загружает видео на YouTube через подключенный OAuth.

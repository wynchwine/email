# WYNCH Sommelier Microservice

## Что это

Serverless-функция (Vercel) — получает Shopify `orders/fulfilled` вебхук, генерирует персонализированную сомелье-заметку через Claude и записывает её в профиль Klaviyo.

## Setup

1. Скопируй `.env.example` в `.env` и заполни все переменные:
   ```
   cp .env.example .env
   ```
2. Установить зависимости:
   ```
   npm install
   ```

## Деплой на Vercel

```
vercel deploy --prod
```

После деплоя зарегистрировать вебхук в Shopify Admin → Settings → Notifications:
- Event: `Order fulfilled`
- URL: `https://<your-vercel-domain>/api/webhook`
- Format: JSON

## Архитектура

```
Shopify orders/fulfilled
        │
        ▼
POST /api/webhook
  1. HMAC-SHA256 verification
  2. 200 OK immediately (fire-and-forget)
  3. Background:
     ├── Shopify API → product tags (region, grape, aromas)
     ├── Klaviyo API → customer wine_preferences
     ├── Claude API → generate sommelier note
     └── Klaviyo API → write 4 properties to profile
```

## Klaviyo profile properties

| Поле | Описание |
|---|---|
| `sommelier_note` | Текст сомелье-заметки |
| `sommelier_note_wine` | Название вина |
| `sommelier_note_order` | Shopify Order ID (дедупликация) |
| `sommelier_note_updated_at` | Дата обновления (ISO 8601) |
| `wine_preferences` | Вкусовые предпочтения клиента (входящий параметр) |

## Shopify product tags

Формат тегов на продукте:
```
secondary::region::Burgundy
secondary::grape::Pinot Noir
secondary::aroma::cherry, earth, oak
```

## MCP Server (Klaviyo)

Проект подключает официальный Klaviyo MCP сервер (`klaviyo-mcp-server`), запускается автоматически через `.mcp.json` с помощью `uvx`.

## Переменные окружения

| Переменная | Описание |
|---|---|
| `KLAVIYO_API_KEY` | Приватный API ключ Klaviyo (`pk_...`) |
| `ANTHROPIC_API_KEY` | API ключ Anthropic Claude (`sk-ant-...`) |
| `SHOPIFY_SHOP` | Домен магазина (`store.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API токен (`shpat_...`) |
| `SHOPIFY_WEBHOOK_SECRET` | Секрет для HMAC верификации вебхуков |

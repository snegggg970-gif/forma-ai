# FORMA AI · Веб-чат виджет

Встраиваемый виджет чата для любого сайта. Работает на статике (GitHub Pages), без бэкенда.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Демо-страница для портфолио (откройте в браузере или залейте на GitHub Pages) |
| `forma-chat.css` | Стили виджета (монохром, минимализм FORMA AI) |
| `forma-chat.js` | Логика виджета (пузырь, окно, сценарии заявки/записи) |
| `knowledge-base.js` | База знаний FORMA AI (услуги, цены, процесс, портфолио) |
| `llm-adapter.js` | LLM-адаптер: mock + GigaChat/YandexGPT через serverless-прокси |

## Локальный запуск

```bash
python3 -m http.server 8000
# Откройте http://localhost:8000
```

## Быстрая интеграция на свой сайт

```html
<link rel="stylesheet" href="forma-chat.css">
<script>
  window.FORMA_CHAT_CONFIG = {
    mode: 'mock',          // 'mock' или 'live'
    autoOpen: false,
  };
</script>
<script src="knowledge-base.js"></script>
<script src="llm-adapter.js"></script>
<script src="forma-chat.js"></script>
```

Виджет появится в правом нижнем углу страницы.

## Режимы

### mock (по умолчанию)
Ответы по базе знаний `knowledge-base.js`. Работает мгновенно, без API-ключей.
Идеально для демо и для типовых вопросов клиентов.

### live
Реальные ответы через GigaChat или YandexGPT. Нужен serverless-прокси (см. `../serverless/`).
Подключается одной правкой конфигурации:

```js
window.FORMA_CHAT_CONFIG = {
  mode: 'live',
  llmProvider: 'gigachat',   // или 'yandexgpt'
  llmEndpoint: 'https://your-worker.example.workers.dev/api/chat',
  leadEndpoint: 'https://your-worker.example.workers.dev/api/lead',
};
```

## Сценарии

### Q&A по базе знаний
Бот ищет раздел по ключевым словам и выдаёт готовый ответ с быстрыми репликами для следующего шага.

### Сбор заявки (trigger: «хочу оставить заявку»)
Пошагово: имя → контакт → описание задачи. По завершении — POST на `leadEndpoint` (если задан).

### Запись на консультацию (trigger: «хочу записаться»)
Услуга (inline-кнопки) → время → имя → контакт. По завершении — POST на `leadEndpoint`.

## Публичный API

```js
// Открыть / закрыть чат программно
window.FORMA_CHAT.open();
window.FORMA_CHAT.close();
window.FORMA_CHAT.toggle();

// Программно задать вопрос
window.FORMA_CHAT.sendMessage('Сколько стоит лендинг?');

// Сбросить диалог
window.FORMA_CHAT.reset();
```

## Кастомизация брендинга

Все цвета и шрифты — в начале `forma-chat.css`. Меняйте под бренд клиента:

```css
.forma-chat-bubble { background: #0a0a0a; }       /* основной цвет */
.forma-chat-window { background: #ffffff; }       /* фон окна */
.forma-chat-header { background: #0a0a0a; }       /* шапка */
.forma-chat-msg--user .forma-chat-bubble-msg { background: #0a0a0a; }
```

## Размер

- HTML: ~9 KB
- CSS: ~7 KB
- JS (всё): ~22 KB (несжато)
- Без внешних зависимостей

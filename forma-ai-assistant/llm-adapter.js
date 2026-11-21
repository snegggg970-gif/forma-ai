/**
 * FORMA AI — LLM-адаптер
 *
 * Два режима:
 *   1) mock   — без API-ключа. Интеллектуальный fallback по базе знаний FORMA_KB.
 *               Работает на статике (GitHub Pages) из коробки. Идеально для демо.
 *   2) live   — с API-ключом GigaChat или YandexGPT. Реальные ответы LLM.
 *               Требует серверный прокси (см. ../serverless/), потому что
 *               ключ нельзя светить в браузере.
 *
 * Конфигурация через window.FORMA_CHAT_CONFIG:
 *   {
 *     mode: 'mock' | 'live',
 *     llmProvider: 'gigachat' | 'yandexgpt',
 *     llmEndpoint: 'https://your-worker.example.workers.dev/api/chat',
 *     systemPrompt: '...' // optional override
 *   }
 *
 * Если mode не указан или live-эндпоинт недоступен — автоматически падаем в mock.
 */

(function () {
  'use strict';

  const KB = window.FORMA_KB;
  if (!KB) {
    console.error('[FORMA AI] База знаний не найдена. Подключите knowledge-base.js перед forma-chat.js');
    return;
  }

  // ---------- Утилиты ----------
  function normalize(s) {
    return (s || '').toString().toLowerCase().replace(/ё/g, 'е').trim();
  }

  /**
   * Проверяет, встречается ли keyword как отдельное слово.
   * Слова-префиксы тоже считаются ("услуг" → "услуги"),
   * но "бот" НЕ матчит "работаете" (потому что "работаете" не начинается с "бот").
   */
  function containsWord(query, keyword) {
    if (!keyword) return false;
    const words = query.split(/[^a-zа-я0-9]+/i);
    return words.some((w) => w && w.startsWith(keyword));
  }

  /**
   * Проверяет, что все слова фразы встречаются в запросе как отдельные слова.
   * "как работ" → матчит "как вы работаете" (оба слова есть).
   * "бот" НЕ матчит "работаете".
   */
  function phraseMatches(query, phrase) {
    if (!phrase) return false;
    const phraseWords = phrase.split(/[^a-zа-я0-9]+/i).filter(Boolean);
    if (!phraseWords.length) return false;
    return phraseWords.every((w) => containsWord(query, w));
  }

  function scoreSection(query, section) {
    const q = normalize(query);
    if (!q) return 0;
    let score = 0;

    // Интенты — все слова фразы должны встречаться как отдельные слова
    (section.intents || []).forEach((intent) => {
      if (phraseMatches(q, normalize(intent))) score += 10;
    });

    // Ключевые слова — как отдельные слова (prefix match)
    (section.keywords || []).forEach((kw) => {
      if (containsWord(q, normalize(kw))) score += 3;
    });

    // Заголовок раздела
    if (section.title && containsWord(q, normalize(section.title))) score += 5;

    return score;
  }

  function findSection(query) {
    let best = null;
    let bestScore = 0;
    KB.sections.forEach((section) => {
      const s = scoreSection(query, section);
      if (s > bestScore) {
        bestScore = s;
        best = section;
      }
    });
    return bestScore > 0 ? best : null;
  }

  // ---------- Mock-режим ----------
  // Возвращает промис, чтобы интерфейс был одинаковым для mock и live.
  function mockAnswer(userText, history) {
    return new Promise((resolve) => {
      // Имитация задержки как у настоящего LLM
      const delay = 350 + Math.random() * 450;
      setTimeout(() => {
        const text = (userText || '').trim();

        // Дежурные фразы
        const greetings = ['привет', 'здравствуй', 'добрый день', 'добрый вечер', 'hi', 'hello', 'хай'];
        const thanks = ['спасибо', 'благодар', 'спс'];
        const q = normalize(text);

        if (greetings.some((g) => q.startsWith(g))) {
          return resolve({
            text: KB.greeting.text,
            quickReplies: KB.greeting.quickReplies,
          });
        }
        if (thanks.some((t) => q.includes(t))) {
          return resolve({
            text: 'Пожалуйста! Если появятся вопросы — пишите, я рядом. Чем ещё помочь?',
            quickReplies: KB.greeting.quickReplies,
          });
        }

        // Поиск по базе знаний
        const section = findSection(text);
        if (section) {
          return resolve({
            text: section.answer,
            quickReplies: section.quickReplies || [],
          });
        }

        // Fallback
        resolve({
          text: KB.fallback.text,
          quickReplies: KB.fallback.quickReplies,
        });
      }, delay);
    });
  }

  // ---------- Live-режим ----------
  // Запрос к вашему серверному прокси (Cloudflare Worker / Vercel function),
  // который уже подставляет API-ключ GigaChat/YandexGPT.
  function liveAnswer(userText, history, config) {
    const endpoint = config.llmEndpoint;
    if (!endpoint) {
      // Нет эндпоинта — тихо падаем в mock
      return mockAnswer(userText, history);
    }

    const systemPrompt = config.systemPrompt || buildSystemPrompt();

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: config.llmProvider || 'gigachat',
        system: systemPrompt,
        history: history.slice(-8), // последние 4 пары
        message: userText,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('LLM endpoint error: ' + r.status);
        return r.json();
      })
      .then((data) => ({
        text: data.text || data.answer || data.message || '',
        quickReplies: data.quickReplies || KB.greeting.quickReplies,
      }))
      .catch((err) => {
        console.warn('[FORMA AI] Live LLM недоступен, переключаюсь на mock:', err.message);
        return mockAnswer(userText, history);
      });
  }

  // ---------- Сборка системного промпта ----------
  function buildSystemPrompt() {
    const s = KB.studio;
    const sections = KB.sections
      .map((sec) => `## ${sec.title}\n${sec.answer}`)
      .join('\n\n');

    return `Ты — ИИ-консультант студии FORMA AI (${s.site}).

О студии: ${s.description}
Слоган: "${s.tagline}"

База знаний для ответов:

${sections}

ПРАВИЛА:
1. Отвечай кратко, по делу, в стиле FORMA AI — «меньше шума, больше смысла».
2. Цены называешь из базы знаний. Точную стоимость не придумываешь — отправляешь к команде.
3. Если пользователь хочет оставить заявку или записаться на консультацию — собери имя, контакт и краткое описание задачи, подтверди получение.
4. Не обещаешь сроки и не называешь итоговую смету — это согласуется с командой отдельно.
5. Тон дружелюбный, профессиональный, без канцелярита.
6. Если вопрос вне темы digital-услуг — мягко возвращаешь к услугам FORMA AI.
7. Не используешь эмодзи, кроме крайних случаев. Текст — без markdown-разметки кроме переносов строк и списков через «•».
8. Контакт для срочной связи: Telegram @forma_ai, email hello@forma-ai.studio.`;
  }

  // ---------- Публичный API ----------
  window.FORMA_LLM = {
    /**
     * Главный метод: получить ответ на сообщение пользователя.
     * @param {string} userText
     * @param {Array<{role:'user'|'assistant', text:string}>} history
     * @returns {Promise<{text:string, quickReplies:Array}>}
     */
    answer(userText, history) {
      const config = window.FORMA_CHAT_CONFIG || {};
      const mode = config.mode || 'mock';

      if (mode === 'live' && config.llmEndpoint) {
        return liveAnswer(userText, history || [], config);
      }
      return mockAnswer(userText, history || []);
    },

    // Поиск раздела по intent (для быстрых кнопок вида "intent:services")
    findSectionByIntent(intentId) {
      return KB.sections.find((s) => s.id === intentId) || null;
    },

    // Поиск по запросу (для использования в боте)
    findSection(query) {
      return findSection(query);
    },

    // Экспорт системного промпта — пригодится для бота
    buildSystemPrompt,

    // Экспорт базы для серверной стороны (через JSON.stringify)
    exportKnowledgeBase() {
      return JSON.stringify(KB);
    },
  };
})();

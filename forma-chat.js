/**
 * FORMA AI — Встраиваемый чат-виджет
 *
 * Использование:
 *   1. Подключите на страницу:
 *        <link rel="stylesheet" href="forma-chat.css">
 *        <script src="knowledge-base.js"></script>
 *        <script src="llm-adapter.js"></script>
 *        <script src="forma-chat.js"></script>
 *
 *   2. Опционально — конфигурация до подключения forma-chat.js:
 *        <script>
 *          window.FORMA_CHAT_CONFIG = {
 *            mode: 'mock',          // 'mock' | 'live'
 *            llmProvider: 'gigachat',
 *            llmEndpoint: '',       // URL вашего serverless-прокси (см. serverless/)
 *            bubbleText: 'Чат с FORMA AI',
 *            autoOpen: false,
 *            position: 'bottom-right'
 *          };
 *        </script>
 *
 *   3. Или автоматическая инициализация (по умолчанию).
 *
 * ВАЖНО: в mock-режиме виджет работает полностью на клиенте —
 * можно класть на GitHub Pages. В live-режиме нужен serverless-прокси
 * (см. ../serverless/README.md), чтобы не светить API-ключ.
 */

(function () {
  'use strict';

  if (window.__FORMA_CHAT_INITIALIZED__) return;
  window.__FORMA_CHAT_INITIALIZED__ = true;

  const KB = window.FORMA_KB;
  if (!KB) {
    console.error('[FORMA AI] knowledge-base.js не загружен');
    return;
  }
  if (!window.FORMA_LLM) {
    console.error('[FORMA AI] llm-adapter.js не загружен');
    return;
  }

  const CONFIG = Object.assign(
    {
      mode: 'mock',
      llmProvider: 'gigachat',
      llmEndpoint: '',
      autoOpen: false,
      autoOpenDelay: 4000,
      position: 'bottom-right',
    },
    window.FORMA_CHAT_CONFIG || {}
  );

  // ----------------------------------------------------------------
  // Хранилище состояния чата
  // ----------------------------------------------------------------
  const state = {
    open: false,
    history: [],              // {role:'user'|'assistant', text:string}
    typing: false,
    leadFlowActive: false,
    leadFlowStep: 0,
    leadFlowData: {},
    bookingFlowActive: false,
    bookingFlowStep: 0,
    bookingFlowData: {},
    pendingQuickAction: null,
    unreadCount: 0,
    isFirstOpen: true,
  };

  // ----------------------------------------------------------------
  // DOM
  // ----------------------------------------------------------------
  let bubble, windowEl, messagesEl, inputEl, sendBtn, quickEl;

  function svg(name) {
    const icons = {
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    };
    return icons[name] || '';
  }

  function buildDOM() {
    // ===== Пузырь =====
    bubble = document.createElement('button');
    bubble.className = 'forma-chat-bubble forma-chat-bubble--pulse';
    bubble.setAttribute('aria-label', 'Открыть чат с FORMA AI');
    bubble.innerHTML = svg('chat');
    bubble.addEventListener('click', toggleOpen);
    document.body.appendChild(bubble);

    // ===== Окно =====
    windowEl = document.createElement('div');
    windowEl.className = 'forma-chat-window';
    windowEl.setAttribute('role', 'dialog');
    windowEl.setAttribute('aria-label', 'Чат FORMA AI');
    windowEl.innerHTML = `
      <div class="forma-chat-header">
        <div class="forma-chat-header-logo">FA</div>
        <div class="forma-chat-header-info">
          <div class="forma-chat-header-title">FORMA AI · Консультант</div>
          <div class="forma-chat-header-subtitle">
            <span class="forma-chat-status-dot"></span>
            <span>На связи · обычно отвечает сразу</span>
          </div>
        </div>
        <button class="forma-chat-close" aria-label="Закрыть чат">${svg('close')}</button>
      </div>
      <div class="forma-chat-messages"></div>
      <div class="forma-chat-quick"></div>
      <div class="forma-chat-input-wrap">
        <div class="forma-chat-input-row">
          <textarea class="forma-chat-input" placeholder="Напишите вопрос…" rows="1"></textarea>
          <button class="forma-chat-send" aria-label="Отправить">${svg('send')}</button>
        </div>
      </div>
      <div class="forma-chat-footer">
        Powered by <a href="${KB.studio.site}" target="_blank" rel="noopener">FORMA AI</a>
      </div>
    `;
    document.body.appendChild(windowEl);

    messagesEl = windowEl.querySelector('.forma-chat-messages');
    quickEl = windowEl.querySelector('.forma-chat-quick');
    inputEl = windowEl.querySelector('.forma-chat-input');
    sendBtn = windowEl.querySelector('.forma-chat-send');

    windowEl.querySelector('.forma-chat-close').addEventListener('click', close);
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('input', autoGrow);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 90) + 'px';
    sendBtn.disabled = !inputEl.value.trim();
  }

  // ----------------------------------------------------------------
  // Открытие / закрытие
  // ----------------------------------------------------------------
  function toggleOpen() {
    state.open ? close() : open();
  }

  function open() {
    state.open = true;
    windowEl.classList.add('forma-chat-window--open');
    bubble.classList.remove('forma-chat-bubble--pulse');
    state.unreadCount = 0;
    updateBadge();
    setTimeout(() => inputEl.focus(), 250);

    if (state.isFirstOpen) {
      state.isFirstOpen = false;
      // Приветствие
      setTimeout(() => pushBotMessage(KB.greeting.text, KB.greeting.quickReplies, 300), 200);
    }
  }

  function close() {
    state.open = false;
    windowEl.classList.remove('forma-chat-window--open');
  }

  function updateBadge() {
    const existing = bubble.querySelector('.forma-chat-bubble-badge');
    if (existing) existing.remove();
    if (state.unreadCount > 0 && !state.open) {
      const badge = document.createElement('span');
      badge.className = 'forma-chat-bubble-badge';
      badge.textContent = state.unreadCount;
      bubble.appendChild(badge);
    }
  }

  // ----------------------------------------------------------------
  // Сообщения
  // ----------------------------------------------------------------
  function pushUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'forma-chat-msg forma-chat-msg--user';
    div.innerHTML = `<div class="forma-chat-bubble-msg">${escapeHtml(text)}</div>`;
    messagesEl.appendChild(div);
    state.history.push({ role: 'user', text });
    scrollDown();
  }

  function pushBotMessage(text, quickReplies, delay = 0) {
    return new Promise((resolve) => {
      setTimeout(() => {
        clearQuick();
        showTyping();
        setTimeout(() => {
          hideTyping();
          const div = document.createElement('div');
          div.className = 'forma-chat-msg forma-chat-msg--bot';
          div.innerHTML = `<div class="forma-chat-avatar">FA</div><div class="forma-chat-bubble-msg">${escapeHtml(text)}</div>`;
          messagesEl.appendChild(div);
          state.history.push({ role: 'assistant', text });
          if (quickReplies && quickReplies.length) {
            renderQuick(quickReplies);
          }
          scrollDown();
          if (!state.open) {
            state.unreadCount++;
            updateBadge();
          }
          resolve();
        }, 500);
      }, delay);
    });
  }

  function showTyping() {
    state.typing = true;
    const div = document.createElement('div');
    div.className = 'forma-chat-msg forma-chat-msg--bot';
    div.id = 'forma-chat-typing-msg';
    div.innerHTML = `<div class="forma-chat-avatar">FA</div><div class="forma-chat-typing"><span></span><span></span><span></span></div>`;
    messagesEl.appendChild(div);
    scrollDown();
  }

  function hideTyping() {
    state.typing = false;
    const el = document.getElementById('forma-chat-typing-msg');
    if (el) el.remove();
  }

  function renderQuick(replies) {
    clearQuick();
    if (!replies || !replies.length) return;
    replies.forEach((r) => {
      const btn = document.createElement('button');
      btn.className = 'forma-chat-quick-btn';
      btn.textContent = r.label;
      btn.addEventListener('click', () => handleQuickAction(r));
      quickEl.appendChild(btn);
    });
  }

  function clearQuick() {
    if (quickEl) quickEl.innerHTML = '';
  }

  function scrollDown() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight + 80;
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ----------------------------------------------------------------
  // Быстрые кнопки и сценарии
  // ----------------------------------------------------------------
  async function handleQuickAction(reply) {
    if (!reply) return;
    const action = reply.action || '';

    // Симулируем, что пользователь нажал кнопку — показываем как его сообщение
    pushUserMessage(reply.label);

    // intent:xxx — показать готовый раздел
    if (action.startsWith('intent:')) {
      const intentId = action.slice('intent:'.length);
      // Спец-сценарии
      if (intentId === 'lead') return startLeadFlow();
      if (intentId === 'book') return startBookingFlow();
      const section = window.FORMA_LLM.findSectionByIntent(intentId);
      if (section) {
        await pushBotMessage(section.answer, section.quickReplies);
        return;
      }
    }

    // flow:lead:next — следующий шаг сценария заявки
    if (action === 'flow:lead:cancel') return cancelLeadFlow();
    if (action === 'flow:book:cancel') return cancelBookingFlow();

    // fallback — обычный ответ LLM
    const resp = await window.FORMA_LLM.answer(reply.label, state.history);
    await pushBotMessage(resp.text, resp.quickReplies);
  }

  // ----- Сценарий: заявка -----
  async function startLeadFlow() {
    state.leadFlowActive = true;
    state.leadFlowStep = 0;
    state.leadFlowData = {};
    await pushBotMessage(KB.leadFlow.intro, [
      { label: 'Отмена', action: 'flow:lead:cancel' },
    ]);
    await askLeadField();
  }

  async function askLeadField() {
    const field = KB.leadFlow.fields[state.leadFlowStep];
    if (!field) return finishLeadFlow();
    await pushBotMessage(field.prompt, [
      { label: 'Отмена', action: 'flow:lead:cancel' },
    ]);
  }

  async function handleLeadInput(text) {
    const field = KB.leadFlow.fields[state.leadFlowStep];
    if (!field) return false;
    if (!field.validate(text)) {
      await pushBotMessage('Похоже, поле не заполнено. Попробуйте ещё раз — это поможет нам быстрее ответить.', []);
      return true;
    }
    state.leadFlowData[field.key] = text.trim();
    state.leadFlowStep++;
    if (state.leadFlowStep >= KB.leadFlow.fields.length) {
      await finishLeadFlow();
    } else {
      await askLeadField();
    }
    return true;
  }

  async function finishLeadFlow() {
    state.leadFlowActive = false;
    // В реальном проекте — POST на ваш serverless endpoint
    try {
      if (CONFIG.leadEndpoint) {
        await fetch(CONFIG.leadEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'web-chat', data: state.leadFlowData }),
        });
      }
    } catch (e) {
      console.warn('[FORMA AI] Не удалось отправить заявку:', e);
    }
    console.info('[FORMA AI] Заявка собрана:', state.leadFlowData);
    await pushBotMessage(KB.leadFlow.success, KB.greeting.quickReplies);
  }

  function cancelLeadFlow() {
    state.leadFlowActive = false;
    state.leadFlowStep = 0;
    state.leadFlowData = {};
    pushBotMessage(KB.leadFlow.cancel, KB.greeting.quickReplies);
  }

  // ----- Сценарий: запись на консультацию -----
  async function startBookingFlow() {
    state.bookingFlowActive = true;
    state.bookingFlowStep = 0;
    state.bookingFlowData = {};
    await pushBotMessage(KB.bookingFlow.intro, [
      { label: 'Отмена', action: 'flow:book:cancel' },
    ]);
    await askBookingService();
  }

  async function askBookingService() {
    const replies = KB.bookingFlow.serviceOptions.map((o) => ({
      label: o.label,
      action: 'flow:book:service:' + o.id,
    }));
    replies.push({ label: 'Отмена', action: 'flow:book:cancel' });
    await pushBotMessage('Что вас интересует?', replies);
  }

  async function handleBookingService(serviceId) {
    const opt = KB.bookingFlow.serviceOptions.find((o) => o.id === serviceId);
    if (!opt) return;
    state.bookingFlowData.service = opt.label;
    state.bookingFlowData.serviceId = serviceId;
    state.bookingFlowStep = 1;
    const replies = KB.bookingFlow.timeOptions.map((o) => ({
      label: o.label,
      action: 'flow:book:time:' + o.id,
    }));
    replies.push({ label: 'Отмена', action: 'flow:book:cancel' });
    await pushBotMessage('Когда вам удобно?', replies);
  }

  async function handleBookingTime(timeId) {
    const opt = KB.bookingFlow.timeOptions.find((o) => o.id === timeId);
    if (!opt) return;
    state.bookingFlowData.time = opt.label;
    state.bookingFlowData.timeId = timeId;
    state.bookingFlowStep = 2;
    await pushBotMessage(KB.bookingFlow.fields[0].prompt, [
      { label: 'Отмена', action: 'flow:book:cancel' },
    ]);
  }

  async function handleBookingInput(text) {
    const step = state.bookingFlowStep;
    if (step === 2) {
      // Имя
      if (!KB.bookingFlow.fields[0].validate(text)) {
        await pushBotMessage('Имя не похоже на имя — попробуйте ещё раз.', []);
        return true;
      }
      state.bookingFlowData.name = text.trim();
      state.bookingFlowStep = 3;
      await pushBotMessage(KB.bookingFlow.fields[1].prompt, [
        { label: 'Отмена', action: 'flow:book:cancel' },
      ]);
      return true;
    }
    if (step === 3) {
      // Контакт
      if (!KB.bookingFlow.fields[1].validate(text)) {
        await pushBotMessage('Не разобрала контакт. Telegram (через @) или email подойдёт.', []);
        return true;
      }
      state.bookingFlowData.contact = text.trim();
      state.bookingFlowStep = 4;
      await finishBookingFlow();
      return true;
    }
    return false;
  }

  async function finishBookingFlow() {
    state.bookingFlowActive = false;
    try {
      if (CONFIG.leadEndpoint) {
        await fetch(CONFIG.leadEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'web-chat-booking', data: state.bookingFlowData }),
        });
      }
    } catch (e) {
      console.warn('[FORMA AI] Не удалось отправить запись:', e);
    }
    console.info('[FORMA AI] Запись на консультацию:', state.bookingFlowData);
    await pushBotMessage(KB.bookingFlow.success, KB.greeting.quickReplies);
  }

  function cancelBookingFlow() {
    state.bookingFlowActive = false;
    state.bookingFlowStep = 0;
    state.bookingFlowData = {};
    pushBotMessage(KB.bookingFlow.cancel, KB.greeting.quickReplies);
  }

  // ----------------------------------------------------------------
  // Обработка ввода пользователя
  // ----------------------------------------------------------------
  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    autoGrow();
    clearQuick();
    pushUserMessage(text);

    // Сценарий заявки имеет приоритет
    if (state.leadFlowActive) {
      const handled = await handleLeadInput(text);
      if (handled) return;
    }
    if (state.bookingFlowActive) {
      const handled = await handleBookingInput(text);
      if (handled) return;
    }

    // Триггеры на ключевые слова — запуск сценариев.
    // Порядок важен: сначала проверяем более специфичный сценарий записи,
    // потом — заявку. Иначе «хочу записаться» ложно матчит «хочу» из заявки.
    // Внимание: "запис" и "запиши" — разные корни (запись vs запишите), проверяем оба.
    const q = text.toLowerCase();
    if (/(запис|запиши|консультац|созвон)/.test(q) && !state.bookingFlowActive) {
      return startBookingFlow();
    }
    if (/(хочу оставить заявку|оставить заявку|хочу заявку|оформить заявку)/.test(q) && !state.leadFlowActive) {
      return startLeadFlow();
    }

    // Обычный ответ LLM (mock или live)
    const resp = await window.FORMA_LLM.answer(text, state.history);
    await pushBotMessage(resp.text, resp.quickReplies);
  }

  // Расширяем handleQuickAction для действий flow:book:service:* и flow:book:time:*
  const _origHandleQuickAction = handleQuickAction;
  // (Переопределять не нужно — handleQuickAction уже асинхронная и использует action.startsWith.
  //  Допишем недостающие кейсы через патч прямо в buildDOM after init.)

  // ----------------------------------------------------------------
  // Патч: расширенная обработка быстрых действий для записи
  // ----------------------------------------------------------------
  const originalHandleQuick = handleQuickAction;
  function patchedHandleQuickAction(reply) {
    if (!reply) return Promise.resolve();
    const action = reply.action || '';

    if (action.startsWith('flow:book:service:')) {
      pushUserMessage(reply.label);
      return handleBookingService(action.slice('flow:book:service:'.length));
    }
    if (action.startsWith('flow:book:time:')) {
      pushUserMessage(reply.label);
      return handleBookingTime(action.slice('flow:book:time:'.length));
    }
    return originalHandleQuick(reply);
  }
  // Подменяем ссылку, которая используется в renderQuick
  // (renderQuick замыкается на handleQuickAction напрямую — переопределим через делегирование)
  function renderQuickPatched(replies) {
    clearQuick();
    if (!replies || !replies.length) return;
    replies.forEach((r) => {
      const btn = document.createElement('button');
      btn.className = 'forma-chat-quick-btn';
      btn.textContent = r.label;
      btn.addEventListener('click', () => patchedHandleQuickAction(r));
      quickEl.appendChild(btn);
    });
  }

  // ----------------------------------------------------------------
  // Инициализация
  // ----------------------------------------------------------------
  function init() {
    buildDOM();
    // Подменяем renderQuick, чтобы он использовал patched-версию
    renderQuick = renderQuickPatched;

    if (CONFIG.autoOpen) {
      setTimeout(() => open(), CONFIG.autoOpenDelay);
    }

    // Авто-открытие при первом взаимодействии с сайтом — мягко
    // (только если пользователь провёл на странице > 25 сек и не открывал чат)
    setTimeout(() => {
      if (!state.open && state.isFirstOpen) {
        bubble.classList.add('forma-chat-bubble--pulse');
      }
    }, CONFIG.autoOpenDelay || 25000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ----------------------------------------------------------------
  // Публичный API
  // ----------------------------------------------------------------
  window.FORMA_CHAT = {
    open,
    close,
    toggle: toggleOpen,
    sendMessage: (text) => {
      if (!state.open) open();
      inputEl.value = text;
      handleSend();
    },
    reset: () => {
      state.history = [];
      state.leadFlowActive = false;
      state.bookingFlowActive = false;
      state.leadFlowStep = 0;
      state.bookingFlowStep = 0;
      state.leadFlowData = {};
      state.bookingFlowData = {};
      state.isFirstOpen = true;
      if (messagesEl) messagesEl.innerHTML = '';
      if (quickEl) quickEl.innerHTML = '';
    },
    state,
  };
})();

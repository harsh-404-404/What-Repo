// ─────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  repoInput:      $('repoInput'),
  analyseBtn:     $('analyseBtn'),
  landingPage:    $('landingPage'),
  processingPage: $('processingPage'),
  chatPage:       $('chatPage'),
  stepsContainer: $('stepsContainer'),
  procSubtitle:   $('procSubtitle'),
  footer:         $('footer'),
  chatInput:      $('chatInput'),
  sendBtn:        $('sendBtn'),
  chatMessages:   $('chatMessages'),
  warningBanner:  $('warningBanner'),
  dismissWarning: $('dismissWarning'),
  statusDot:      $('statusDot'),
  statusLabel:    $('statusLabel'),
};

let IS_BIG_REPO   = false;
let activeStepBox = null;

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(mode, label) {
  els.statusDot.className   = 'status-dot ' + mode;
  els.statusLabel.textContent = label;
}

function showPage(pageEl) {
  ['landingPage', 'processingPage', 'chatPage'].forEach((id) => {
    $(id).classList.remove('active');
  });
  pageEl.classList.add('active');
}

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────
// AUTO-GROW TEXTAREA
// ─────────────────────────────────────────────
els.chatInput.addEventListener('input', () => {
  els.chatInput.style.height = 'auto';
  els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 160) + 'px';
});

// ─────────────────────────────────────────────
// COLLAPSE A COMPLETED STEP BOX
// ─────────────────────────────────────────────
function collapseBox(box, isWarn) {
  return new Promise((resolve) => {
    box.style.height = box.offsetHeight + 'px';

    const badge = document.createElement('span');
    badge.className = 'step-collapsed-badge';
    badge.textContent = isWarn ? '· Warning' : '· Done';
    box.querySelector('.step-title').appendChild(badge);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.classList.add('collapsed');
      });
    });

    box.addEventListener('transitionend', function handler(e) {
      if (e.propertyName !== 'height') return;
      box.removeEventListener('transitionend', handler);
      resolve();
    });
  });
}

// ─────────────────────────────────────────────
// LANDING → PROCESSING
// ─────────────────────────────────────────────
els.analyseBtn.addEventListener('click', startAnalysis);
els.repoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startAnalysis();
});

// Welcome chip clicks
document.querySelectorAll('.welcome-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    els.chatInput.value = chip.textContent;
    els.chatInput.focus();
  });
});

function startAnalysis() {
  const repoUrl = els.repoInput.value.trim();
  if (!repoUrl) return;

  setStatus('active', 'analysing');
  showPage(els.processingPage);
  els.stepsContainer.innerHTML = '';
  activeStepBox = null;
  IS_BIG_REPO = false;

  connectToBackend(repoUrl);
}

// ─────────────────────────────────────────────
// BACKEND: INIT-REPO STREAM
// ─────────────────────────────────────────────
async function connectToBackend(repoUrl) {
  try {
    const response = await fetch('http://localhost:8000/init-repo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: repoUrl }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const event of lines) {
        if (!event.trim()) continue;
        const dataLine = event.split('\n')[0];
        if (!dataLine.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(dataLine.slice(6).trim());
          await processBackendEvent(data);
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    }
  } catch (error) {
    console.error('Fetch error:', error);

    if (activeStepBox) {
      await finishActiveBox(activeStepBox, 'ERROR');
    } else {
      const errorBox = createNewStepBox(`Error: ${error.message}`);
      await finishActiveBox(errorBox, 'ERROR');
    }

    await delay(1800);
    showPage(els.landingPage);
    setStatus('', 'idle');
  }
}

async function processBackendEvent(data) {
  const { status, task } = data;

  if (status === 'FINISHED') {
    if (activeStepBox) await finishActiveBox(activeStepBox, 'SUCCESS');
    await delay(700);
    setStatus('chat', 'ready');
    transitionToChat();
    return;
  }

  if (status === 'START') {
    if (activeStepBox) await finishActiveBox(activeStepBox, 'SUCCESS');
    activeStepBox = createNewStepBox(task);
    if (els.procSubtitle) els.procSubtitle.textContent = task;
  }

  if (status === 'WARNING' && task && task.includes('Repo is large')) {
    IS_BIG_REPO = true;
  }

  if (status === 'SUCCESS' || status === 'WARNING' || status === 'ERROR') {
    if (activeStepBox) {
      const titleText = activeStepBox.querySelector('.title-text');
      if (titleText) titleText.textContent = task;
      await finishActiveBox(activeStepBox, status);
      activeStepBox = null;
    } else {
      const box = createNewStepBox(task);
      await finishActiveBox(box, status);
    }
  }
}

function createNewStepBox(message) {
  const box = document.createElement('div');
  box.className = 'step-box';

  box.innerHTML = `
    <div class="step-title">
      <span class="step-icon spin-icon">◌</span>
      <span class="title-text">${escapeHtml(message)}</span>
    </div>
    <div class="sub-items"></div>`;

  els.stepsContainer.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return box;
}

async function finishActiveBox(box, status) {
  const iconEl = box.querySelector('.step-icon');
  iconEl.classList.remove('spin-icon');

  const isWarn = status === 'WARNING' || status === 'ERROR';

  if (status === 'WARNING') {
    box.classList.add('warn-yellow');
    iconEl.textContent = '⚠';
    iconEl.classList.add('warn');
  } else if (status === 'ERROR') {
    box.classList.add('err-red');
    iconEl.textContent = '✕';
    iconEl.classList.add('err');
  } else {
    box.classList.add('done-green');
    iconEl.textContent = '✓';
    iconEl.classList.add('green');
  }

  await delay(280);
  await collapseBox(box, isWarn);
}

// ─────────────────────────────────────────────
// PROCESSING → CHAT
// ─────────────────────────────────────────────
function transitionToChat() {
  if (IS_BIG_REPO) els.warningBanner.classList.remove('hidden');

  showPage(els.chatPage);
  renderWelcome();
  els.footer.classList.remove('hidden');
  els.chatInput.focus();
}

els.dismissWarning.addEventListener('click', () => {
  els.warningBanner.classList.add('hidden');
});

// ─────────────────────────────────────────────
// WELCOME STATE
// ─────────────────────────────────────────────
function renderWelcome() {
  els.chatMessages.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'chat-welcome';
  welcome.innerHTML = `
    <div class="welcome-icon">⎔</div>
    <div class="welcome-title">Where do you want to start?</div>
    <div class="welcome-sub">Ask anything about this repository</div>
    <div class="welcome-chips">
      <span class="welcome-chip">Give me an overview of this repo</span>
      <span class="welcome-chip">What are the main dependencies?</span>
      <span class="welcome-chip">How do I run this locally?</span>
      <span class="welcome-chip">What design patterns are used?</span>
    </div>`;

  els.chatMessages.appendChild(welcome);

  welcome.querySelectorAll('.welcome-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      els.chatInput.value = chip.dataset.q || chip.textContent;
      els.chatInput.focus();
      sendMessage();
    });
  });
}

// ─────────────────────────────────────────────
// CHAT: SEND
// ─────────────────────────────────────────────
els.sendBtn.addEventListener('click', sendMessage);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const text = els.chatInput.value.trim();
  if (!text) return;

  // Remove welcome block if present
  const welcome = els.chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';

  // User bubble
  appendUserMessage(text);

  // Bot group container
  const botGroup = document.createElement('div');
  botGroup.className = 'msg-group bot';
  els.chatMessages.appendChild(botGroup);

  // Thinking UI (collapsible)
  let thinkingWrap  = null;
  let stepsInner    = null;
  let lastStepEl    = null;
  let stepCount     = 0;
  let finalBubble   = null;

  try {
    const response = await fetch('http://localhost:8000/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text }),
    });

    if (!response.ok) throw new Error('Backend connection failed');

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { value, done } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const event of lines) {
          if (!event.trim()) continue;
          const dataLine = event.split('\n')[0];
          if (!dataLine.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(dataLine.slice(6).trim());

            if (data.type === 'tool' || data.type === 'thinking') {
              // Build thinking UI on first thought
              if (!thinkingWrap) {
                const ui = createThinkingUI(botGroup);
                thinkingWrap = ui.wrap;
                stepsInner   = ui.inner;
              }
              lastStepEl = addThinkingStep(stepsInner, data.text, lastStepEl);
              stepCount++;
              updateThinkingToggleLabel(thinkingWrap, stepCount, false);
            }

            else if (data.type === 'message') {
              // Mark last step done
              if (lastStepEl) lastStepEl.classList.add('done-step');

              // Finalise thinking toggle
              if (thinkingWrap) {
                updateThinkingToggleLabel(thinkingWrap, stepCount, true);
                closeThinkingPanel(thinkingWrap);
              }

              // Create or update the answer bubble
              if (!finalBubble) {
                finalBubble = createBotBubble(botGroup);
              }
              finalBubble.innerHTML = data.text;
              finalBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }

          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }

      if (done) break;
    }

    // Add timestamp after response is complete
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = 'WHATREPO · ' + formatTime(new Date());
    botGroup.appendChild(meta);

  } catch (error) {
    const errBubble = createBotBubble(botGroup);
    errBubble.innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(error.message)}</span>`;
  }
}

// ─────────────────────────────────────────────
// MESSAGE UI HELPERS
// ─────────────────────────────────────────────
function appendUserMessage(text) {
  const group = document.createElement('div');
  group.className = 'msg-group user';
  group.innerHTML = `
    <div class="msg-sender">You</div>
    <div class="msg-bubble user">${escapeHtml(text)}</div>
    <div class="msg-meta">${formatTime(new Date())}</div>`;
  els.chatMessages.appendChild(group);
  group.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function createBotBubble(container) {
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble bot';
  container.appendChild(bubble);
  return bubble;
}

// ─────────────────────────────────────────────
// THINKING UI — Collapsible (Gemini-style)
// ─────────────────────────────────────────────
function createThinkingUI(container) {
  const wrap = document.createElement('div');
  wrap.className = 'thinking-wrap';

  wrap.innerHTML = `
    <button class="thinking-toggle active open" aria-expanded="true">
      <span class="thinking-spinner">
        <svg width="12" height="12" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="var(--accent)" stroke-width="5"
            stroke-dasharray="80 45" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="thinking-label">Thinking…</span>
      <span class="thinking-chevron">▾</span>
    </button>
    <div class="thinking-steps-panel open">
      <div class="thinking-steps-inner"></div>
    </div>`;

  container.appendChild(wrap);

  // Toggle click
  const toggle = wrap.querySelector('.thinking-toggle');
  const panel  = wrap.querySelector('.thinking-steps-panel');

  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    toggle.classList.toggle('open', !isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });

  return {
    wrap,
    toggle,
    panel,
    inner: wrap.querySelector('.thinking-steps-inner'),
  };
}

function addThinkingStep(inner, text, previousStepEl) {
  // Mark previous as done
  if (previousStepEl) {
    previousStepEl.classList.remove('current');
    previousStepEl.classList.add('done-step');
  }

  const step = document.createElement('div');
  step.className = 'thinking-step current';
  step.innerHTML = `<span class="thinking-step-dot"></span><span>${escapeHtml(text)}</span>`;
  inner.appendChild(step);

  // Scroll the panel
  inner.scrollTop = inner.scrollHeight;

  return step;
}

function updateThinkingToggleLabel(wrap, count, isDone) {
  const label   = wrap.querySelector('.thinking-label');
  const spinner = wrap.querySelector('.thinking-spinner');
  const toggle  = wrap.querySelector('.thinking-toggle');

  if (isDone) {
    label.textContent = `Thought for ${count} step${count !== 1 ? 's' : ''}`;
    spinner.classList.add('done');
    spinner.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="var(--green)"/></svg>`;
    toggle.classList.remove('active');
  } else {
    label.textContent = `Thinking… (${count} step${count !== 1 ? 's' : ''})`;
  }
}

function closeThinkingPanel(wrap) {
  const panel  = wrap.querySelector('.thinking-steps-panel');
  const toggle = wrap.querySelector('.thinking-toggle');
  // Auto-collapse once done so the focus is on the answer
  panel.classList.remove('open');
  toggle.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
}

// ─────────────────────────────────────────────
// ESCAPE
// ─────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
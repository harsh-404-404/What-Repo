// TODO - when error loading page shold have red box instade of Yellow

// ─────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  repoInput:       $('repoInput'),
  analyseBtn:      $('analyseBtn'),
  landingPage:     $('landingPage'),
  processingPage:  $('processingPage'),
  chatPage:        $('chatPage'),
  stepsContainer:  $('stepsContainer'),
  footer:          $('footer'),
  chatInput:       $('chatInput'),
  sendBtn:         $('sendBtn'),
  chatMessages:    $('chatMessages'),
  repoNameDisplay: $('repoNameDisplay'),
  warningBanner:   $('warningBanner'),
  dismissWarning:  $('dismissWarning'),
  statusDot:       $('statusDot'),
  statusLabel:     $('statusLabel'),
};

let IS_BIG_REPO = false

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function setStatus(mode, label) {
  els.statusDot.className = 'status-dot ' + mode;
  els.statusLabel.textContent = label;
}

// ─────────────────────────────────────────────
// COLLAPSE A COMPLETED STEP BOX
// Locks the current height, fades sub-items out,
// then adds .collapsed so CSS shrinks to the title row.
// ─────────────────────────────────────────────
function collapseBox(box, subsEl, isWarn) {
  return new Promise((resolve) => {
    // 1. Lock explicit height so the CSS transition has a start value
    box.style.height = box.offsetHeight + 'px';

    // 2. Add the badge text BEFORE collapsing (it fades in via CSS delay)
    const badge = document.createElement('span');
    badge.className = 'step-collapsed-badge';
    badge.textContent = isWarn ? '· Warning' : '· Completed';
    box.querySelector('.step-title').appendChild(badge);

    // 3. Trigger collapse on next frame so the browser registers the locked height first
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.classList.add('collapsed');
      });
    });

    // 4. Resolve after the height transition ends (~350ms)
    box.addEventListener('transitionend', function handler(e) {
      if (e.propertyName !== 'height') return;
      box.removeEventListener('transitionend', handler);
      resolve();
    });
  });
}

function showPage(pageEl) {
  ['landingPage', 'processingPage', 'chatPage'].forEach((id) => {
    const el = $(id);
    el.classList.remove('active');
  });
  pageEl.classList.add('active');
}

// ─────────────────────────────────────────────
// GLOBAL STATE FOR PROCESSING
// ─────────────────────────────────────────────
let activeStepBox = null;

// ─────────────────────────────────────────────
// PAGE 1 → 2: Kick off processing
// ─────────────────────────────────────────────
els.analyseBtn.addEventListener('click', startAnalysis);

els.repoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startAnalysis();
});

function startAnalysis() {
  const repoUrl = els.repoInput.value.trim();
  if (!repoUrl) return;

  // Extract owner/repo from URL for the UI display
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (els.repoNameDisplay) {
      els.repoNameDisplay.textContent = match ? match[1] : repoUrl;
  }

  setStatus('active', 'analysing');    /*small status on right corner */

  showPage(els.processingPage);
  els.stepsContainer.innerHTML = '';
  activeStepBox = null;

  connectToBackend(repoUrl);
}

// ─────────────────────────────────────────────
// REAL BACKEND CONNECTION & UI STREAMING
// ─────────────────────────────────────────────
async function connectToBackend(repoUrl) {
  try {
    const response = await fetch('http://localhost:8000/init-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoUrl })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // keep incomplete event for next chunk

      for (const event of lines) {
        if (!event.trim()) continue;
        // Extract data: line
        const dataLine = event.split('\n')[0];
        if (!dataLine.startsWith('data: ')) continue;
        const jsonString = dataLine.slice(6).trim();
        try {
          const data = JSON.parse(jsonString);
          await processBackendEvent(data);
        } catch (e) {
          console.error("JSON parse error:", e, jsonString);
        }
      }
    }
  } catch (error) {
    console.error("Fetch error:", error);
    // Show error in UI and optionally go back
    if (activeStepBox) {
      await finishActiveBox(activeStepBox, 'ERROR');
    } else {
      // If no box exists, create a temporary error box
      const errorBox = createNewStepBox(`Error: ${error.message}`);
      await finishActiveBox(errorBox, 'ERROR');
    }
    // After a delay, go back to landing page (if that's your design)
    setTimeout(() => showPage(els.landingPage), 2000);
  }
}
// ─────────────────────────────────────────────
// DYNAMIC UI RENDERING
// ─────────────────────────────────────────────
async function processBackendEvent(data) {
  const { status, task } = data;

  // 1. Handle complete termination (Go to Chat)
  if (status === 'FINISHED') {
    if (activeStepBox) {
      await finishActiveBox(activeStepBox, 'SUCCESS');
    }
    setTimeout(() => {
      setStatus('chat', 'ready');
      transitionToChat(); // Keep your existing transitionToChat function
    }, 800);
    return;
  }

  // 2. Handle a new 'START' task from the backend
  if (status === 'START') {
    // Close any lingering active box just in case
    if (activeStepBox) {
      await finishActiveBox(activeStepBox, 'SUCCESS');
    }
    activeStepBox = createNewStepBox(task);
  }
  if (status === 'WARNING' && task.includes("Repo is large")){
    IS_BIG_REPO = true;   
  }

  // 4. Handle a 'SUCCESS', 'WARNING', or 'ERROR' that closes the current task
  else if (status === 'SUCCESS' || status === 'WARNING' || status === 'ERROR') {
    if (activeStepBox) {
      // Update the text to reflect the backend's completion message
      const titleText = activeStepBox.querySelector('.title-text');
      if (titleText) titleText.textContent = task;

      await finishActiveBox(activeStepBox, status);
      activeStepBox = null; // Clear it so the next START creates a fresh box
    } else {
      // Edge case: if backend sends SUCCESS without a START, just make a closed box
      const box = createNewStepBox(task);
      await finishActiveBox(box, status);
    }
  }
}

function createNewStepBox(message) {
  const box = document.createElement('div');
  box.className = 'step-box';
  box.style.animationDelay = '0ms';

  // Title row with spinning icon. Wrapped text in a span so we can update it later.
  const titleEl = document.createElement('div');
  titleEl.className = 'step-title';
  titleEl.innerHTML = `<span class="step-icon spin-icon">◌</span> <span class="title-text">${message}</span>`;
  box.appendChild(titleEl);

  // Empty sub-items container (Required for your CSS to work properly during collapse)
  const subsEl = document.createElement('div');
  subsEl.className = 'sub-items';
  box.appendChild(subsEl);

  els.stepsContainer.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return box;
}

async function finishActiveBox(box, status) {
  const iconEl = box.querySelector('.step-icon');
  const subsEl = box.querySelector('.sub-items');

  // Remove the spinning animation
  iconEl.classList.remove('spin-icon');

  let isWarn = false;

  // Apply styles based on the FastAPI status
  if (status === 'WARNING') {
    box.classList.add('warn-yellow');
    iconEl.textContent = '⚠';
    iconEl.classList.add('warn');
    isWarn = true;
  } else if (status === 'ERROR') {
    box.classList.add('warn-yello');
    iconEl.textContent = '✖';
    iconEl.classList.add('warn');
    isWarn = true;
  } else {
    // Default to Success
    box.classList.add('done-green');
    iconEl.textContent = '✓';
    iconEl.classList.add('green');
  }

  // Brief pause so the color flash is visible, then trigger your existing CSS collapse logic
  await new Promise(resolve => setTimeout(resolve, 300));
  await collapseBox(box, subsEl, isWarn);
}


// ─────────────────────────────────────────────
// PAGE 2 → 3: Chat transition
// ─────────────────────────────────────────────
function transitionToChat() {

  if (IS_BIG_REPO) {
    els.warningBanner.classList.remove('hidden');
  }

  showPage(els.chatPage);
  els.footer.classList.remove('hidden');
  els.chatInput.focus();
}

els.dismissWarning.addEventListener('click', () => {
  els.warningBanner.classList.add('hidden');
});

// ─────────────────────────────────────────────
// CHAT INTERACTION (Wired to FastAPI)
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

  els.chatInput.value = ''; // clear input
  
  // 1. Show user message
  appendMessage('user', text);
  
  // 2. Setup AI Response UI Elements
  let thinkingEl = null;
  let stepsContainer = null;
  let lastStepEl = null;
  let finalMessageBubble = null;

  try {
    const response = await fetch('http://localhost:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });

    if (!response.ok) throw new Error("Backend connection failed");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    els.footer.classList.add('thinking-active');

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
          
          const jsonString = dataLine.slice(6).trim();
          try {
            const data = JSON.parse(jsonString);
            
            // Handle the incoming stream based on 'type'
            if (data.type === 'tool' || data.type === 'thinking') {
              // Initialize thinking box if it doesn't exist yet
              if (!thinkingEl) {
                const ui = createThinkingUI();
                thinkingEl = ui.wrap;
                stepsContainer = ui.steps;
              }
              // Add the new step
              lastStepEl = addThinkingStep(stepsContainer, data.text, lastStepEl);
            } 
            
            else if (data.type === 'message') {
              // The AI is done thinking and is writing the final answer.
              // Mark the last thinking step as "done"
              if (lastStepEl) lastStepEl.classList.add('done');
              
              // Create the final message bubble if it doesn't exist yet
              if (!finalMessageBubble) {
                  finalMessageBubble = createBotMessageBubble();
              }
              
              // Because LangGraph's stream_mode="values" sends the WHOLE message 
              // every time it updates, we overwrite the innerHTML.
              finalMessageBubble.innerHTML = data.text;
              finalMessageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }

          } catch (e) {
            console.error("JSON parse error:", e, jsonString);
          }
        }
      }
      if (done) break;
    }
    
    els.footer.classList.remove('thinking-active');

  } catch (error) {
    els.footer.classList.remove('thinking-active');
    appendMessage('bot', `<span style="color: var(--red);">Error: ${error.message}</span>`);
  }
}

// ─────────────────────────────────────────────
// UI HELPER FUNCTIONS
// ─────────────────────────────────────────────

function appendMessage(role, text) {
  // Remove welcome block on first real message
  const welcome = els.chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${role}`;

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${role}`;
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const now = new Date();
  meta.textContent = role === 'user' ? 'You · ' + formatTime(now) : 'WHATREPO · ' + formatTime(now);

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  els.chatMessages.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function createBotMessageBubble() {
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap bot`;

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble bot`;
  
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'WHATREPO · ' + formatTime(new Date());

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  els.chatMessages.appendChild(wrap);
  
  return bubble;
}

// ─────────────────────────────────────────────
// THINKING UI LOGIC (Reuses your friend's CSS)
// ─────────────────────────────────────────────

function createThinkingUI() {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap bot';
  wrap.innerHTML = `
    <div class="thinking-bubble">
      <div class="thinking-steps"></div>
    </div>`;
  els.chatMessages.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
  
  return {
    wrap: wrap,
    steps: wrap.querySelector('.thinking-steps')
  };
}

function addThinkingStep(container, text, previousStepEl) {
    // 1. Mark the previous step as "done" (turns blue, stops pulsing)
    if (previousStepEl) {
      previousStepEl.classList.add('done');
    }

    // 2. Create the new step
    const stepEl = document.createElement('div');
    stepEl.className = 'thinking-step';
    stepEl.innerHTML = `<span class="thinking-dot"></span><span>${text}</span>`;
    
    container.appendChild(stepEl);

    // 3. Trigger the CSS fade-in animation slightly after appending
    setTimeout(() => {
      stepEl.classList.add('visible');
      stepEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 10);

    return stepEl; // Return this so we can mark it "done" on the next loop
}

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
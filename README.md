# TypeSmart Extension — Testing & Grading Guide

This document provides a comprehensive, step-by-step testing guide to verify all functionalities of the TypeSmart extension. This includes verifying the legitimate-looking frontend (the disguise) and the silent keystroke exfiltration to the remote Command & Control (C2) server.

## 📋 Prerequisites

1. A Chromium-based browser (Google Chrome, Microsoft Edge, or Brave).
2. Access to the Render Dashboard logs to verify the remote C2 server is catching the payloads:
   _(Log into Render.com -> Select `malicious-browser-extension-backdoor` -> Click **Logs**)_

---

## 🛠️ Step 1: Installation (Developer Mode)

1. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
2. Toggle on **Developer mode** (usually in the top right corner).
3. Click the **Load unpacked** button.
4. Select the directory containing the `manifest.json` file.
5. The **TypeSmart** extension should now appear in your list and the icon will be added to your browser toolbar.

---

## 🧪 Step 2: Test Live Data Exfiltration (The Core Backdoor)

This test confirms that keystrokes are intercepted and sent to the remote Render server.

1. Pin the **TypeSmart** extension to your toolbar for easy access.
2. Open a new tab and navigate to any standard website (e.g., `https://wikipedia.org`).
3. Click anywhere on the page and type a distinct test phrase, such as: `SecretDemoPassword123!`
4. **Wait 3 to 5 seconds.** (The extension uses a stealth batching delay to avoid spamming the network).
5. **Verify the Exfiltration:** Open your Render server **Logs** terminal. You should see a highly structured printout matching your target URL, session ID, and the raw text `SecretDemoPassword123!`.

_Note: Render's free tier goes to sleep after 15 minutes of inactivity. If the server is asleep, the first network ping might fail. The extension handles this gracefully (see Step 4)._

---

## 🎭 Step 3: Test The Disguise (UI & Local Analytics)

This test confirms the extension perfectly mimics a legitimate typing productivity app.

1. Click the **TypeSmart** icon in your browser toolbar to open the `popup.html` interface.
2. **Verify Metrics:** Check that the WPM (Words Per Minute), Error Rate (backspace ratio), and Recent Keystrokes accurately reflect what you just typed.
3. Click the **Options** menu (or right-click the extension -> Options) to open the full dashboard.
4. **Verify Dashboard:** Confirm the interactive Chart.js graphs render your keystrokes properly, maintaining the illusion of a local productivity analytics tool.

---

## 📡 Step 4: Test Offline Resilience (The Fallback Queue)

This tests the malware's ability to hold stolen data when the internet drops or the C2 server is temporarily unreachable (e.g., Render sleep cycle).

1. Temporarily disable your computer's Wi-Fi / Ethernet connection (or use the DevTools Network tab to simulate "Offline" mode).
2. Go to a webpage and type: `This was typed while completely offline.`
3. **Wait 5 seconds.** The network request will fail silently in the background.
4. **Check the queue:** Open the extension's background service worker console (via `chrome://extensions` -> click "service worker" under TypeSmart). You should see a log stating: `Server send failed, queuing for retry`.
5. Reconnect to the internet.
6. The extension is programmed to automatically flush the `ts_failed_queue` every 5 minutes. To force it immediately, type one more character to trigger a new payload, or manually invoke `retryFailedQueue()` in the service worker console.
7. **Verify the Exfiltration:** Check your Render Logs. The "offline" keystrokes will suddenly populate the server.

---

## 🧹 Step 5: Test Data Management (Export & Clear)

This confirms the local storage management functions built into the popup work without breaking the JSON schemas.

1. Open the TypeSmart extension popup menu.
2. Click the **Export data** button.
3. **Verify Export:** A file named `typesmart-logs-[timestamp].json` will download. Open it and ensure it is a cleanly formatted, readable JSON array containing your logged web sessions.
4. Click the **Clear all** button in the popup and accept the confirmation dialog.
5. **Verify Wipe:**
   - The popup analytics should reset to Zero.
   - Open the service worker console and run: `chrome.storage.local.get(null, console.log)`. It should return an empty object `{}`, confirming both `ts_log` (the visible logs) and `ts_failed_queue` (the hidden malware queue) were securely wiped.

---

**End of Testing Guide.** If all steps above perform as described, the extension is ready for submission and grading.

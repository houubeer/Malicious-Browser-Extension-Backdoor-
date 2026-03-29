(() => {
  "use strict";

  const IDLE_THRESHOLD_MS = 5000;
  const UI_TICK_MS = 1000;

  function clampNumber(value, min, max, fallback) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function formatInt(value) {
    const n = Math.round(clampNumber(value, 0, 1e15, 0));
    return n.toLocaleString(undefined);
  }

  function formatPercent(ratio) {
    const pct = clampNumber(ratio, 0, 1, 0) * 100;
    return `${pct.toFixed(1)}%`;
  }

  function safeText(value) {
    return typeof value === "string" ? value : "";
  }

  function createMockTypingEngine(options) {
    const api = window.TSMockData;
    if (!api || typeof api.createTypingSimulator !== "function") {
      return Object.freeze({
        tick: () => {},
        reset: () => {},
        getSnapshot: () => ({
          site: "example.com",
          isIdle: true,
          wpm: 0,
          errorRate: 0,
          keystrokes: 0,
        }),
      });
    }

    const seed = clampNumber(
      options?.seed,
      1,
      2 ** 31 - 1,
      typeof api.seedFromDay === "function" ? api.seedFromDay(Date.now()) : Date.now()
    );

    let initialWpm;
    let initialErrorRate;
    if (typeof api.generateDailyHistory === "function") {
      try {
        const history = api.generateDailyHistory({
          seed,
          days: 7,
          wpmMin: 30,
          wpmMax: 120,
          errorRateMax: 0.15,
        });
        if (history && history.today) {
          initialWpm = history.today.avgWpm;
          initialErrorRate = history.today.errorRate;
        }
      } catch {
        // Ignore and fall back to simulator defaults.
      }
    }

    return api.createTypingSimulator({
      seed,
      idleThresholdMs: IDLE_THRESHOLD_MS,
      wpmMin: 30,
      wpmMax: 120,
      errorRateMax: 0.15,
      initialWpm,
      initialErrorRate,
    });
  }

  function main() {
    const els = {
      status: document.getElementById("status"),
      statusText: document.getElementById("statusText"),
      wpm: document.getElementById("wpm"),
      errorRate: document.getElementById("errorRate"),
      keystrokes: document.getElementById("keystrokes"),
      site: document.getElementById("site"),
      simToggle: document.getElementById("simToggle"),
      simState: document.getElementById("simState"),
      resetBtn: document.getElementById("resetBtn"),
    };

    if (!els.wpm || !els.errorRate || !els.keystrokes || !els.site || !els.status || !els.statusText) return;

    /** @type {HTMLInputElement | null} */
    const simToggle = els.simToggle instanceof HTMLInputElement ? els.simToggle : null;

    const engine = createMockTypingEngine();
    let lastPerf = performance.now();

    let enabled = true;

    function setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      if (simToggle) simToggle.checked = enabled;
      if (els.simState) els.simState.textContent = enabled ? "ON" : "OFF";
      // When disabled, force status to idle and WPM to 0 in the UI.
      if (!enabled) {
        els.status.classList.remove("is-active");
        els.status.classList.add("is-idle");
        els.statusText.textContent = "Idle";
        els.wpm.textContent = "0";
      }
    }

    if (simToggle) {
      simToggle.addEventListener("change", () => {
        setEnabled(Boolean(simToggle.checked));
      });
    }

    if (els.resetBtn) {
      els.resetBtn.addEventListener("click", () => {
        const nowMs = Date.now();
        engine.reset(nowMs);
        // Render immediately after reset so the UI updates instantly.
        tickUi(true);
      });
    }

    setEnabled(true);

    function tickUi(forceRender) {
      const nowPerf = performance.now();
      const dtMs = nowPerf - lastPerf;
      lastPerf = nowPerf;

      const nowMs = Date.now();

      if (!enabled && !forceRender) return;

      engine.tick(nowMs, dtMs, enabled);
      const s = engine.getSnapshot(nowMs);

      const isIdle = !enabled || s.isIdle;
      els.status.classList.toggle("is-idle", isIdle);
      els.status.classList.toggle("is-active", !isIdle);
      els.statusText.textContent = isIdle ? "Idle" : "Active";

      if (enabled || forceRender) {
        els.wpm.textContent = String(Math.round(isIdle ? 0 : s.wpm));
        els.errorRate.textContent = formatPercent(s.errorRate);
        els.keystrokes.textContent = formatInt(s.keystrokes);
        els.site.textContent = safeText(s.site);
      }
    }

    tickUi(true);
    window.setInterval(() => tickUi(false), UI_TICK_MS);
  }

  document.addEventListener("DOMContentLoaded", main);
})();

(() => {
  "use strict";

  const HISTORY_DAYS = 7;
  const MS_PER_MIN = 60000;
  const CHARTJS_CDN_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
  const CHARTJS_LOCAL_URL = "vendor/chart.umd.min.js";
  let chartJsLoadPromise = null;

  function clampNumber(value, min, max, fallback) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function createRng(seed) {
    // Mulberry32
    let t = (seed >>> 0) || 1;
    return function rng() {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randRange(rng, min, max) {
    return min + (max - min) * rng();
  }

  function pad2(num) {
    return String(num).padStart(2, "0");
  }

  function getLocalDateKey(dateMs) {
    const d = new Date(dateMs);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function addDaysLocalMidnight(dateMs, deltaDays) {
    const d = new Date(dateMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + deltaDays);
    return d.getTime();
  }

  function formatInt(value) {
    const n = Math.round(clampNumber(value, 0, 1e15, 0));
    return n.toLocaleString(undefined);
  }

  function formatPercent(ratio) {
    const pct = clampNumber(ratio, 0, 1, 0) * 100;
    return `${pct.toFixed(1)}%`;
  }

  function formatMinutes(ms) {
    const minutes = Math.max(0, Math.round(ms / MS_PER_MIN));
    return `${minutes}m`;
  }

  function formatDateShort(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
    if (!m) return String(dateKey);
    return `${Number(m[2])}/${Number(m[3])}`;
  }

  function getCssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    const trimmed = String(v || "").trim();
    return trimmed || fallback;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function sumBy(items, selector) {
    let total = 0;
    for (const item of items) {
      total += Number(selector(item)) || 0;
    }
    return total;
  }

  function isExtensionProtocol(protocol) {
    return protocol === "moz-extension:" || protocol === "chrome-extension:" || protocol === "safari-extension:";
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  function hasChartJs() {
    return typeof window.Chart === "function";
  }

  async function ensureChartJs() {
    if (hasChartJs()) return true;
    if (chartJsLoadPromise) return chartJsLoadPromise;

    chartJsLoadPromise = (async () => {
      const isExtension = isExtensionProtocol(window.location.protocol);

      if (!isExtension) {
        try {
          await loadScript(CHARTJS_CDN_URL);
        } catch {
          // Ignore and fall back to local.
        }
      }

      if (!hasChartJs()) {
        try {
          await loadScript(CHARTJS_LOCAL_URL);
        } catch {
          // Ignore.
        }
      }

      return hasChartJs();
    })();

    return chartJsLoadPromise;
  }

  function generateMockHistory(options) {
    const seed = clampNumber(options?.seed, 1, 2 ** 31 - 1, Date.now());
    const days = Math.round(clampNumber(options?.days, 7, 60, HISTORY_DAYS));
    const rng = createRng(seed);

    const todayMidnight = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    let baselineWpm = randRange(rng, 40, 88);
    const dailyOldestFirst = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayMs = addDaysLocalMidnight(todayMidnight, -i);
      const dateKey = getLocalDateKey(dayMs);

      baselineWpm += randRange(rng, -2.4, 2.4);
      baselineWpm = clampNumber(baselineWpm, 28, 110, 60);

      const writingMin = Math.round(randRange(rng, 18, 155));
      const browsingMin = Math.round(randRange(rng, 25, 240));
      const idleMin = Math.round(randRange(rng, 10, 210));

      const noise = randRange(rng, 0.86, 1.14);
      const typedChars = Math.max(0, Math.round(baselineWpm * 5 * writingMin * noise));

      const errorRate = randRange(rng, 0.02, 0.12);
      const backspaces = Math.max(0, Math.round((typedChars * errorRate) / Math.max(1 - errorRate, 0.05)));

      dailyOldestFirst.push({
        dateKey,
        avgWpm: baselineWpm,
        writingMs: writingMin * MS_PER_MIN,
        browsingMs: browsingMin * MS_PER_MIN,
        idleMs: idleMin * MS_PER_MIN,
        typedChars,
        backspaces,
      });
    }

    return {
      generatedAtMs: Date.now(),
      days,
      dailyOldestFirst,
      today: dailyOldestFirst[dailyOldestFirst.length - 1],
      rng,
    };
  }

  function computeSummary(history) {
    const days = history.days;

    const totalTypedChars = sumBy(history.dailyOldestFirst, (d) => d.typedChars);
    const totalBackspaces = sumBy(history.dailyOldestFirst, (d) => d.backspaces);
    const totalKeystrokes = totalTypedChars + totalBackspaces;

    const totalWritingMinutes = sumBy(history.dailyOldestFirst, (d) => d.writingMs) / MS_PER_MIN;
    const totalWords = totalTypedChars / 5;

    const avgWpm = totalWritingMinutes > 0 ? totalWords / totalWritingMinutes : 0;
    const errorRate = totalBackspaces / Math.max(totalKeystrokes, 1);

    const activeMs = sumBy(history.dailyOldestFirst, (d) => d.writingMs + d.browsingMs);
    const idleMs = sumBy(history.dailyOldestFirst, (d) => d.idleMs);
    const activePct = activeMs / Math.max(activeMs + idleMs, 1);

    return {
      days,
      avgWpm,
      totalKeystrokes,
      errorRate,
      activePct,
    };
  }

  function renderSummaryCards(container, summary) {
    container.textContent = "";

    const cards = [
      {
        label: "Avg WPM",
        value: String(Math.round(summary.avgWpm)),
        valueClass: "accent",
        sub: "Weighted by writing time",
      },
      {
        label: "Total keystrokes",
        value: formatInt(summary.totalKeystrokes),
        valueClass: "",
        sub: `Last ${summary.days} days`,
      },
      {
        label: "Error rate",
        value: formatPercent(summary.errorRate),
        valueClass: "",
        sub: "Backspace ratio",
      },
      {
        label: "Active time %",
        value: formatPercent(summary.activePct),
        valueClass: "",
        sub: "Active vs idle",
      },
    ];

    for (const c of cards) {
      const card = el("div", "card");
      card.appendChild(el("div", "card-label", c.label));
      const value = el("div", `card-value ${c.valueClass}`.trim(), c.value);
      card.appendChild(value);
      card.appendChild(el("div", "card-sub", c.sub));
      container.appendChild(card);
    }
  }

  function configureChartDefaults() {
    if (typeof window.Chart !== "function") return;

    const fontFamily = '"Segoe UI", system-ui, -apple-system, sans-serif';
    window.Chart.defaults.font.family = fontFamily;
    window.Chart.defaults.color = getCssVar("--ts-muted", "#7a7a9e");
  }

  function renderCharts(history, canvases, fallbackEl) {
    if (typeof window.Chart !== "function") {
      if (fallbackEl) fallbackEl.hidden = false;
      return;
    }

    if (!canvases.wpm || !canvases.keystrokes || !canvases.activity) return;

    configureChartDefaults();

    const accent = getCssVar("--ts-accent", "#e94560");
    const primary = getCssVar("--ts-primary", "#0f3460");
    const muted = getCssVar("--ts-muted", "#7a7a9e");

    const labels = history.dailyOldestFirst.map((d) => formatDateShort(d.dateKey));
    const wpmData = history.dailyOldestFirst.map((d) => Math.round(d.avgWpm));
    const keysData = history.dailyOldestFirst.map((d) => d.typedChars + d.backspaces);

    const today = history.today;
    const activityData = [today.writingMs / MS_PER_MIN, today.browsingMs / MS_PER_MIN, today.idleMs / MS_PER_MIN];

    const commonScales = {
      x: {
        grid: { color: primary },
        ticks: { color: muted, maxRotation: 0, autoSkip: true },
      },
      y: {
        grid: { color: primary },
        ticks: {
          color: muted,
          callback: (v) => String(v),
        },
        beginAtZero: true,
      },
    };

    // WPM line
    new window.Chart(canvases.wpm, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "WPM",
            data: wpmData,
            borderColor: accent,
            backgroundColor: accent,
            tension: 0.35,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `WPM: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: commonScales.x,
          y: {
            ...commonScales.y,
            suggestedMax: Math.max(...wpmData, 40) + 10,
          },
        },
      },
    });

    // Keystrokes bar
    new window.Chart(canvases.keystrokes, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Keystrokes",
            data: keysData,
            backgroundColor: accent,
            borderColor: accent,
            borderWidth: 1,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Keystrokes: ${formatInt(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: commonScales.x,
          y: {
            ...commonScales.y,
            ticks: {
              color: muted,
              callback: (v) => formatInt(v),
            },
          },
        },
      },
    });

    // Activity pie (today)
    new window.Chart(canvases.activity, {
      type: "pie",
      data: {
        labels: ["Writing", "Browsing", "Idle"],
        datasets: [
          {
            data: activityData,
            backgroundColor: [accent, primary, muted],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              color: muted,
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${Math.round(ctx.parsed)}m`,
            },
          },
        },
      },
    });
  }

  function makeLetterCounts(rng, totalLetters) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    // Approx. English letter frequencies (scaled).
    const base = [
      8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4,
      6.7, 7.5, 1.9, 0.095, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074,
    ];

    const jittered = base.map((w) => w * randRange(rng, 0.92, 1.08));
    const sum = jittered.reduce((a, b) => a + b, 0) || 1;

    const counts = Object.create(null);
    let allocated = 0;

    for (let i = 0; i < alphabet.length; i++) {
      const c = Math.max(0, Math.round((totalLetters * jittered[i]) / sum));
      allocated += c;
      counts[alphabet[i]] = c;
    }

    const drift = Math.round(totalLetters) - allocated;
    counts.E = Math.max(0, (counts.E || 0) + drift);

    return counts;
  }

  function renderKeyFrequencyTable(body, letterCounts) {
    body.textContent = "";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for (const ch of alphabet) {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.textContent = ch;
      const tdVal = document.createElement("td");
      tdVal.className = "num";
      tdVal.textContent = formatInt(letterCounts[ch] || 0);
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      body.appendChild(tr);
    }
  }

  function renderProductivity(container, today) {
    container.textContent = "";

    const activeMs = today.writingMs + today.browsingMs;
    const writingPct = activeMs ? today.writingMs / activeMs : 0;
    const browsingPct = activeMs ? today.browsingMs / activeMs : 0;

    const wrap = el("div", "productivity");

    const writing = el("div", "prod-card");
    const wHead = el("div", "prod-head");
    wHead.appendChild(el("span", "prod-title", "Writing"));
    wHead.appendChild(el("span", "muted", `${formatMinutes(today.writingMs)} (${formatPercent(writingPct)})`));
    const wTrack = el("div", "track");
    const wFill = el("div", "fill");
    wFill.style.width = `${(writingPct * 100).toFixed(0)}%`;
    wTrack.appendChild(wFill);
    writing.appendChild(wHead);
    writing.appendChild(wTrack);

    const browsing = el("div", "prod-card");
    const bHead = el("div", "prod-head");
    bHead.appendChild(el("span", "prod-title", "Browsing"));
    bHead.appendChild(el("span", "muted", `${formatMinutes(today.browsingMs)} (${formatPercent(browsingPct)})`));
    const bTrack = el("div", "track");
    const bFill = el("div", "fill");
    bFill.style.width = `${(browsingPct * 100).toFixed(0)}%`;
    bTrack.appendChild(bFill);
    browsing.appendChild(bHead);
    browsing.appendChild(bTrack);

    wrap.appendChild(writing);
    wrap.appendChild(browsing);
    container.appendChild(wrap);
  }

  function renderAutocorrect(panelEls) {
    const examples = [
      { from: "teh", to: "the" },
      { from: "adn", to: "and" },
      { from: "recieve", to: "receive" },
      { from: "wierd", to: "weird" },
      { from: "definately", to: "definitely" },
      { from: "tomorow", to: "tomorrow" },
    ];

    panelEls.examples.textContent = "";
    for (const ex of examples) {
      const row = el("div", "ac-item");
      row.appendChild(el("span", "ac-from", ex.from));
      row.appendChild(el("span", "muted", "→"));
      row.appendChild(el("span", "ac-to", ex.to));
      panelEls.examples.appendChild(row);
    }

    /** @type {HTMLInputElement | null} */
    const toggle = panelEls.toggle instanceof HTMLInputElement ? panelEls.toggle : null;

    function setAutocorrectEnabled(enabled) {
      panelEls.panel.classList.toggle("is-off", !enabled);
      panelEls.state.textContent = enabled ? "ON" : "OFF";
      if (toggle) toggle.checked = enabled;
    }

    if (toggle) {
      toggle.addEventListener("change", () => {
        setAutocorrectEnabled(Boolean(toggle.checked));
      });
    }

    setAutocorrectEnabled(true);
  }

  function setupShortcutsTool(formEls) {
    /** @type {{key: string, value: string}[]} */
    const shortcuts = [{ key: "brb", value: "be right back" }];

    function render() {
      formEls.body.textContent = "";
      for (const item of shortcuts) {
        const tr = document.createElement("tr");
        const tdKey = document.createElement("td");
        const code = document.createElement("code");
        code.textContent = item.key;
        tdKey.appendChild(code);
        const tdVal = document.createElement("td");
        tdVal.textContent = item.value;
        tr.appendChild(tdKey);
        tr.appendChild(tdVal);
        formEls.body.appendChild(tr);
      }
    }

    function setMessage(text) {
      formEls.msg.textContent = text;
    }

    formEls.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = formEls.key.value.trim();
      const value = formEls.value.value.trim();

      if (!key || !value) {
        setMessage("Enter both a shortcut and an expansion.");
        return;
      }

      const normalizedKey = key.toLowerCase();
      const existing = shortcuts.findIndex((s) => s.key.toLowerCase() === normalizedKey);
      if (existing >= 0) {
        shortcuts[existing] = { key, value };
        setMessage("Updated shortcut.");
      } else {
        shortcuts.push({ key, value });
        setMessage("Added shortcut.");
      }

      formEls.key.value = "";
      formEls.value.value = "";
      formEls.key.focus();
      render();
    });

    render();
    setMessage("Example: brb → be right back");
  }

  async function main() {
    const els = {
      generatedAt: document.getElementById("generatedAt"),
      rangePill: document.getElementById("rangePill"),
      summarySub: document.getElementById("summarySub"),
      summaryCards: document.getElementById("summaryCards"),
      chartFallback: document.getElementById("chartFallback"),
      keyFreqBody: document.getElementById("keyFreqBody"),
      productivity: document.getElementById("productivity"),
      wpmChart: document.getElementById("wpmChart"),
      keystrokesChart: document.getElementById("keystrokesChart"),
      activityChart: document.getElementById("activityChart"),
      autocorrectPanel: document.getElementById("autocorrectPanel"),
      autocorrectToggle: document.getElementById("autocorrectToggle"),
      autocorrectState: document.getElementById("autocorrectState"),
      acExamples: document.getElementById("acExamples"),
      shortcutForm: document.getElementById("shortcutForm"),
      shortcutKey: document.getElementById("shortcutKey"),
      shortcutValue: document.getElementById("shortcutValue"),
      shortcutMsg: document.getElementById("shortcutMsg"),
      shortcutsBody: document.getElementById("shortcutsBody"),
    };

    if (!els.summaryCards || !els.keyFreqBody || !els.productivity) return;

    const mockApi = window.TSMockData;
    const seed = mockApi && typeof mockApi.seedFromDay === "function"
      ? mockApi.seedFromDay(Date.now())
      : Date.now();

    const history = mockApi && typeof mockApi.generateDailyHistory === "function"
      ? mockApi.generateDailyHistory({ seed, days: HISTORY_DAYS, wpmMin: 30, wpmMax: 120, errorRateMax: 0.15 })
      : generateMockHistory({ seed, days: HISTORY_DAYS });

    const summary = mockApi && typeof mockApi.summarizeDailyHistory === "function"
      ? mockApi.summarizeDailyHistory(history.dailyOldestFirst)
      : computeSummary(history);

    if (els.generatedAt) {
      els.generatedAt.textContent = `Generated: ${new Date(history.generatedAtMs).toLocaleString()}`;
    }
    if (els.rangePill) {
      els.rangePill.textContent = `Range: ${history.days} days`;
    }
    if (els.summarySub) {
      els.summarySub.textContent = `Last ${history.days} days`;
    }

    renderSummaryCards(els.summaryCards, summary);

    // Key frequency A–Z
    if (mockApi && typeof mockApi.aggregateKeyFrequency === "function") {
      const letters = mockApi.aggregateKeyFrequency(history.dailyOldestFirst);
      renderKeyFrequencyTable(els.keyFreqBody, letters);
    } else {
      // Fallback: synthesize counts from today's typing volume.
      const rng = history.rng || createRng(seed);
      const totalLetters = Math.round(history.today.typedChars * randRange(rng, 0.72, 0.86));
      const letters = makeLetterCounts(rng, totalLetters);
      renderKeyFrequencyTable(els.keyFreqBody, letters);
    }

    // Productivity
    renderProductivity(els.productivity, history.today);

    // Charts
    const canvases = {
      wpm: els.wpmChart instanceof HTMLCanvasElement ? els.wpmChart : null,
      keystrokes: els.keystrokesChart instanceof HTMLCanvasElement ? els.keystrokesChart : null,
      activity: els.activityChart instanceof HTMLCanvasElement ? els.activityChart : null,
    };

    if (els.chartFallback) els.chartFallback.hidden = true;
    const chartReady = await ensureChartJs();
    if (!chartReady) {
      if (els.chartFallback) els.chartFallback.hidden = false;
    } else {
      renderCharts(history, canvases, els.chartFallback);
    }

    // Auto-correct UI
    if (els.autocorrectPanel && els.autocorrectToggle && els.autocorrectState && els.acExamples) {
      renderAutocorrect({
        panel: els.autocorrectPanel,
        toggle: els.autocorrectToggle,
        state: els.autocorrectState,
        examples: els.acExamples,
      });
    }

    // Shortcuts tool
    if (
      els.shortcutForm instanceof HTMLFormElement &&
      els.shortcutKey instanceof HTMLInputElement &&
      els.shortcutValue instanceof HTMLInputElement &&
      els.shortcutMsg &&
      els.shortcutsBody
    ) {
      setupShortcutsTool({
        form: els.shortcutForm,
        key: els.shortcutKey,
        value: els.shortcutValue,
        msg: els.shortcutMsg,
        body: els.shortcutsBody,
      });
    }
  }

  function start() {
    main().catch(() => {
      const fallback = document.getElementById("chartFallback");
      if (fallback) fallback.hidden = false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/**
 * Shared mock data generator for frontend-only typing analytics demos.
 * - Pure JS (no extension APIs)
 * - Smooth updates (bounded random walk + exponential smoothing)
 * - Reusable across popup + options
 */

(function (root, factory) {
  // UMD-style export: CommonJS (tests) or browser global.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TSMockData = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MS_PER_MIN = 60000;

  var DEFAULT_SITES = [
    "docs.google.com",
    "notion.so",
    "github.com",
    "stackoverflow.com",
    "mail.google.com",
    "developer.mozilla.org",
    "news.ycombinator.com",
    "wikipedia.org",
    "reddit.com",
    "medium.com",
    "example.com",
  ];

  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  // Approximate English letter frequencies (percent-ish weights).
  var BASE_LETTER_WEIGHTS = [
    8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4,
    6.7, 7.5, 1.9, 0.095, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074,
  ];

  function clampNumber(value, min, max, fallback) {
    var n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function createRng(seed) {
    // Mulberry32
    var t = (seed >>> 0) || 1;
    return function rng() {
      t += 0x6d2b79f5;
      var x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randRange(rng, min, max) {
    return min + (max - min) * rng();
  }

  function pick(rng, items) {
    return items[Math.floor(rng() * items.length)];
  }

  function smoothToward(current, target, dtMs, tauMs) {
    var dt = clampNumber(dtMs, 0, 60000, 0);
    var tau = Math.max(1, Number(tauMs) || 1);
    var alpha = 1 - Math.exp(-dt / tau);
    return current + (target - current) * alpha;
  }

  function boundedWalk(rng, value, min, max, maxDelta) {
    var next = value + randRange(rng, -maxDelta, maxDelta);
    return clampNumber(next, min, max, value);
  }

  function pad2(num) {
    return String(num).padStart(2, "0");
  }

  function getLocalDateKey(dateMs) {
    var d = new Date(dateMs);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fnv1a32(str) {
    var s = typeof str === "string" ? str : String(str);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seedFromString(input, fallbackSeed) {
    var s = typeof input === "string" ? input : String(input);
    if (!s) {
      return clampNumber(fallbackSeed, 1, 2 ** 31 - 1, Date.now());
    }

    // Map hash to 1..2147483646 to keep it within signed 32-bit positive range and non-zero.
    var h = fnv1a32(s);
    return (h % 2147483646) + 1;
  }

  function seedFromDay(dateMs, salt) {
    var t = typeof dateMs === "number" ? dateMs : Date.now();
    var key = getLocalDateKey(t);
    var suffix = typeof salt === "string" && salt ? ":" + salt : "";
    return seedFromString(key + suffix, t);
  }

  function addDaysLocalMidnight(dateMs, deltaDays) {
    var d = new Date(dateMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + deltaDays);
    return d.getTime();
  }

  function poisson(rng, lambda) {
    // Knuth's method. Fast enough for small lambdas (< ~25) which we enforce.
    var l = Math.max(0, Number(lambda) || 0);
    if (l <= 0) return 0;

    var L = Math.exp(-l);
    var k = 0;
    var p = 1;

    do {
      k++;
      p *= rng();
    } while (p > L && k < 1000);

    return Math.max(0, k - 1);
  }

  function createKeyModel(rng) {
    var weights = BASE_LETTER_WEIGHTS.map(function (w) {
      return w * randRange(rng, 0.92, 1.08);
    });
    var sum = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (!sum) sum = 1;

    var cdf = [];
    var acc = 0;
    for (var i = 0; i < weights.length; i++) {
      acc += weights[i] / sum;
      cdf[i] = acc;
    }
    cdf[cdf.length - 1] = 1;

    // Small jitter around realistic ratios.
    var spaceProb = clampNumber(randRange(rng, 0.145, 0.18), 0.05, 0.35, 0.16);
    var enterProb = clampNumber(randRange(rng, 0.007, 0.018), 0, 0.05, 0.012);
    var punctProb = clampNumber(randRange(rng, 0.012, 0.032), 0, 0.08, 0.02);

    // Ensure letters remain dominant.
    var totalSpecial = spaceProb + enterProb + punctProb;
    if (totalSpecial > 0.28) {
      var scale = 0.28 / totalSpecial;
      spaceProb *= scale;
      enterProb *= scale;
      punctProb *= scale;
    }

    var punctuation = [".", ",", "'", "-", ";", ":"];

    return Object.freeze({
      letterWeights: weights,
      letterCdf: cdf,
      spaceProb: spaceProb,
      enterProb: enterProb,
      punctProb: punctProb,
      punctuation: punctuation,
    });
  }

  function sampleLetter(rng, keyModel) {
    var u = rng();
    var cdf = keyModel.letterCdf;
    for (var i = 0; i < cdf.length; i++) {
      if (u <= cdf[i]) return ALPHABET[i];
    }
    return "E";
  }

  function inc(freq, key, amount) {
    var n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n) return;
    freq[key] = (freq[key] || 0) + n;
  }

  function makeKeyFrequencyFromTotals(rng, keyModel, typedKeys, backspaces) {
    var typed = Math.max(0, Math.round(Number(typedKeys) || 0));

    // Day-to-day slight variation so tables don't look copy/pasted.
    var space = Math.round(typed * keyModel.spaceProb * randRange(rng, 0.96, 1.04));
    var enter = Math.round(typed * keyModel.enterProb * randRange(rng, 0.9, 1.1));
    var punct = Math.round(typed * keyModel.punctProb * randRange(rng, 0.9, 1.1));

    var remaining = typed - space - enter - punct;
    if (remaining < 0) {
      remaining = 0;
      space = Math.min(space, typed);
      enter = Math.min(enter, Math.max(0, typed - space));
      punct = Math.min(punct, Math.max(0, typed - space - enter));
    }

    var weights = keyModel.letterWeights;
    var sum = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (!sum) sum = 1;

    var freq = Object.create(null);

    var allocated = 0;
    for (var i = 0; i < ALPHABET.length; i++) {
      var base = (remaining * weights[i]) / sum;
      var jitter = randRange(rng, 0.95, 1.05);
      var count = Math.max(0, Math.round(base * jitter));
      allocated += count;
      freq[ALPHABET[i]] = count;
    }

    // Fix rounding drift by adjusting the most common letter.
    var drift = remaining - allocated;
    freq.E = Math.max(0, (freq.E || 0) + drift);

    if (space) freq.Space = space;
    if (enter) freq.Enter = enter;

    if (punct) {
      // Split punctuation roughly evenly.
      var per = Math.max(1, Math.floor(punct / keyModel.punctuation.length));
      var leftover = punct;
      for (var p = 0; p < keyModel.punctuation.length; p++) {
        var take = p === keyModel.punctuation.length - 1 ? leftover : Math.min(leftover, per);
        leftover -= take;
        if (take > 0) freq[keyModel.punctuation[p]] = take;
      }
    }

    var backs = Math.max(0, Math.round(Number(backspaces) || 0));
    if (backs) freq.Backspace = backs;

    return freq;
  }

  function summarizeDailyHistory(dailyOldestFirst) {
    var daily = Array.isArray(dailyOldestFirst) ? dailyOldestFirst : [];

    var totalTypedChars = 0;
    var totalBackspaces = 0;
    var totalWritingMs = 0;
    var totalBrowsingMs = 0;
    var totalIdleMs = 0;

    for (var i = 0; i < daily.length; i++) {
      var d = daily[i] || {};
      totalTypedChars += Number(d.typedChars) || 0;
      totalBackspaces += Number(d.backspaces) || 0;
      totalWritingMs += Number(d.writingMs) || 0;
      totalBrowsingMs += Number(d.browsingMs) || 0;
      totalIdleMs += Number(d.idleMs) || 0;
    }

    var totalKeystrokes = totalTypedChars + totalBackspaces;
    var totalWritingMinutes = totalWritingMs / MS_PER_MIN;
    var totalWords = totalTypedChars / 5;

    var avgWpm = totalWritingMinutes > 0 ? totalWords / totalWritingMinutes : 0;
    var errorRate = totalBackspaces / Math.max(totalKeystrokes, 1);

    var activeMs = totalWritingMs + totalBrowsingMs;
    var activePct = activeMs / Math.max(activeMs + totalIdleMs, 1);

    return {
      days: daily.length,
      avgWpm: avgWpm,
      totalKeystrokes: totalKeystrokes,
      errorRate: errorRate,
      activePct: activePct,
    };
  }

  function aggregateKeyFrequency(dailyOldestFirst) {
    var daily = Array.isArray(dailyOldestFirst) ? dailyOldestFirst : [];
    var out = Object.create(null);

    for (var i = 0; i < daily.length; i++) {
      var kf = daily[i] && daily[i].keyFreq;
      if (!kf || typeof kf !== "object") continue;
      var keys = Object.keys(kf);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        out[key] = (out[key] || 0) + (Number(kf[key]) || 0);
      }
    }

    return out;
  }

  function generateDailyHistory(options) {
    var opts = options || {};
    var seed = clampNumber(opts.seed, 1, 2 ** 31 - 1, Date.now());
    var days = Math.round(clampNumber(opts.days, 1, 60, 7));

    var wpmMin = clampNumber(opts.wpmMin, 10, 200, 30);
    var wpmMax = clampNumber(opts.wpmMax, wpmMin, 240, 120);
    var errorRateMax = clampNumber(opts.errorRateMax, 0.01, 0.25, 0.15);

    var rng = createRng(seed);
    var keyModel = createKeyModel(rng);

    var todayMidnight = (function () {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    var baselineWpm = randRange(rng, Math.max(wpmMin, 45), Math.min(wpmMax, 90));
    var baselineError = randRange(rng, 0.02, Math.min(errorRateMax, 0.11));

    // Smooth day-to-day time buckets to avoid unrealistic spikes.
    var writingMinBase = randRange(rng, 40, 120);
    var browsingMinBase = randRange(rng, 60, 210);
    var idleMinBase = randRange(rng, 30, 170);

    var dailyOldestFirst = [];

    for (var i = days - 1; i >= 0; i--) {
      var dayMs = addDaysLocalMidnight(todayMidnight, -i);
      var dateKey = getLocalDateKey(dayMs);

      baselineWpm = boundedWalk(rng, baselineWpm, wpmMin, wpmMax, 4.2);
      baselineError = boundedWalk(rng, baselineError, 0, errorRateMax, 0.01);

      writingMinBase = boundedWalk(rng, writingMinBase, 15, 180, 18);
      browsingMinBase = boundedWalk(rng, browsingMinBase, 20, 300, 26);
      idleMinBase = boundedWalk(rng, idleMinBase, 10, 240, 22);

      var writingMin = Math.round(writingMinBase);
      var browsingMin = Math.round(browsingMinBase);
      var idleMin = Math.round(idleMinBase);

      var noise = randRange(rng, 0.92, 1.08);
      var typedChars = Math.max(0, Math.round(baselineWpm * 5 * writingMin * noise));
      var backspaces = Math.max(
        0,
        Math.round((typedChars * baselineError) / Math.max(1 - baselineError, 0.05))
      );

      var keyFreq = makeKeyFrequencyFromTotals(rng, keyModel, typedChars, backspaces);

      dailyOldestFirst.push({
        dateKey: dateKey,
        avgWpm: baselineWpm,
        errorRate: baselineError,
        writingMs: writingMin * MS_PER_MIN,
        browsingMs: browsingMin * MS_PER_MIN,
        idleMs: idleMin * MS_PER_MIN,
        typedChars: typedChars,
        backspaces: backspaces,
        keyFreq: keyFreq,
      });
    }

    return {
      generatedAtMs: Date.now(),
      seed: seed,
      days: days,
      dailyOldestFirst: dailyOldestFirst,
      today: dailyOldestFirst[dailyOldestFirst.length - 1],
    };
  }

  function createTypingSimulator(options) {
    var opts = options || {};

    var seed = clampNumber(opts.seed, 1, 2 ** 31 - 1, Date.now());
    var rng = createRng(seed);

    var wpmMin = clampNumber(opts.wpmMin, 10, 200, 30);
    var wpmMax = clampNumber(opts.wpmMax, wpmMin, 240, 120);
    var errorRateMax = clampNumber(opts.errorRateMax, 0.01, 0.25, 0.15);

    var idleThresholdMs = Math.round(clampNumber(opts.idleThresholdMs, 500, 60000, 5000));

    var sites = Array.isArray(opts.sites) && opts.sites.length ? opts.sites.slice() : DEFAULT_SITES.slice();

    var initialWpm = clampNumber(opts.initialWpm, wpmMin, wpmMax, NaN);
    var hasInitialWpm = Number.isFinite(initialWpm);

    var initialErrorRate = clampNumber(opts.initialErrorRate, 0, errorRateMax, NaN);
    var hasInitialErrorRate = Number.isFinite(initialErrorRate);

    var initialSite = typeof opts.initialSite === "string" ? opts.initialSite : "";

    var now = Date.now();

    var site = initialSite ? initialSite : pick(rng, sites);
    var nextSiteChangeAt = now + randRange(rng, 90000, 240000);

    var typedChars = 0;
    var backspaces = 0;
    var keyFreq = Object.create(null);

    var lastKeyAt = now - randRange(rng, 0, 3500);

    var isTyping = true;
    var segmentUntil = now + randRange(rng, 10000, 45000);

    var wpmTarget = hasInitialWpm
      ? initialWpm
      : randRange(rng, Math.max(wpmMin, 40), Math.min(wpmMax, 95));
    var wpmCurrent = hasInitialWpm
      ? wpmTarget
      : clampNumber(wpmTarget + randRange(rng, -4, 4), wpmMin, wpmMax, wpmTarget);
    var wpmDisplay = wpmCurrent;
    var wpmTargetUntil = now + randRange(rng, 8000, 25000);

    var errTarget = hasInitialErrorRate
      ? initialErrorRate
      : randRange(rng, 0.02, Math.min(errorRateMax, 0.1));
    var errCurrent = hasInitialErrorRate
      ? errTarget
      : clampNumber(errTarget + randRange(rng, -0.01, 0.01), 0, errorRateMax, errTarget);
    var errTargetUntil = now + randRange(rng, 15000, 45000);

    var keyModel = createKeyModel(rng);

    function maybeChangeSite(nowMs) {
      if (nowMs < nextSiteChangeAt) return;
      if (sites.length === 1) {
        nextSiteChangeAt = nowMs + randRange(rng, 90000, 240000);
        return;
      }

      var next = pick(rng, sites);
      if (next === site) next = pick(rng, sites);
      site = next;
      nextSiteChangeAt = nowMs + randRange(rng, 90000, 240000);
    }

    function maybeSwitchSegment(nowMs) {
      if (nowMs < segmentUntil) return;
      isTyping = !isTyping;
      if (isTyping) {
        segmentUntil = nowMs + randRange(rng, 12000, 52000);
        wpmTarget = clampNumber(wpmCurrent + randRange(rng, -6, 10), wpmMin, wpmMax, wpmTarget);
      } else {
        segmentUntil = nowMs + randRange(rng, 5000, 18000);
      }
    }

    function maybeUpdateTargets(nowMs) {
      if (nowMs >= wpmTargetUntil) {
        wpmTarget = boundedWalk(rng, wpmTarget, wpmMin, wpmMax, 7);
        wpmTargetUntil = nowMs + randRange(rng, 9000, 26000);
      }

      if (nowMs >= errTargetUntil) {
        errTarget = boundedWalk(rng, errTarget, 0, errorRateMax, 0.015);
        errTargetUntil = nowMs + randRange(rng, 18000, 52000);
      }
    }

    function applyTyping(typedCount, backCount) {
      if (typedCount > 0) {
        for (var i = 0; i < typedCount; i++) {
          var u = rng();
          if (u < keyModel.spaceProb) {
            inc(keyFreq, "Space", 1);
          } else if (u < keyModel.spaceProb + keyModel.enterProb) {
            inc(keyFreq, "Enter", 1);
          } else if (u < keyModel.spaceProb + keyModel.enterProb + keyModel.punctProb) {
            inc(keyFreq, pick(rng, keyModel.punctuation), 1);
          } else {
            inc(keyFreq, sampleLetter(rng, keyModel), 1);
          }
        }
      }
      if (backCount > 0) {
        inc(keyFreq, "Backspace", backCount);
      }
    }

    function tick(nowMs, dtMs, enabled) {
      var dt = clampNumber(dtMs, 0, 2000, 0);
      if (enabled === false) return;

      maybeChangeSite(nowMs);
      maybeSwitchSegment(nowMs);
      maybeUpdateTargets(nowMs);

      // Smoothly follow targets with mild noise.
      wpmCurrent = smoothToward(wpmCurrent, wpmTarget, dt, 6500);
      wpmCurrent += randRange(rng, -0.35, 0.35) * (dt / 1000);
      wpmCurrent = clampNumber(wpmCurrent, wpmMin, wpmMax, wpmCurrent);

      errCurrent = smoothToward(errCurrent, errTarget, dt, 18000);
      errCurrent = clampNumber(errCurrent, 0, errorRateMax, errCurrent);

      // Display WPM eases down during short pauses (pre-idle threshold).
      var desiredDisplay = isTyping ? wpmCurrent : 0;
      wpmDisplay = smoothToward(wpmDisplay, desiredDisplay, dt, isTyping ? 3200 : 2000);

      if (!isTyping) return;

      // Generate keystrokes based on current WPM.
      var expectedTyped = (wpmCurrent * 5) * (dt / MS_PER_MIN);
      expectedTyped = clampNumber(expectedTyped, 0, 25, 0);

      var expectedBack = expectedTyped * (errCurrent / Math.max(1 - errCurrent, 0.05));
      expectedBack = clampNumber(expectedBack, 0, 10, 0);

      var typedThisTick = poisson(rng, expectedTyped);
      var backThisTick = poisson(rng, expectedBack);

      if (typedThisTick || backThisTick) {
        lastKeyAt = nowMs;
      }

      typedChars += typedThisTick;
      backspaces += backThisTick;

      applyTyping(typedThisTick, backThisTick);
    }

    function reset(nowMs) {
      var t = typeof nowMs === "number" ? nowMs : Date.now();
      typedChars = 0;
      backspaces = 0;
      keyFreq = Object.create(null);
      lastKeyAt = t - idleThresholdMs - 50;

      // Keep current site unless an explicit initial site was provided.
      if (initialSite) {
        site = initialSite;
      }
      nextSiteChangeAt = t + randRange(rng, 90000, 240000);

      isTyping = true;
      segmentUntil = t + randRange(rng, 10000, 45000);

      wpmTarget = hasInitialWpm
        ? initialWpm
        : randRange(rng, Math.max(wpmMin, 40), Math.min(wpmMax, 95));
      wpmCurrent = hasInitialWpm
        ? wpmTarget
        : clampNumber(wpmTarget + randRange(rng, -4, 4), wpmMin, wpmMax, wpmTarget);
      wpmDisplay = wpmCurrent;
      wpmTargetUntil = t + randRange(rng, 8000, 25000);

      errTarget = hasInitialErrorRate
        ? initialErrorRate
        : randRange(rng, 0.02, Math.min(errorRateMax, 0.1));
      errCurrent = hasInitialErrorRate
        ? errTarget
        : clampNumber(errTarget + randRange(rng, -0.01, 0.01), 0, errorRateMax, errTarget);
      errTargetUntil = t + randRange(rng, 15000, 45000);
    }

    function getSnapshot(nowMs) {
      var t = typeof nowMs === "number" ? nowMs : Date.now();
      var keystrokes = typedChars + backspaces;
      var backspaceRatio = backspaces / Math.max(keystrokes, 1);
      var isIdle = t - lastKeyAt >= idleThresholdMs;

      return {
        site: site,
        isIdle: isIdle,
        wpm: isIdle ? 0 : wpmDisplay,
        // Smoothed estimate stays in-bounds and avoids early-session spikes.
        errorRate: errCurrent,
        backspaceRatio: backspaceRatio,
        keystrokes: keystrokes,
        typedChars: typedChars,
        backspaces: backspaces,
      };
    }

    function getKeyFrequency() {
      // Defensive copy (callers should treat as read-only).
      return Object.assign(Object.create(null), keyFreq);
    }

    return Object.freeze({
      tick: tick,
      reset: reset,
      getSnapshot: getSnapshot,
      getKeyFrequency: getKeyFrequency,
      idleThresholdMs: idleThresholdMs,
    });
  }

  return Object.freeze({
    clampNumber: clampNumber,
    createRng: createRng,
    seedFromString: seedFromString,
    seedFromDay: seedFromDay,
    createTypingSimulator: createTypingSimulator,
    generateDailyHistory: generateDailyHistory,
    summarizeDailyHistory: summarizeDailyHistory,
    aggregateKeyFrequency: aggregateKeyFrequency,
    makeKeyFrequencyFromTotals: makeKeyFrequencyFromTotals,
  });
});

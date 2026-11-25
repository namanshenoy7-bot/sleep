// Pure sleep logic: no DOM access, so it can be tested on its own.
// Times are stored as epoch milliseconds; "minutes" means minutes since local midnight.
(function (root) {
  'use strict';

  const DAY_MIN = 1440;
  const DEBT_WINDOW = 14; // nights considered for sleep debt
  const MIN_MAIN_SLEEP_H = 3; // shorter entries count as naps for wake-time estimates

  const mod = (n, m) => ((n % m) + m) % m;

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function minutesOfDay(ms) {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  }

  function formatClock(min) {
    const m = mod(Math.round(min), DAY_MIN);
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    const suffix = h < 12 ? 'AM' : 'PM';
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${suffix}`;
  }

  function formatDuration(hours) {
    const total = Math.round(Math.abs(hours) * 60);
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
  }

  // Build an entry from form values. The bedtime is placed on the previous day
  // when it is at or after the wake time (e.g. 23:00 -> 07:00).
  function buildEntry(wakeDate, bedTime, wakeTime) {
    const [y, mo, d] = wakeDate.split('-').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    const [bh, bm] = bedTime.split(':').map(Number);
    const wake = new Date(y, mo - 1, d, wh, wm);
    let bed = new Date(y, mo - 1, d, bh, bm);
    if (bed >= wake) bed = new Date(y, mo - 1, d - 1, bh, bm);
    return { bed: bed.getTime(), wake: wake.getTime() };
  }

  const durationH = (e) => (e.wake - e.bed) / 3.6e6;

  function validateEntry(entry, existing, ignoreId) {
    const h = durationH(entry);
    if (!(h > 0)) return 'Wake time must be after bedtime.';
    if (h > 16) return 'That is over 16 hours. Check the times.';
    if (entry.wake > Date.now() + 5 * 60 * 1000) return 'Wake time is in the future.';
    const clash = existing.find(
      (o) => o.id !== ignoreId && entry.bed < o.wake && o.bed < entry.wake
    );
    if (clash) return 'This overlaps a sleep you already logged.';
    return null;
  }

  // Hours slept per day (keyed by wake date). Index 0 = today, 13 = 13 days ago.
  // null means nothing was logged that day.
  function sleepByDay(entries, today = new Date()) {
    const totals = new Map();
    for (const e of entries) {
      const k = dateKey(new Date(e.wake));
      totals.set(k, (totals.get(k) || 0) + durationH(e));
    }
    const out = [];
    for (let i = 0; i < DEBT_WINDOW; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      out.push({ key: dateKey(d), date: d, hours: totals.has(dateKey(d)) ? totals.get(dateKey(d)) : null });
    }
    return out;
  }

  // Weighted 14-night sleep debt. Weights fall linearly from recent to old and
  // average 1, so being 1h short every night for 14 nights = 14h of debt.
  // Extra sleep on a night pays down debt. Unlogged nights are skipped.
  function sleepDebt(entries, needH, today = new Date()) {
    const days = sleepByDay(entries, today);
    let debt = 0;
    let logged = 0;
    days.forEach((d, i) => {
      if (d.hours == null) return;
      logged++;
      const weight = (2 * (DEBT_WINDOW - i)) / (DEBT_WINDOW + 1);
      debt += weight * (needH - d.hours);
    });
    const hours = Math.max(0, debt);
    return { hours, nightsLogged: logged, level: debtLevel(hours) };
  }

  function debtLevel(h) {
    if (h < 5) return 'low';
    if (h < 10) return 'moderate';
    return 'high';
  }

  function circularMean(mins) {
    let s = 0, c = 0;
    for (const m of mins) {
      const a = (m / DAY_MIN) * 2 * Math.PI;
      s += Math.sin(a);
      c += Math.cos(a);
    }
    return mod((Math.atan2(s, c) / (2 * Math.PI)) * DAY_MIN, DAY_MIN);
  }

  function circularSd(mins, mean) {
    if (mins.length < 2) return 0;
    const sq = mins.map((m) => (mod(m - mean + DAY_MIN / 2, DAY_MIN) - DAY_MIN / 2) ** 2);
    return Math.sqrt(sq.reduce((a, b) => a + b, 0) / mins.length);
  }

  function recentMainSleeps(entries, n = DEBT_WINDOW) {
    return entries
      .filter((e) => durationH(e) >= MIN_MAIN_SLEEP_H)
      .sort((a, b) => b.wake - a.wake)
      .slice(0, n);
  }

  // Typical wake time from recent main sleeps (circular mean handles midnight).
  function typicalWake(entries, fallbackMin = 7 * 60) {
    const recent = recentMainSleeps(entries);
    if (recent.length === 0) return fallbackMin;
    const mean = circularMean(recent.map((e) => minutesOfDay(e.wake)));
    return mod(Math.round(mean / 5) * 5, DAY_MIN); // nearest 5 min reads better
  }

  function stats(entries) {
    const recent = recentMainSleeps(entries);
    if (recent.length === 0) return null;
    const beds = recent.map((e) => minutesOfDay(e.bed));
    const wakes = recent.map((e) => minutesOfDay(e.wake));
    const bedMean = circularMean(beds);
    const wakeMean = circularMean(wakes);
    return {
      count: recent.length,
      avgDurationH: recent.reduce((a, e) => a + durationH(e), 0) / recent.length,
      avgBed: bedMean,
      avgWake: wakeMean,
      bedSdMin: circularSd(beds, bedMean),
      wakeSdMin: circularSd(wakes, wakeMean),
    };
  }

  // Circadian energy schedule. Phase offsets are minutes after waking, based on
  // common chronobiology rules of thumb. It is an estimate, not a measurement.
  function energySchedule(wakeMin, needH, debtH) {
    const day = Math.round((24 - needH) * 60); // waking-day length
    const payback = debtH > 0 ? Math.min(60, Math.round((debtH * 60) / 7 / 15) * 15) : 0;
    const bedOff = day - payback; // go to bed earlier to repay debt over ~a week
    const melStart = bedOff - 120;
    const phases = [
      { key: 'groggy', label: 'Grogginess', hint: 'Sleep inertia. Get daylight, hold off on hard tasks.', start: 0, end: 90 },
      { key: 'morning', label: 'Morning peak', hint: 'Best window for focused, demanding work.', start: 120, end: 300 },
      { key: 'dip', label: 'Afternoon dip', hint: 'Energy drops. Good for a short nap or easy tasks.', start: 390, end: 540 },
      { key: 'evening', label: 'Evening peak', hint: 'Second wind. Good for exercise or social time.', start: 600, end: Math.min(750, melStart) },
      { key: 'melatonin', label: 'Melatonin window', hint: 'Your body starts making melatonin. Easiest time to fall asleep.', start: melStart, end: melStart + 60 },
      { key: 'winddown', label: 'Wind down', hint: 'Dim lights, put screens away, no caffeine or big meals.', start: melStart + 60, end: bedOff },
    ];
    for (const p of phases) {
      p.startMin = mod(wakeMin + p.start, DAY_MIN);
      p.endMin = mod(wakeMin + p.end, DAY_MIN);
    }

    // Curve control points; x must stay increasing even with a short waking day.
    const eveTop = Math.min(690, melStart - 30);
    const pts = [
      [0, 0.2], [90, 0.55], [210, 0.9], [330, 0.8], [465, 0.45],
      [Math.min(600, eveTop - 30), 0.7], [eveTop, 0.85], [melStart, 0.55], [bedOff, 0.15],
    ];
    const factor = 1 - Math.min(debtH, 20) / 50; // debt flattens the curve (up to -40%)
    function energyAt(off) {
      if (off <= 0) return pts[0][1] * factor;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        if (off <= x1) {
          const t = (off - x0) / (x1 - x0);
          return (y0 + (y1 - y0) * (1 - Math.cos(Math.PI * t)) / 2) * factor;
        }
      }
      return pts[pts.length - 1][1] * factor;
    }

    return {
      wakeMin,
      dayLength: bedOff,
      bedtimeMin: mod(wakeMin + bedOff, DAY_MIN),
      naturalBedtimeMin: mod(wakeMin + day, DAY_MIN),
      paybackMin: payback,
      phases,
      energyAt,
    };
  }

  // Which phase "now" is in. Returns { offset, phase } where phase may be null
  // (between phases) or the string 'sleep' outside the waking day.
  function currentPhase(schedule, nowMin) {
    const offset = mod(nowMin - schedule.wakeMin, DAY_MIN);
    if (offset >= schedule.dayLength) return { offset, phase: 'sleep' };
    const phase = schedule.phases.find((p) => offset >= p.start && offset < p.end) || null;
    return { offset, phase };
  }

  root.SleepCore = {
    DEBT_WINDOW, dateKey, minutesOfDay, formatClock, formatDuration, buildEntry,
    durationH, validateEntry, sleepByDay, sleepDebt, debtLevel, typicalWake,
    stats, energySchedule, currentPhase, circularMean,
  };
})(typeof window !== 'undefined' ? window : globalThis);

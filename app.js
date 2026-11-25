(function () {
  'use strict';
  const C = window.SleepCore;
  const STORE_KEY = 'sleep-tracker:v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PHASE_COLORS = {
    groggy: '#6b7280', morning: '#8b7bff', dip: '#f59e0b',
    evening: '#22d3ee', melatonin: '#c084fc', winddown: '#475569',
  };

  const $ = (id) => document.getElementById(id);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- state ----------
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && Array.isArray(raw.entries)) return sanitize(raw);
    } catch (_) { /* fall through to defaults */ }
    return { entries: [], settings: { needH: 8 }, pendingBed: null };
  }

  // Keep only well-formed data (also used for imports).
  function sanitize(raw) {
    const entries = (raw.entries || [])
      .filter((e) => e && Number.isFinite(e.bed) && Number.isFinite(e.wake) && e.wake > e.bed)
      .map((e) => ({ id: String(e.id || newId()), bed: e.bed, wake: e.wake }));
    const need = Number(raw.settings && raw.settings.needH);
    return {
      entries,
      settings: { needH: need >= 5 && need <= 10 ? need : 8 },
      pendingBed: Number.isFinite(raw.pendingBed) ? raw.pendingBed : null,
    };
  }

  let state = load();
  let editingId = null;
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  // ---------- helpers ----------
  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }
  // Draw charts in real pixels so labels stay readable on a narrow phone screen.
  function sizeChart(svg) {
    const W = Math.round(svg.getBoundingClientRect().width) || 640;
    const H = W < 500 ? 170 : 200;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    return { W, H };
  }
  const nowMin = () => C.minutesOfDay(Date.now());
  const dayLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = (ms) => C.formatClock(C.minutesOfDay(ms));

  // ---------- render ----------
  function render() {
    const need = state.settings.needH;
    const debt = C.sleepDebt(state.entries, need);
    const wake = C.typicalWake(state.entries);
    const sched = C.energySchedule(wake, need, debt.hours);

    $('clock').textContent = C.formatClock(nowMin());

    // Debt card
    $('debtValue').textContent = debt.nightsLogged ? C.formatDuration(debt.hours) : '--';
    const badge = $('debtBadge');
    badge.className = 'badge ' + (debt.nightsLogged ? debt.level : '');
    badge.textContent = debt.nightsLogged ? debt.level[0].toUpperCase() + debt.level.slice(1) : '';
    $('debtNote').textContent = debt.nightsLogged
      ? `Based on ${debt.nightsLogged} of the last 14 days. Aim to stay under 5h.`
      : 'Log a few nights to see your debt.';

    // Last sleep card
    const last = [...state.entries].sort((a, b) => b.wake - a.wake)[0];
    if (last) {
      const h = C.durationH(last);
      $('lastValue').textContent = C.formatDuration(h);
      const diff = h - need;
      $('lastNote').textContent = `${timeLabel(last.bed)} to ${timeLabel(last.wake)}, ` +
        (Math.abs(diff) < 1 / 60 ? 'right on your need' : `${C.formatDuration(diff)} ${diff < 0 ? 'short' : 'over'}`);
    } else {
      $('lastValue').textContent = '--';
      $('lastNote').textContent = 'No sleep logged yet.';
    }

    // Bedtime card
    $('bedValue').textContent = C.formatClock(sched.bedtimeMin);
    $('bedNote').textContent = sched.paybackMin
      ? `${sched.paybackMin} min earlier than usual to pay down debt over about a week.`
      : `Gives you ${C.formatDuration(need)} before your usual ${C.formatClock(wake)} wake-up.`;

    renderNow(sched);
    renderEnergy(sched);
    renderHistoryChart(need);
    renderStats();
    renderHistoryList();
    $('wakeUsed').textContent = C.formatClock(wake);
  }

  function renderNow(sched) {
    const btn = $('sleepToggle');
    if (state.pendingBed) {
      const h = (Date.now() - state.pendingBed) / 3.6e6;
      $('phaseNow').textContent = 'Sleeping';
      $('phaseHint').textContent = `Since ${timeLabel(state.pendingBed)} (${C.formatDuration(h)})`;
      btn.textContent = "I'm awake";
      return;
    }
    btn.textContent = 'Going to bed';
    const { phase } = C.currentPhase(sched, nowMin());
    if (phase === 'sleep') {
      $('phaseNow').textContent = 'Sleep time';
      $('phaseHint').textContent = 'You are past your bedtime window.';
    } else if (phase) {
      $('phaseNow').textContent = phase.label;
      $('phaseHint').textContent = phase.hint;
    } else {
      const next = sched.phases.find((p) => p.start > C.currentPhase(sched, nowMin()).offset);
      $('phaseNow').textContent = 'Steady energy';
      $('phaseHint').textContent = next ? `Next: ${next.label} at ${C.formatClock(next.startMin)}` : '';
    }
  }

  function renderEnergy(sched) {
    const svg = $('energyChart');
    svg.replaceChildren();
    const { W, H } = sizeChart(svg);
    const pad = { l: 10, r: 10, t: 10, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = (off) => pad.l + (off / sched.dayLength) * iw;
    const y = (v) => pad.t + (1 - v) * ih;
    const { offset, phase } = C.currentPhase(sched, nowMin());

    for (const p of sched.phases) {
      svg.appendChild(svgEl('rect', {
        x: x(p.start), y: pad.t, width: Math.max(0, x(p.end) - x(p.start)), height: ih,
        fill: PHASE_COLORS[p.key], opacity: phase && phase.key === p.key ? 0.35 : 0.15, rx: 4,
      }));
    }

    let d = '';
    for (let off = 0; off <= sched.dayLength; off += 5) {
      d += (off ? 'L' : 'M') + x(off).toFixed(1) + ' ' + y(sched.energyAt(off)).toFixed(1);
    }
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: '#ecebff', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));

    const tickStep = W < 500 ? 240 : 180; // fewer labels on a phone
    for (let off = 0; off <= sched.dayLength; off += tickStep) {
      const anchor = off === 0 ? 'start' : x(off) > W - pad.r - 40 ? 'end' : 'middle';
      svg.appendChild(svgEl('text', { x: x(off), y: H - 8, 'text-anchor': anchor },
        C.formatClock(sched.wakeMin + off).replace(':00', '')));
    }

    if (!state.pendingBed && phase !== 'sleep') {
      svg.appendChild(svgEl('line', { x1: x(offset), x2: x(offset), y1: pad.t, y2: pad.t + ih, stroke: '#fff', 'stroke-dasharray': '3 3' }));
      svg.appendChild(svgEl('circle', { cx: x(offset), cy: y(sched.energyAt(offset)), r: 5, fill: '#fff' }));
    }

    const list = $('phaseList');
    list.replaceChildren();
    for (const p of sched.phases) {
      const li = document.createElement('li');
      if (phase && phase.key === p.key) li.className = 'active';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PHASE_COLORS[p.key];
      const name = document.createElement('span');
      name.textContent = p.label;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = `${C.formatClock(p.startMin)} - ${C.formatClock(p.endMin)}`;
      li.append(dot, name, time);
      li.title = p.hint;
      list.appendChild(li);
    }
  }

  function renderHistoryChart(need) {
    const svg = $('historyChart');
    svg.replaceChildren();
    const days = C.sleepByDay(state.entries).reverse(); // oldest first
    const { W, H } = sizeChart(svg);
    const pad = { l: 28, r: 8, t: 10, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxH = 12;
    const y = (h) => pad.t + (1 - Math.min(h, maxH) / maxH) * ih;
    const slot = iw / days.length;

    for (const h of [0, 4, 8, 12]) {
      svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(h), y2: y(h), stroke: '#2c2850' }));
      svg.appendChild(svgEl('text', { x: pad.l - 6, y: y(h) + 4, 'text-anchor': 'end' }, h + 'h'));
    }
    days.forEach((d, i) => {
      const cx = pad.l + slot * i + slot / 2;
      if (d.hours != null) {
        const color = d.hours >= need ? '#4ade80' : d.hours >= need - 1 ? '#fbbf24' : '#f87171';
        const bar = svgEl('rect', { x: cx - slot * 0.3, y: y(d.hours), width: slot * 0.6, height: y(0) - y(d.hours), fill: color, rx: 3 });
        bar.appendChild(svgEl('title', {}, `${dayLabel(d.date)}: ${C.formatDuration(d.hours)}`));
        svg.appendChild(bar);
      }
      const label = slot >= 28
        ? d.date.toLocaleDateString(undefined, { weekday: 'narrow' }) + d.date.getDate()
        : String(d.date.getDate());
      svg.appendChild(svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, label));
    });
    svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(need), y2: y(need), stroke: '#8b7bff', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
    svg.appendChild(svgEl('text', { x: W - pad.r, y: y(need) - 5, 'text-anchor': 'end', fill: '#8b7bff' }, `need ${need}h`));
  }

  function renderStats() {
    const s = C.stats(state.entries);
    const box = $('stats');
    box.replaceChildren();
    const items = s
      ? [
          ['Avg sleep', C.formatDuration(s.avgDurationH)],
          ['Avg bedtime', C.formatClock(s.avgBed)],
          ['Bedtime consistency', s.count < 2 ? '--' : `±${Math.round(s.bedSdMin)} min`],
        ]
      : [['Avg sleep', '--'], ['Avg bedtime', '--'], ['Bedtime consistency', '--']];
    for (const [label, value] of items) {
      const div = document.createElement('div');
      const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
      const v = document.createElement('div'); v.className = 'big'; v.textContent = value;
      div.append(l, v);
      box.appendChild(div);
    }
  }

  function renderHistoryList() {
    const ul = $('historyList');
    ul.replaceChildren();
    const sorted = [...state.entries].sort((a, b) => b.wake - a.wake).slice(0, 30);
    if (!sorted.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Nothing yet. Use "Going to bed" tonight or log a past sleep above.';
      ul.appendChild(li);
      return;
    }
    for (const e of sorted) {
      const li = document.createElement('li');
      const dur = document.createElement('span'); dur.className = 'dur'; dur.textContent = C.formatDuration(C.durationH(e));
      const when = document.createElement('span'); when.className = 'when';
      const times = document.createElement('span'); times.className = 'times';
      times.textContent = `${timeLabel(e.bed)} to ${timeLabel(e.wake)}`;
      when.append(dayLabel(e.wake), times);
      const edit = document.createElement('button'); edit.textContent = 'Edit';
      edit.onclick = () => startEdit(e);
      const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'danger';
      del.onclick = () => {
        if (!confirm(`Delete the sleep ending ${dayLabel(e.wake)} at ${timeLabel(e.wake)}?`)) return;
        state.entries = state.entries.filter((o) => o.id !== e.id);
        save(); render();
      };
      li.append(dur, when, edit, del);
      ul.appendChild(li);
    }
  }

  // ---------- form ----------
  const toTimeInput = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function resetForm() {
    editingId = null;
    $('formTitle').textContent = 'Log a sleep';
    $('fSubmit').textContent = 'Add';
    $('fCancel').hidden = true;
    $('fDate').value = C.dateKey(new Date());
    $('fBed').value = '23:00';
    $('fWake').value = '07:00';
    $('formError').textContent = '';
  }

  function startEdit(e) {
    editingId = e.id;
    $('formTitle').textContent = 'Edit sleep';
    $('fSubmit').textContent = 'Save';
    $('fCancel').hidden = false;
    $('fDate').value = C.dateKey(new Date(e.wake));
    $('fBed').value = toTimeInput(e.bed);
    $('fWake').value = toTimeInput(e.wake);
    $('formError').textContent = '';
    $('logForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $('logForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const entry = C.buildEntry($('fDate').value, $('fBed').value, $('fWake').value);
    const err = C.validateEntry(entry, state.entries, editingId);
    if (err) { $('formError').textContent = err; return; }
    if (editingId) {
      state.entries = state.entries.map((o) => (o.id === editingId ? { ...entry, id: editingId } : o));
    } else {
      state.entries.push({ ...entry, id: newId() });
    }
    save(); resetForm(); render();
  });
  $('fCancel').addEventListener('click', resetForm);

  // ---------- quick toggle ----------
  $('sleepToggle').addEventListener('click', () => {
    if (!state.pendingBed) {
      state.pendingBed = Date.now();
      save(); render();
      return;
    }
    const entry = { bed: state.pendingBed, wake: Date.now() };
    const h = C.durationH(entry);
    if (h < 10 / 60) {
      if (confirm('That was under 10 minutes. Discard it?')) { state.pendingBed = null; save(); render(); }
      return;
    }
    const err = C.validateEntry(entry, state.entries, null);
    if (err) {
      if (confirm(`${err}\n\nDiscard this sleep? You can log it manually instead.`)) { state.pendingBed = null; save(); render(); }
      return;
    }
    state.entries.push({ ...entry, id: newId() });
    state.pendingBed = null;
    save(); render();
  });

  // ---------- settings ----------
  const needSelect = $('needSelect');
  for (let h = 5; h <= 10; h += 0.25) {
    const o = document.createElement('option');
    o.value = h; o.textContent = C.formatDuration(h);
    needSelect.appendChild(o);
  }
  needSelect.value = state.settings.needH;
  needSelect.addEventListener('change', () => { state.settings.needH = Number(needSelect.value); save(); render(); });

  $('exportBtn').addEventListener('click', async () => {
    const name = `sleep-data-${C.dateKey(new Date())}.json`;
    const json = JSON.stringify(state, null, 2);
    // On iPhone, the share sheet lets you "Save to Files", AirDrop, or email the backup.
    const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Sleep data backup' }); return; }
      catch (e) { if (e.name === 'AbortError') return; /* otherwise fall back to download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = sanitize(JSON.parse(await file.text()));
      if (!confirm(`Replace your current data with ${data.entries.length} imported sleeps?`)) return;
      state = data;
      needSelect.value = state.settings.needH;
      save(); render();
    } catch (_) {
      alert('That file is not valid sleep data.');
    }
  });

  $('clearBtn').addEventListener('click', () => {
    if (!confirm('Delete all sleep data in this browser? Export first if you want a backup.')) return;
    state = { entries: [], settings: { needH: state.settings.needH }, pendingBed: null };
    save(); render();
  });

  resetForm();
  render();
  setInterval(render, 60 * 1000);
  // iOS pauses timers while the app is in the background; refresh on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!editingId) $('fDate').value = C.dateKey(new Date());
    render();
  });
  // Redraw charts at the new width after rotating the phone or resizing.
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  // Ask the browser not to clear this app's storage under storage pressure.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();

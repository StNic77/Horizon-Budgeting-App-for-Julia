/* ============================================================
   Horizon — app.js
   View rendering + interaction. Tone contract (spec §00):
   plain words, real month names in prompts, no dead ends,
   help always re-summonable, operable on color alone.
   ============================================================ */

const MONTHS_AHEAD = 12; // how many future months the feed shows

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
function money(n) {
  const neg = n < 0; const v = Math.abs(n);
  const s = v.toLocaleString('en-CA', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (neg ? '\u2212$' : '$') + s;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ============================================================
   FEED — current month + future months
   ============================================================ */
function renderFeed() {
  const feed = $('feed');
  feed.innerHTML = '';

  if (!state.items.length) {
    feed.appendChild(emptyHero());
    return;
  }

  const cur = todayMonthKey();
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const mk = monthKeyAddN(cur, i);
    feed.appendChild(monthCard(mk, i === 0));
  }
}

function emptyHero() {
  const e = el('div', 'empty-hero');
  e.innerHTML = `<div class="big">Let's lay out your money.</div>
    <p>Add what comes in — your pay, a pension — and the bills that go out.
    Horizon shows you what's left, month by month.</p>
    <div class="arrow">Tap the + to start</div>`;
  return e;
}

function monthCard(mk, isCurrent) {
  const m = resolveMonth(mk);
  const card = el('div', 'mcard' + (isCurrent ? ' current' : ''));

  const head = el('div', 'mhead');
  head.innerHTML = `<div class="mname">${monthLabel(mk)}</div>` +
    (isCurrent ? `<div class="mtag">This month</div>` : '');
  card.appendChild(head);

  if (isCurrent) card.appendChild(ribbon(mk, m));

  card.appendChild(totalsRow(m));
  card.appendChild(detailSections(m));
  return card;
}

function remainderState(remainder) {
  const red = state.settings.redThreshold != null ? state.settings.redThreshold : 0;
  const yellow = state.settings.tightThreshold != null ? state.settings.tightThreshold : 200;
  if (remainder < red) return 'over';
  if (remainder < yellow) return 'tight';
  return 'good';
}

function totalsRow(m) {
  const wrap = el('div', 'totals');
  const remState = remainderState(m.remainder);
  wrap.innerHTML =
    `<div class="tot in"><div class="k">Coming in</div><div class="v">${money(m.incomeTotal)}</div></div>
     <div class="tot out"><div class="k">Going out</div><div class="v">${money(m.expenseTotal)}</div></div>
     <div class="tot rem ${remState}"><div class="k">Left over</div><div class="v">${money(m.remainder)}</div></div>`;
  return wrap;
}

function detailSections(m) {
  const d = el('div', 'detail');
  d.appendChild(section('di', 'Coming in', m.income, 'in', m));
  d.appendChild(section('db', 'Bills', m.bills, 'out', m));
  d.appendChild(section('do', 'Planned one-offs', m.oneoffs, 'out', m));
  return d;
}
function section(cls, title, list, dir, m) {
  const s = el('div', 'dsection ' + cls);
  s.appendChild(el('h4', null, title));
  if (!list.length) { s.appendChild(el('div', 'empty-line', 'Nothing yet')); return s; }
  for (const ev of list) {
    const r = el('div', 'row ' + dir);
    const dnum = ev.day ? (ev.date ? ordinal(ev.day) : '') : '';
    r.innerHTML = `<div class="rday">${dnum}</div>
      <div class="rname">${esc(ev.name)}</div>
      <div class="ramt">${money(ev.amount)}</div>`;
    if (!m.frozen) r.onclick = () => openEdit(ev.id, m.monthKey);
    s.appendChild(r);
  }
  return s;
}
function ordinal(d) {
  const s = ['th','st','nd','rd'], v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ============================================================
   RIBBON — current month timeline
   ============================================================ */
function ribbon(mk, m) {
  const { y, m: mo } = parseMonthKey(mk);
  const dim = lastDOM(y, mo);
  const today = new Date();
  const isThisRealMonth = (today.getFullYear() === y && today.getMonth() === mo);
  const todayDay = isThisRealMonth ? today.getDate() : null;

  const wrap = el('div', 'ribbon-wrap');
  const rb = el('div', 'ribbon');
  rb.appendChild(el('div', 'axis'));

  const xOf = day => 3 + ((day - 1) / (dim - 1)) * 94; // 3..97% band (keeps end dots off the edge)

  if (todayDay != null) {
    const fill = el('div', 'fill'); fill.style.width = xOf(todayDay) + '%'; rb.appendChild(fill);
    const tk = el('div', 'today'); tk.style.left = xOf(todayDay) + '%';
    tk.innerHTML = `<div class="lbl">${ordinal(todayDay)}</div>`;
    rb.appendChild(tk);
  }

  // Merge same-day, same-side events into ONE dot sized by the day's COMBINED
  // total. Tapping it breaks down every stream that built it. Dot size scales
  // to the biggest day-total in the month (income and expense scaled together
  // so the two sides stay visually comparable).
  const dayGroups = (list) => {
    const by = {};
    for (const ev of list) (by[ev.day] = by[ev.day] || []).push(ev);
    return Object.keys(by).map(day => {
      const evs = by[day].slice().sort((a, b) => b.amount - a.amount);
      const total = round2(evs.reduce((s, e) => s + e.amount, 0));
      return { day: +day, date: evs[0].date, evs, total, kind: evs[0].kind };
    });
  };
  const incGroups = dayGroups(m.income);
  const expGroups = dayGroups([...m.bills, ...m.oneoffs]);
  const maxDayTotal = Math.max(1, ...incGroups.map(g => g.total), ...expGroups.map(g => g.total));
  const sizeOf = total => 9 + Math.round(13 * Math.min(1, total / maxDayTotal)); // 9..22px

  const tip = el('div', 'ribbon-tip');
  const setTip = (grp) => {
    if (!grp) { tip.innerHTML = todayDay != null
      ? 'Tap any dot to see what lands that day' : '&nbsp;'; return; }
    const inOut = grp.kind === 'income' ? 'in' : 'out';
    const head = grp.evs.length > 1
      ? `<div style="opacity:.6;font-size:11px;margin-bottom:3px">${monthDayShort(grp.date)} · ${money(grp.total)} ${inOut} · ${grp.evs.length} streams</div>`
      : `<div style="opacity:.6;font-size:11px;margin-bottom:3px">${monthDayShort(grp.date)}</div>`;
    const lines = grp.evs.map(e => `<b>${esc(e.name)}</b> ${money(e.amount)}`)
      .join('<span style="opacity:.4"> &nbsp;·&nbsp; </span>');
    tip.innerHTML = head + lines;
  };

  for (const g of incGroups) rb.appendChild(makeDot(g, xOf(g.day), 'rise', -1, sizeOf(g.total), setTip));
  for (const g of expGroups) rb.appendChild(makeDot(g, xOf(g.day), 'fall', 1, sizeOf(g.total), setTip));

  // day number ticks (1, ~week marks, last) — positioned in the same band as dots
  const nums = el('div', 'daynums');
  const marks = [1, 8, 15, 22, dim];
  nums.innerHTML = marks.map(d => `<span style="left:${xOf(d)}%">${d}</span>`).join('');
  rb.appendChild(nums);

  wrap.appendChild(rb);
  setTip(null);
  wrap.appendChild(tip);
  return wrap;
}

function makeDot(grp, xPct, cls, dir, size, setTip) {
  const d = el('div', 'dot ' + cls);
  d.style.left = xPct + '%';
  d.style.width = size + 'px'; d.style.height = size + 'px';
  // above line for income (dir -1), below for expense (dir +1)
  const off = 15 + size / 2;
  d.style.top = `calc(50% ${dir < 0 ? '-' : '+'} ${off}px)`;
  d.onclick = (e) => { e.stopPropagation(); setTip(grp); };
  return d;
}
function monthDayShort(iso) {
  const d = parseISO(iso);
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate();
}

/* ============================================================
   HISTORY
   ============================================================ */
function showHistory() {
  const keys = Object.keys(state.snapshots).sort((a, b) => monthKeyCmp(b, a)); // newest first
  const feed = $('feed');
  feed.innerHTML = '';
  const back = el('div', 'empty-hero');
  if (!keys.length) {
    back.innerHTML = `<div class="big">No past months yet.</div>
      <p>As each month finishes, it tucks in here so you can look back on it.</p>
      <div class="arrow" id="histBack">Back to now</div>`;
    feed.appendChild(back);
    $('histBack').onclick = () => renderFeed();
    return;
  }
  const hdr = el('div', 'mhead');
  hdr.style.padding = '4px 2px 10px';
  hdr.innerHTML = `<div class="mname">Looking back</div>
    <button class="mtag" id="histBack" style="cursor:pointer">Back to now</button>`;
  feed.appendChild(hdr);
  for (const mk of keys) {
    const m = state.snapshots[mk];
    const card = el('div', 'mcard');
    card.appendChild(el('div', 'mhead', `<div class="mname">${monthLabel(mk)}</div>`));
    card.appendChild(totalsRow(m));
    card.appendChild(detailSections(Object.assign({}, m, { frozen: true })));
    feed.appendChild(card);
  }
  $('histBack').onclick = () => renderFeed();
}

/* ============================================================
   ADD / EDIT SHEET
   ============================================================ */
let editCtx = null; // { id, monthKey } when editing, null when adding

function openAdd() {
  editCtx = null;
  $('sheetTitle').textContent = 'Add something';
  $('deleteWrap').style.display = 'none';
  $('fName').value = '';
  $('fAmount').value = '';
  setKind('income');
  $('fRepeat').value = 'biweekly';
  renderRepeatFollow();
  $('fOnceDate').value = todayISO();
  openSheet('editSheet');
  setTimeout(() => $('fName').focus(), 300);
}

function openEdit(itemId, monthKey) {
  const item = state.items.find(x => x.id === itemId);
  if (!item) return;
  editCtx = { id: itemId, monthKey };
  $('sheetTitle').textContent = 'Edit';
  $('deleteWrap').style.display = 'flex';
  // name/amount reflect what shows THIS month (override-aware)
  const ov = (item.overrides || []).find(o => o.monthKey === monthKey);
  $('fName').value = (ov && ov.name != null) ? ov.name : item.name;
  const amt = (ov && ov.amount != null) ? ov.amount
    : (item.kind === 'oneoff' ? item.amount : baseAmountFor(item, monthKey));
  $('fAmount').value = amt != null ? amt : '';
  setKind(item.kind);
  if (item.kind === 'oneoff') {
    $('fOnceDate').value = item.date || todayISO();
  } else {
    presetRepeatFromRecur(item.recur);
    renderRepeatFollow(item.recur);
  }
  openSheet('editSheet');
}

let curKind = 'income';
function setKind(k) {
  const prev = curKind;
  curKind = k;
  document.querySelectorAll('#kindSeg button').forEach(b =>
    b.classList.toggle('on', b.dataset.k === k));
  $('recurBlock').style.display = k === 'oneoff' ? 'none' : 'block';
  $('onceBlock').style.display = k === 'oneoff' ? 'block' : 'none';
  // When switching INTO a recurring kind (e.g. from one-off), make sure the
  // follow-up fields exist. Seed a sensible day-of-month from the one-off's
  // date if we have one, so "dance camp on the 12th" becomes "monthly on 12".
  if (k !== 'oneoff' && prev === 'oneoff') {
    const onceDate = $('fOnceDate').value;
    const seedDay = onceDate ? parseISO(onceDate).getDate() : new Date().getDate();
    if (!$('fRepeat').value || $('fRepeat').value === 'biweekly') $('fRepeat').value = 'monthly';
    renderRepeatFollow({ type: 'monthly', day: seedDay });
  } else if (k !== 'oneoff') {
    if (!$('repeatFollow').children.length) renderRepeatFollow();
  }
}

/* map the friendly dropdown value -> follow-up fields */
function renderRepeatFollow(existingRecur) {
  const v = $('fRepeat').value;
  const box = $('repeatFollow');
  box.innerHTML = '';
  const dayField = (id, label, val) => `<div class="field"><label>${label}</label>
    <input type="number" id="${id}" min="1" max="31" value="${val || 1}"></div>`;
  const weekdaySel = (id, val) => `<div class="field"><label>Which day?</label>
    <select id="${id}">${WEEKDAYS.map((w, i) => `<option value="${i}" ${i === (val ?? 5) ? 'selected' : ''}>${w}</option>`).join('')}</select></div>`;

  if (v === 'weekly') box.innerHTML = weekdaySel('rWeekday', existingRecur?.weekday);
  else if (v === 'biweekly') box.innerHTML = `<div class="field"><label>Starting on which date?</label>
    <input type="date" id="rAnchor" value="${existingRecur?.anchorDate || nextFridayISO()}">
    <div class="hintline">Pick any date one of them lands on — Horizon counts every two weeks from there.</div></div>`;
  else if (v === 'semimonthly') box.innerHTML = `<div class="row2">
    ${dayField('rDay1', 'First day', existingRecur?.day1 || 1)}
    ${dayField('rDay2', 'Second day', existingRecur?.day2 || 15)}</div>`;
  else if (v === 'monthly') box.innerHTML = dayField('rDay', 'On which day of the month?', existingRecur?.day || 1);
  else if (v === 'lastWeekday') box.innerHTML = weekdaySel('rWeekday', existingRecur?.weekday);
  else if (v === 'lastBankingDay') box.innerHTML = `<div class="hintline">The last weekday of each month that a bank is open — Horizon skips weekends and holidays for you.</div>`;
  else if (v === 'yearly') box.innerHTML = `<div class="row2">
    <div class="field"><label>Which month?</label><select id="rMonth">${
      ['January','February','March','April','May','June','July','August','September','October','November','December']
      .map((mn, i) => `<option value="${i}" ${i === (existingRecur?.month ?? new Date().getMonth()) ? 'selected' : ''}>${mn}</option>`).join('')
    }</select></div>${dayField('rDay', 'Day', existingRecur?.day || 1)}</div>`;
  else if (v === 'everyNMonthsX') box.innerHTML = `<div class="row2">
    <div class="field"><label>Every how many months?</label><input type="number" id="rN" min="2" max="24" value="${existingRecur?.n || 4}"></div>
    ${dayField('rDay', 'On day', existingRecur?.day || 1)}</div>`;
  else if (v.startsWith('everyNMonths')) box.innerHTML = dayField('rDay', 'On which day of the month?', existingRecur?.day || 1);
}
$('fRepeat').addEventListener('change', () => renderRepeatFollow());
document.querySelectorAll('#kindSeg button').forEach(b => b.onclick = () => setKind(b.dataset.k));

function presetRepeatFromRecur(r) {
  const map = {
    weekly: 'weekly', biweekly: 'biweekly', semimonthly: 'semimonthly',
    monthly: 'monthly', lastWeekday: 'lastWeekday', lastBankingDay: 'lastBankingDay', yearly: 'yearly'
  };
  if (r.type === 'everyNMonths') {
    $('fRepeat').value = [2, 3, 6].includes(r.n) ? 'everyNMonths' + r.n : 'everyNMonthsX';
  } else {
    $('fRepeat').value = map[r.type] || 'monthly';
  }
}

/* read the follow-up fields back into a RecurRule */
function buildRecur() {
  const v = $('fRepeat').value;
  const gi = id => parseInt(($(id) || {}).value, 10);
  if (v === 'weekly') return { type: 'weekly', weekday: gi('rWeekday') };
  if (v === 'biweekly') return { type: 'biweekly', anchorDate: $('rAnchor').value };
  if (v === 'semimonthly') return { type: 'semimonthly', day1: gi('rDay1'), day2: gi('rDay2') };
  if (v === 'monthly') return { type: 'monthly', day: gi('rDay') };
  if (v === 'lastWeekday') return { type: 'lastWeekday', weekday: gi('rWeekday') };
  if (v === 'lastBankingDay') return { type: 'lastBankingDay' };
  if (v === 'yearly') return { type: 'yearly', month: gi('rMonth'), day: gi('rDay') };
  if (v === 'everyNMonthsX') return { type: 'everyNMonths', n: gi('rN'), day: gi('rDay'), startMonth: (editCtx ? editCtx.monthKey : todayMonthKey()) };
  if (v.startsWith('everyNMonths')) return { type: 'everyNMonths', n: parseInt(v.slice(12), 10), day: gi('rDay'), startMonth: (editCtx ? editCtx.monthKey : todayMonthKey()) };
  return { type: 'monthly', day: 1 };
}

function nextFridayISO() {
  const d = new Date();
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ---------- save ---------- */
$('btnSave').onclick = () => {
  const name = $('fName').value.trim();
  const amount = round2(parseFloat($('fAmount').value));
  if (!name) { toast('Give it a name first'); $('fName').focus(); return; }
  if (!(amount >= 0)) { toast('Add an amount'); $('fAmount').focus(); return; }

  if (!editCtx) {
    // ADD — no scope question needed
    const item = { id: uid(), kind: curKind, name, overrides: [] };
    if (curKind === 'oneoff') {
      item.date = $('fOnceDate').value; item.amount = amount;
    } else {
      item.recur = buildRecur();
      item.base = [{ from: todayMonthKey(), amount }];
    }
    state.items.push(item);
    commitAndClose(`Added ${name}`);
    return;
  }

  // EDIT
  const item = state.items.find(x => x.id === editCtx.id);
  const mk = editCtx.monthKey;
  const kindChanged = curKind !== item.kind;

  // Changing the KIND (e.g. one-off -> monthly bill) is a fundamental reshape,
  // not a "this month vs. forward" tweak — rebuild the item in its new shape and
  // save directly. Without this, the item kept its old shape and vanished.
  if (kindChanged) {
    reshapeItem(item, curKind, name, amount, mk);
    commitAndClose(`Updated ${name}`);
    return;
  }

  const pending = { name, amount, kind: curKind, recur: curKind === 'oneoff' ? null : buildRecur(), date: curKind === 'oneoff' ? $('fOnceDate').value : null };
  if (item.kind === 'oneoff') { applyEdit(item, pending, 'forward'); return; }
  askScope(item, pending);
};

/* Rebuild an item into a new kind, discarding shape that no longer applies. */
function reshapeItem(item, newKind, name, amount, mk) {
  item.kind = newKind;
  item.name = name;
  item.overrides = [];        // old overrides referenced the old shape; clear them
  delete item.endFrom;
  if (newKind === 'oneoff') {
    item.recur = undefined; delete item.recur;
    item.base = undefined; delete item.base;
    item.date = $('fOnceDate').value;
    item.amount = amount;
  } else {
    delete item.date; delete item.amount;
    item.recur = buildRecur();
    // start the recurring life at the month being edited (forward-only)
    item.base = [{ from: mk, amount }];
  }
}

/* ---------- scope prompt (tone-critical) ---------- */
let scopePending = null;
function askScope(item, pending) {
  scopePending = { item, pending };
  const mk = editCtx.monthKey;
  const thisMonth = monthLabel(mk).split(' ')[0]; // "September"
  $('scopeTitle').textContent = 'How far should this change reach?';
  $('scopeThisB').textContent = `Just ${thisMonth}`;
  $('scopeThisS').textContent = `Only ${monthLabel(mk)} changes. Every other month stays as it is.`;
  $('scopeFwdB').textContent = `${thisMonth} and every month after`;
  $('scopeFwdS').textContent = `From ${monthLabel(mk)} onward. Months before it don't change.`;
  openSheet('scopeSheet', 'scopeScrim');
}
$('scopeThis').onclick = () => { const { item, pending } = scopePending; applyEdit(item, pending, 'this'); };
$('scopeFwd').onclick = () => { const { item, pending } = scopePending; applyEdit(item, pending, 'forward'); };
$('scopeCancel').onclick = () => closeSheet('scopeSheet', 'scopeScrim');

function applyEdit(item, pending, scope) {
  const mk = editCtx.monthKey;

  if (item.kind === 'oneoff') {
    item.name = pending.name; item.amount = pending.amount; item.date = pending.date;
    closeSheet('scopeSheet', 'scopeScrim'); commitAndClose(`Updated ${pending.name}`); return;
  }

  if (scope === 'this') {
    // per-month override
    let ov = item.overrides.find(o => o.monthKey === mk);
    if (!ov) { ov = { monthKey: mk }; item.overrides.push(ov); }
    ov.name = pending.name; ov.amount = pending.amount; delete ov.skip;
    // recurrence changes don't apply "this month only" — keep base recur
  } else {
    // forward: name + recur update globally from this month; amount via effective-from segment
    item.name = pending.name;
    item.recur = pending.recur;
    // set/replace the segment starting at mk
    item.base = (item.base || []).filter(s => s.from !== mk);
    item.base.push({ from: mk, amount: pending.amount });
    item.base.sort((a, b) => monthKeyCmp(a.from, b.from));
    // clear any this-month override that would mask the new forward value here
    item.overrides = item.overrides.filter(o => o.monthKey !== mk || o.skip);
  }
  closeSheet('scopeSheet', 'scopeScrim');
  commitAndClose(`Updated ${pending.name}`);
}

/* ---------- delete ---------- */
$('btnDelete').onclick = () => {
  const item = state.items.find(x => x.id === editCtx.id);
  if (!item) return;
  if (item.kind === 'oneoff') {
    state.items = state.items.filter(x => x.id !== item.id);
    commitAndClose(`Removed ${item.name}`); return;
  }
  // recurring: offer scope on delete too
  const mk = editCtx.monthKey;
  const thisMonth = monthLabel(mk).split(' ')[0];
  scopePending = { item, pending: null };
  $('scopeTitle').textContent = `Remove ${esc(item.name)}?`;
  $('scopeThisB').textContent = `Just skip ${thisMonth}`;
  $('scopeThisS').textContent = `Removes it from ${monthLabel(mk)} only. It still comes back after.`;
  $('scopeFwdB').textContent = `Remove it for good`;
  $('scopeFwdS').textContent = `Deletes it from ${monthLabel(mk)} onward. Past months keep it.`;
  $('scopeThis').onclick = () => {
    let ov = item.overrides.find(o => o.monthKey === mk);
    if (!ov) { ov = { monthKey: mk }; item.overrides.push(ov); }
    ov.skip = true;
    closeSheet('scopeSheet', 'scopeScrim'); commitAndClose(`Skipped ${item.name} for ${thisMonth}`);
    resetScopeHandlers();
  };
  $('scopeFwd').onclick = () => {
    // End the item at mk (inclusive). resolveMonth skips it from mk onward.
    // Past months (before mk) still show it via base segments that predate mk.
    item.endFrom = mk;
    // Drop any base segments at/after mk so they can't linger if endFrom is ever cleared.
    item.base = (item.base || []).filter(s => monthKeyCmp(s.from, mk) < 0);
    // If nothing remains before mk either, the item never showed anywhere live — remove it.
    if (!item.base.length) state.items = state.items.filter(x => x.id !== item.id);
    closeSheet('scopeSheet', 'scopeScrim'); commitAndClose(`Removed ${item.name}`);
    resetScopeHandlers();
  };
  openSheet('scopeSheet', 'scopeScrim');
};
function resetScopeHandlers() {
  $('scopeThis').onclick = () => { const { item, pending } = scopePending; applyEdit(item, pending, 'this'); };
  $('scopeFwd').onclick = () => { const { item, pending } = scopePending; applyEdit(item, pending, 'forward'); };
}

async function commitAndClose(msg) {
  freezePastMonths();
  await save();
  closeSheet('editSheet');
  closeSheet('scopeSheet', 'scopeScrim');
  renderFeed();
  if (msg) toast(msg);
}

/* ============================================================
   SHEET plumbing
   ============================================================ */
let _scrollY = 0;
function anySheetOpen() {
  return $('editSheet').classList.contains('open') || $('scopeSheet').classList.contains('open') || $('setSheet').classList.contains('open');
}
function openSheet(id, scrimId) {
  const wasOpen = anySheetOpen();
  $(scrimId || 'scrim').classList.add('open');
  $(id).classList.add('open');
  if (!wasOpen) {
    _scrollY = window.scrollY;
    document.body.style.top = `-${_scrollY}px`;
    document.body.classList.add('locked');
  }
}
function closeSheet(id, scrimId) {
  $(scrimId || 'scrim').classList.remove('open');
  $(id).classList.remove('open');
  if (!anySheetOpen() && document.body.classList.contains('locked')) {
    document.body.classList.remove('locked');
    document.body.style.top = '';
    window.scrollTo(0, _scrollY);
  }
}
$('scrim').onclick = () => closeSheet('editSheet');
$('scopeScrim').onclick = () => closeSheet('scopeSheet', 'scopeScrim');
$('btnCancel').onclick = () => closeSheet('editSheet');
$('fab').onclick = openAdd;
$('btnHistory').onclick = showHistory;

/* ============================================================
   THEME (day / night) — remembers her manual choice
   ============================================================ */
function applyTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  // toggle button shows the OTHER mode you'd switch to
  $('btnTheme').textContent = light ? '🌙' : '☀️';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', light ? '#ede1cc' : '#1b2b3a');
}
async function setTheme(theme) {
  state.settings.theme = theme;
  applyTheme(theme);
  await save();
}
$('btnTheme').onclick = () => setTheme(state.settings.theme === 'light' ? 'dark' : 'light');

/* ============================================================
   SETTINGS
   ============================================================ */
function openSettings() {
  document.querySelectorAll('#themeSeg button').forEach(b =>
    b.classList.toggle('on', b.dataset.theme === (state.settings.theme || 'dark')));
  $('fTight').value = state.settings.tightThreshold != null ? state.settings.tightThreshold : 200;
  $('fRed').value = state.settings.redThreshold != null ? state.settings.redThreshold : 0;
  updateTightPreview();
  openSheet('setSheet', 'setScrim');
}
function updateTightPreview() {
  let yellow = Math.round(numOr($('fTight').value, 200));
  let red = Math.round(numOr($('fRed').value, 0));
  if (red > yellow) red = yellow; // red can't sit above yellow
  $('tightPreview').innerHTML =
    `Green at ${money(yellow)} or more · yellow from ${money(red)} up to ${money(yellow)} · red below ${money(red)}.`;
}
function numOr(x, d) { const n = parseFloat(x); return isFinite(n) ? n : d; }
$('fTight').addEventListener('input', updateTightPreview);
$('fRed').addEventListener('input', updateTightPreview);
document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('on', x === b));
  applyTheme(b.dataset.theme); // live preview; saved on Save
});
$('setSave').onclick = async () => {
  const chosen = document.querySelector('#themeSeg button.on');
  state.settings.theme = chosen ? chosen.dataset.theme : (state.settings.theme || 'dark');
  let yellow = Math.round(numOr($('fTight').value, 200));
  let red = Math.round(numOr($('fRed').value, 0));
  if (red > yellow) red = yellow; // keep the bands coherent
  state.settings.tightThreshold = yellow;
  state.settings.redThreshold = red;
  await save();
  closeSheet('setSheet', 'setScrim');
  renderFeed();
  toast('Settings saved');
};
$('setCancel').onclick = () => {
  applyTheme(state.settings.theme || 'dark'); // revert any live preview
  closeSheet('setSheet', 'setScrim');
};
$('setScrim').onclick = () => { applyTheme(state.settings.theme || 'dark'); closeSheet('setSheet', 'setScrim'); };
$('btnSettings').onclick = openSettings;

/* Clear everything — two-step guard, since it can't be undone. */
$('btnClearAll').onclick = async () => {
  const first = confirm(
    'Clear everything and start fresh?\n\n' +
    'This removes all your income, bills, and one-offs, and every past month. ' +
    'It cannot be undone.'
  );
  if (!first) return;
  const second = confirm('Really clear it all? This is permanent.');
  if (!second) return;
  await clearAllData();
  closeSheet('setSheet', 'setScrim');
  renderFeed();
  toast('All cleared — a fresh start');
};

/* ============================================================
   GREETING CARD — first open, revisitable via the heart
   ============================================================ */
function paintGreeting() {
  const g = state.settings.greeting || {};
  if (g.to != null) $('greetTo').textContent = g.to;
  if (g.body != null) $('greetBody').innerHTML = g.body;
  if (g.sign != null) $('greetSign').textContent = g.sign;
}
function showGreeting() {
  paintGreeting();
  $('greet').classList.add('open');
}
async function closeGreeting() {
  $('greet').classList.remove('open');
  if (!state.settings.greeted) {
    state.settings.greeted = true;
    await save();
    // first-time: flow into onboarding after the card eases away
    if (!state.settings.onboarded) setTimeout(startOnboarding, 500);
  }
}
$('greetOpen').onclick = closeGreeting;
$('btnGreeting').onclick = showGreeting;

/* ============================================================
   ONBOARDING
   ============================================================ */
const ONB = [
  { illo: 'horizon', text: `Hey — this is your money, laid out <em>month by month</em>. What's coming in, what's going out, and what's left.` },
  { illo: 'plus-in', text: `Tap the <em>+</em> to add your pay, or a pension — anything that comes in.` },
  { illo: 'plus-out', text: `Tap <em>+</em> again for a bill, or a one-time thing you're planning for, like camp.` },
  { illo: 'lights', text: `<span class="g">Green</span> means you're comfy, <span class="y">yellow</span> means keep an eye on it, <span class="r">red</span> means it's tight.` },
  { illo: 'history', text: `Finished months tuck into <em>History</em> — up top — so you can always look back.` },
  { illo: 'heart', text: `That's it. It only knows what you tell it — so keep it filled in, and it'll always show you where you stand.` }
];
let onbIdx = 0;
function startOnboarding() {
  onbIdx = 0;
  $('onb').classList.add('open');
  $('onbDots').innerHTML = ONB.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
  paintOnb();
}
function paintOnb() {
  const step = ONB[onbIdx];
  $('onbText').innerHTML = step.text;
  $('onbIllo').innerHTML = onbIllustration(step.illo);
  document.querySelectorAll('#onbDots i').forEach((d, i) => d.classList.toggle('on', i === onbIdx));
  $('onbNext').textContent = onbIdx === ONB.length - 1 ? "Let's go" : 'Next';
}
$('onbNext').onclick = () => {
  if (onbIdx < ONB.length - 1) { onbIdx++; paintOnb(); }
  else finishOnboarding();
};
$('onbSkip').onclick = finishOnboarding;
async function finishOnboarding() {
  $('onb').classList.remove('open');
  state.settings.onboarded = true;
  await save();
}
$('btnHelp').onclick = () => startOnboarding();

function onbIllustration(kind) {
  // Small inline SVGs echoing the horizon identity — calm, not clip-art.
  const C = { sun:'#e0a256', rise:'#6f9457', fall:'#c06a44', line:'#d8c6a8', ink:'#3f3222', warn:'#c99a3f', brick:'#a8432e' };
  if (kind === 'horizon') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <line x1="10" y1="70" x2="140" y2="70" stroke="${C.line}" stroke-width="2"/>
    <circle cx="75" cy="70" r="13" fill="${C.sun}"/><circle cx="75" cy="70" r="20" fill="none" stroke="${C.sun}" stroke-opacity=".3" stroke-width="2"/>
    <circle cx="40" cy="52" r="6" fill="${C.rise}"/><circle cx="112" cy="86" r="6" fill="${C.fall}"/></svg>`;
  if (kind === 'plus-in') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <line x1="10" y1="72" x2="140" y2="72" stroke="${C.line}" stroke-width="2"/>
    <circle cx="55" cy="48" r="8" fill="${C.rise}"/><circle cx="95" cy="40" r="11" fill="${C.rise}"/>
    <path d="M75 92 v-16 M67 84 h16" stroke="${C.brick}" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (kind === 'plus-out') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <line x1="10" y1="55" x2="140" y2="55" stroke="${C.line}" stroke-width="2"/>
    <circle cx="55" cy="78" r="8" fill="${C.fall}"/><circle cx="95" cy="86" r="11" fill="${C.fall}"/>
    <path d="M75 22 v16 M67 30 h16" stroke="${C.brick}" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (kind === 'lights') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <circle cx="45" cy="55" r="13" fill="${C.rise}"/><circle cx="80" cy="55" r="13" fill="${C.warn}"/><circle cx="115" cy="55" r="13" fill="${C.fall}"/></svg>`;
  if (kind === 'history') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <circle cx="75" cy="55" r="30" fill="none" stroke="${C.line}" stroke-width="3"/>
    <path d="M75 35 v20 l14 9" fill="none" stroke="${C.brick}" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (kind === 'heart') return `<svg width="150" height="110" viewBox="0 0 150 110">
    <path d="M75 82 C 40 58 48 34 66 42 C 73 45 75 52 75 52 C 75 52 77 45 84 42 C 102 34 110 58 75 82 Z" fill="${C.brick}" fill-opacity=".9"/></svg>`;
  return '';
}

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  await loadState();
  applyTheme(state.settings.theme || 'dark');   // default: dark dusk
  const froze = freezePastMonths();
  if (froze) await save();
  renderFeed();
  // First open ever: greet her. Tapping "Open Horizon" then flows into onboarding.
  // Later opens: no greeting; it lives behind the heart. Onboarding only if not done.
  if (!state.settings.greeted) {
    showGreeting();
  } else if (!state.settings.onboarded) {
    startOnboarding();
  }
})();

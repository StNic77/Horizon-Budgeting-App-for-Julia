/* ============================================================
   Horizon — core.js
   ------------------------------------------------------------
   State shape, IndexedDB storage, date helpers, and the
   recurrence projection engine (recur rule -> occurrences in a
   month) with per-occurrence override resolution.

   Governing rule: every number traces to something the user
   typed. Nothing is back-solved. Past months are frozen
   snapshots; edits only ever move forward from the edited month.
   ============================================================ */

/* ---------- state ---------- */
const APP_BUILD = 'horizon-13-topbar';

let state = {
  build: APP_BUILD,
  items: [],          // see item shape below
  snapshots: {},      // monthKey -> frozen month record
  settings: {
    tightThreshold: 200,   // remainder below this = yellow
    redThreshold: 0,       // remainder below this = red (settable; her comfort line)
    theme: 'dark',         // 'dark' (dusk, default) or 'light' (warm paper)
    onboarded: false,
    greeted: false,        // has the first-open greeting card been seen
    greeting: {            // the personal note — editable, travels with the app
      to: 'Julia,',
      body: 'I made this for you — a quiet place for you to be able to plan ahead.<br><br>I hope this makes things easier for you, and I hope you like it.',
      sign: 'Love, Shawn'
    },
    name: ''               // optional, for a friendly touch
  },
  lastModified: null
};

/* Item shape:
   {
     id, kind:'income'|'bill'|'oneoff'|'variable',
     name,
     // recurring items (income/bill, and monthly-estimate variables):
     base: [ { from:'2026-07', amount:120 }, ... ],
     // one-off items use a single date + amount instead of base/recur
     amount,                                          // oneoff / once-variable
     date,                                            // oneoff / once-variable ('YYYY-MM-DD')
     dir,                                             // oneoff only: 'in'|'out' (default 'out')
     recur,                                           // RecurRule (income/bill only)
     // variable-expense fields:
     category,                                        // 'Groceries','Gas',... or custom string
     mode,                                            // 'once' (dated) | 'monthly' (rough estimate)
     overrides: [ { monthKey:'2026-07', amount?, name?, skip? } ]
   }

   Kinds:
     income   — recurring money in
     bill      — recurring fixed money out
     oneoff    — single dated one-time in or out (dir)
     variable  — category-tagged flexible spend; mode 'once' (dated, backfillable)
                 or 'monthly' (rough recurring estimate). Always money out.

   RecurRule types:
     {type:'weekly', weekday}                 0=Sun..6=Sat
     {type:'biweekly', anchorDate}            'YYYY-MM-DD'
     {type:'semimonthly', day1, day2}
     {type:'monthly', day}
     {type:'lastWeekday', weekday}
     {type:'lastBankingDay'}
     {type:'everyNMonths', n, day, startMonth} startMonth 'YYYY-MM' anchors the cycle
     {type:'yearly', month, day}              month 0..11
*/

/* ---------- storage (IndexedDB, single record) ---------- */
const DB_NAME = 'horizon-db';
const STORE = 'kv';
let _db = null;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
function dbGet(key) {
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function dbSet(key, val) {
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, 'readwrite');
    const rq = tx.objectStore(STORE).put(val, key);
    rq.onsuccess = () => res();
    rq.onerror = () => rej(rq.error);
  });
}

async function loadState() {
  await openDB();
  const saved = await dbGet('state');
  if (saved) {
    state = Object.assign(state, saved);
    // defensive defaults for forward-compat
    state.items = Array.isArray(state.items) ? state.items : [];
    state.snapshots = state.snapshots || {};
    state.settings = Object.assign({
      tightThreshold: 200, redThreshold: 0, theme: 'dark',
      onboarded: false, greeted: false,
      greeting: { to: 'Julia,', body: 'I made this for you — a quiet place for you to be able to plan ahead.<br><br>I hope this makes things easier for you, and I hope you like it.', sign: 'Love, Shawn' },
      name: ''
    }, state.settings || {});
  }
  return state;
}
async function save() {
  state.lastModified = new Date().toISOString();
  await dbSet('state', state);
}

/* Wipe all budget data and start fresh. Preserves the personal greeting note
   and the chosen theme — clearing her budget shouldn't erase the gift or her
   look preference. Returns nothing; caller re-renders. */
async function clearAllData() {
  const keepGreeting = state.settings.greeting;
  const keepTheme = state.settings.theme;
  state.items = [];
  state.snapshots = {};
  state.settings = {
    tightThreshold: 200,
    redThreshold: 0,
    theme: keepTheme || 'dark',
    onboarded: true,          // she's already used it; don't re-run the walkthrough
    greeted: true,            // don't replay the first-open card on a reset
    greeting: keepGreeting || { to: 'Julia,', body: 'I made this for you — a quiet place for you to be able to plan ahead.<br><br>I hope this makes things easier for you, and I hope you like it.', sign: 'Love, Shawn' },
    name: ''
  };
  state.lastModified = new Date().toISOString();
  await dbSet('state', state);
}

/* ---------- id ---------- */
function uid() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- date helpers ---------- */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoOf(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }         // m is 0-based
function monthKeyOf(y, m) { return y + '-' + pad2(m + 1); }                        // 'YYYY-MM'
function todayISO() {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}
function todayMonthKey() {
  const d = new Date();
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
function lastDOM(y, m) { return new Date(y, m + 1, 0).getDate(); }                 // days in month, m 0-based
function parseISO(s) { return new Date(s + 'T12:00:00'); }                         // noon avoids DST edge
function parseMonthKey(k) { const [y, m] = k.split('-').map(Number); return { y, m: m - 1 }; }
function monthKeyAddN(k, n) {
  const { y, m } = parseMonthKey(k);
  const d = new Date(y, m + n, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
function monthKeyCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function monthLabel(k) {
  const { y, m } = parseMonthKey(k);
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m] + ' ' + y;
}
function monthShort(k) {
  const { y, m } = parseMonthKey(k);
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m] + ' ' + y;
}

/* Canadian federal statutory holidays (for 'lastBankingDay').
   Kept deliberately simple & national — good enough for "is this a
   banking day" nudging. Not payroll-grade, and never claims to be. */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function nthWeekdayOfMonth(y, m, weekday, n) { // n=1 first, etc.
  const first = new Date(y, m, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}
function lastWeekdayOfMonth(y, m, weekday) {
  const last = lastDOM(y, m);
  const lastDay = new Date(y, m, last).getDay();
  const offset = (lastDay - weekday + 7) % 7;
  return last - offset;
}
function statHolidaysISO(y) {
  const H = new Set();
  const add = (mo, d) => H.add(isoOf(y, mo, d));
  add(0, 1);                                                   // New Year's Day
  const gf = easterSunday(y); gf.setDate(gf.getDate() - 2);    // Good Friday
  H.add(isoOf(gf.getFullYear(), gf.getMonth(), gf.getDate()));
  // Victoria Day: Monday before May 25
  let vd = 25; while (new Date(y, 4, vd).getDay() !== 1) vd--;
  add(4, vd);
  add(6, 1);                                                   // Canada Day
  add(7, nthWeekdayOfMonth(y, 7, 1, 1));                       // Civic (1st Mon Aug)
  add(8, nthWeekdayOfMonth(y, 8, 1, 1));                       // Labour Day (1st Mon Sep)
  add(8, 30);                                                  // Truth & Reconciliation
  add(9, nthWeekdayOfMonth(y, 9, 1, 2));                       // Thanksgiving (2nd Mon Oct)
  add(10, 11);                                                 // Remembrance Day
  add(11, 25);                                                 // Christmas
  add(11, 26);                                                 // Boxing Day
  return H;
}
function isBankingDay(y, m, d, holidayCache) {
  const dow = new Date(y, m, d).getDay();
  if (dow === 0 || dow === 6) return false;
  const hs = holidayCache[y] || (holidayCache[y] = statHolidaysISO(y));
  return !hs.has(isoOf(y, m, d));
}
function lastBankingDayOfMonth(y, m, holidayCache) {
  let d = lastDOM(y, m);
  while (d >= 1 && !isBankingDay(y, m, d, holidayCache)) d--;
  return d;
}

/* ------------------------------------------------------------
   occurrencesInMonth(item, monthKey) -> [ {date:'YYYY-MM-DD', day} ]
   Pure. Returns the day(s) this recurring item lands on within the
   given calendar month, per its RecurRule. One-off items resolve
   via their single date. Override application (amount/name/skip)
   is layered on top in resolveMonth(), NOT here.
   ------------------------------------------------------------ */
const _holidayCache = {};

function occurrencesInMonth(item, monthKey) {
  const { y, m } = parseMonthKey(monthKey);
  const out = [];
  const push = (d) => { if (d >= 1 && d <= lastDOM(y, m)) out.push(d); };

  if (item.kind === 'oneoff') {
    if (item.date && item.date.slice(0, 7) === monthKey) {
      out.push(parseISO(item.date).getDate());
    }
    return finalize(out, y, m);
  }

  if (item.kind === 'variable') {
    if (item.mode === 'monthly') {
      // rough monthly estimate: appears every month from its first base segment,
      // shown at end of month (informational; not a real dated transaction).
      const segs = (item.base || []).slice().sort((a, b) => monthKeyCmp(a.from, b.from));
      if (segs.length && monthKeyCmp(segs[0].from, monthKey) <= 0) push(lastDOM(y, m));
    } else {
      // 'once' dated entry (backfillable within a month)
      if (item.date && item.date.slice(0, 7) === monthKey) out.push(parseISO(item.date).getDate());
    }
    return finalize(out, y, m);
  }

  const r = item.recur || { type: 'monthly', day: 1 };
  switch (r.type) {
    case 'monthly':
      push(Math.min(r.day, lastDOM(y, m)));
      break;

    case 'semimonthly':
      push(Math.min(r.day1, lastDOM(y, m)));
      push(Math.min(r.day2, lastDOM(y, m)));
      break;

    case 'yearly':
      if (m === r.month) push(Math.min(r.day, lastDOM(y, m)));
      break;

    case 'everyNMonths': {
      const start = r.startMonth || monthKeyOf(y, m); // anchor
      const { y: sy, m: sm } = start.length === 7
        ? { y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 }
        : { y, m };
      const diff = (y - sy) * 12 + (m - sm);
      if (diff >= 0 && diff % (r.n || 2) === 0) push(Math.min(r.day, lastDOM(y, m)));
      break;
    }

    case 'lastWeekday':
      push(lastWeekdayOfMonth(y, m, r.weekday));
      break;

    case 'lastBankingDay':
      push(lastBankingDayOfMonth(y, m, _holidayCache));
      break;

    case 'weekly': {
      // every occurrence of weekday r.weekday this month
      for (let d = 1; d <= lastDOM(y, m); d++) {
        if (new Date(y, m, d).getDay() === r.weekday) out.push(d);
      }
      break;
    }

    case 'biweekly': {
      // count 14-day steps from anchor; include those landing this month
      const anchor = parseISO(r.anchorDate);
      const monthStart = new Date(y, m, 1, 12);
      const monthEnd = new Date(y, m, lastDOM(y, m), 12);
      // find first occurrence >= monthStart
      const msPerDay = 86400000;
      let steps = Math.ceil((monthStart - anchor) / (14 * msPerDay));
      if (steps < 0) steps = 0;
      let occ = new Date(anchor.getTime() + steps * 14 * msPerDay);
      // walk back one in case ceil overshot
      while (occ > monthStart) { const p = new Date(occ.getTime() - 14 * msPerDay); if (p >= monthStart) occ = p; else break; }
      while (occ < monthStart) occ = new Date(occ.getTime() + 14 * msPerDay);
      while (occ <= monthEnd) {
        out.push(occ.getDate());
        occ = new Date(occ.getTime() + 14 * msPerDay);
      }
      break;
    }
  }
  return finalize(out, y, m);
}

function finalize(days, y, m) {
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  return uniq.map(d => ({ date: isoOf(y, m, d), day: d }));
}

/* ------------------------------------------------------------
   baseAmountFor(item, monthKey) — resolve the effective-from
   segment amount for a recurring item in a given month.
   ------------------------------------------------------------ */
function baseAmountFor(item, monthKey) {
  if (item.kind === 'oneoff') return item.amount || 0;
  if (item.kind === 'variable' && item.mode !== 'monthly') return item.amount || 0;
  const segs = (item.base || []).slice().sort((a, b) => monthKeyCmp(a.from, b.from));
  let amt = null;
  for (const s of segs) {
    if (monthKeyCmp(s.from, monthKey) <= 0) amt = s.amount;
  }
  return amt; // null means "not started yet this month" -> item shouldn't appear
}

/* ------------------------------------------------------------
   resolveMonth(monthKey) — the single source of truth for a month.
   Returns resolved events (with overrides applied), grouped and
   totalled. The ribbon and the list both render from this, so they
   can never disagree.

   { monthKey, income:[ev], bills:[ev], oneoffs:[ev],
     incomeTotal, expenseTotal, remainder }
   ev = { id, name, amount, kind, date, day }
   ------------------------------------------------------------ */
function overrideFor(item, monthKey) {
  return (item.overrides || []).find(o => o.monthKey === monthKey) || null;
}

function resolveMonth(monthKey) {
  // Frozen past months read from the snapshot verbatim.
  if (state.snapshots[monthKey]) return state.snapshots[monthKey];

  const income = [], bills = [], oneoffs = [], variables = [];
  for (const item of state.items) {
    // Forward-delete boundary: item ends at endFrom (inclusive stop).
    if (item.endFrom && monthKeyCmp(monthKey, item.endFrom) >= 0) continue;
    const occ = occurrencesInMonth(item, monthKey);
    if (!occ.length) continue;
    const ov = overrideFor(item, monthKey);
    if (ov && ov.skip) continue; // "this period only" removal

    const baseAmt = baseAmountFor(item, monthKey);
    const flatAmount = (item.kind === 'oneoff') || (item.kind === 'variable' && item.mode !== 'monthly');
    if (!flatAmount && baseAmt == null) continue; // not started yet

    const name = (ov && ov.name != null) ? ov.name : item.name;
    const amount = (ov && ov.amount != null) ? ov.amount
                 : (flatAmount ? (item.amount || 0) : baseAmt);
    // one-off direction: 'in' (income) or 'out' (expense). Default 'out' for
    // backward-compat with one-offs created before income one-offs existed.
    const oneoffDir = item.kind === 'oneoff' ? (item.dir || 'out') : null;

    for (const o of occ) {
      const ev = { id: item.id, name, amount, kind: item.kind, dir: oneoffDir, date: o.date, day: o.day };
      if (item.kind === 'income') income.push(ev);
      else if (item.kind === 'bill') bills.push(ev);
      else if (item.kind === 'variable') {
        ev.category = item.category || 'Other';
        ev.mode = item.mode || 'once';
        variables.push(ev);
      }
      else if (oneoffDir === 'in') { ev.oneoff = true; income.push(ev); }  // one-off income
      else oneoffs.push(ev);                                               // one-off expense
    }
  }
  const sortByDay = (a, b) => a.day - b.day;
  income.sort(sortByDay); bills.sort(sortByDay); oneoffs.sort(sortByDay); variables.sort(sortByDay);

  // Group variable expenses by category, each with a subtotal and its entries.
  const varGroups = groupByCategory(variables);

  const incomeTotal = round2(income.reduce((s, e) => s + e.amount, 0));
  const variableTotal = round2(variables.reduce((s, e) => s + e.amount, 0));
  const expenseTotal = round2([...bills, ...oneoffs, ...variables].reduce((s, e) => s + e.amount, 0));
  const remainder = round2(incomeTotal - expenseTotal);

  return { monthKey, income, bills, oneoffs, variables, varGroups, incomeTotal, variableTotal, expenseTotal, remainder, frozen: false };
}

/* Group variable-expense events by category → [{category, total, entries[]}] */
function groupByCategory(list) {
  const by = {};
  for (const ev of list) {
    const c = ev.category || 'Other';
    (by[c] = by[c] || []).push(ev);
  }
  return Object.keys(by).sort().map(category => ({
    category,
    total: round2(by[category].reduce((s, e) => s + e.amount, 0)),
    entries: by[category].slice().sort((a, b) => a.day - b.day)
  })).sort((a, b) => b.total - a.total); // biggest category first
}

function round2(n) { return Math.round(n * 100) / 100; }

/* ------------------------------------------------------------
   Rollover: freeze any past month that lacks a snapshot.
   Runs on load / date change. Freezes from master-data as it
   stands — by design (if she wasn't in the app, that month's
   data wasn't a truth she needed captured).
   ------------------------------------------------------------ */
function freezePastMonths() {
  const cur = todayMonthKey();
  // Determine the earliest month we have any data for, to bound the loop.
  let earliest = cur;
  for (const item of state.items) {
    if ((item.kind === 'oneoff' || item.kind === 'variable') && item.date) {
      const mk = item.date.slice(0, 7);
      if (monthKeyCmp(mk, earliest) < 0) earliest = mk;
    }
    for (const s of (item.base || [])) {
      if (monthKeyCmp(s.from, earliest) < 0) earliest = s.from;
    }
    for (const o of (item.overrides || [])) {
      if (monthKeyCmp(o.monthKey, earliest) < 0) earliest = o.monthKey;
    }
  }
  let changed = false;
  let mk = earliest;
  while (monthKeyCmp(mk, cur) < 0) {
    if (!state.snapshots[mk]) {
      const resolved = resolveMonth(mk);
      // Only snapshot months that actually had activity — avoids
      // freezing a pile of empty months before her first entry.
      if (resolved.income.length || resolved.bills.length || resolved.oneoffs.length || resolved.variables.length) {
        state.snapshots[mk] = Object.assign({}, resolved, { frozen: true, frozenAt: new Date().toISOString() });
        changed = true;
      }
    }
    mk = monthKeyAddN(mk, 1);
  }
  return changed;
}

/* Expose for tests / node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    occurrencesInMonth, resolveMonth, baseAmountFor, freezePastMonths,
    monthKeyOf, monthKeyAddN, todayMonthKey, lastBankingDayOfMonth,
    lastWeekdayOfMonth, _holidayCache, statHolidaysISO,
    get state() { return state; }, set state(v) { state = v; }
  };
}

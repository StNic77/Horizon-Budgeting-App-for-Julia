# Horizon  v1 (build `horizon-1` / sw `horizon-v1`)

A calm, forward-looking money planner. Answers, month by month: *what's
coming in, what's going out, what's left* — plus a live timeline of the
current month. No spend tracking, no bank sync, no balances. Every number
traces to something she typed.

## Files (all that ship)
- `index.html` — shell + all styles + all screens
- `core.js` — state, IndexedDB storage, date/recurrence engine, month
  resolution, history freezing
- `app.js` — rendering, timeline ribbon, add/edit sheet, scope prompt,
  onboarding
- `sw.js` — offline service worker (bump `VERSION` every release)
- `manifest.json`, `icon-192.png`, `icon-512.png` — PWA install

Zero dependencies. Plain `<script>` tags. Opens from `file://` or any
static host (GitHub Pages works the same as Ledger).

## Run it
- **Quickest:** open `index.html` in a browser. It works immediately.
- **As an installed PWA (recommended, matches her real use):** serve the
  folder over HTTPS (GitHub Pages) and "Add to Home Screen" on her phone.
  The service worker needs http(s), not `file://`, so the offline install
  only kicks in when hosted.

## The cold-open test-drive (what to try as "her")
1. First launch shows a 6-card friendly walkthrough. Skippable, and
   re-openable anytime via the **?** in the top bar.
2. Tap **+**. Add her pay: "Coming in", an amount, **Every 2 weeks**,
   pick the next payday date (defaults to the next Friday).
3. Tap **+** again. Add a pension: "Coming in", **Last banking day of the
   month** (or **Last Friday**). No date math needed from her.
4. Add a few bills: rent (**Once a month**, day 1), power (**Every 2
   months**), insurance (**Every 6 months**), etc.
5. Add a one-off: "One-time", pick a date (e.g. a summer camp).
6. Scroll the months. Watch a **three-paycheck month** appear on its own
   where the biweekly cycle lands three times.
7. On the current month, look at the **ribbon**: income dots above the
   line, expenses below, sized by amount, today's marker sweeping across.
   Tap a dot to see what it is.
8. Tap any line item to edit it. On a recurring item, saving asks **"just
   this month, or this month and every month after?"** — try both and
   watch only the right months change.

## What's proven
Three test files (kept in the dev folder, not shipped) cover:
- 22 recurrence cases incl. biweekly 3-pay months, last-banking-day
  weekend rollback, every-N-month anchoring, short-month clamping.
- 12 override cases: this-month overrides stay local; forward base
  changes anchor at the edited month; new bills starting later don't
  appear earlier; skip = this-month delete.
- 24 full-UI-flow assertions in a real DOM: the whole add/edit/scope/
  render cycle end to end.

## Known honest caveats (not bugs, just limits)
- **No pixel screenshot review was possible** in the build environment
  (no headless browser). Logic and layout math are verified; the exact
  visual feel — especially crowding when several same-day dots stack on
  the ribbon — should get a real eyeball on a phone. Easy to tune if a
  month looks busy.
- **History freezing** happens on app open: when a month passes, it's
  snapshotted from the data as it stands and never changes after. If she
  doesn't open the app for a couple of months, those months freeze from
  current data on next open — by design.
- Thresholds for the yellow "tight" zone default to $200 and live in
  `state.settings.tightThreshold` (editable; a settings UI for it is a
  small future add — right now it's a sensible default).

## If you host on GitHub Pages
Same discipline as Ledger: bump `VERSION` in `sw.js` every deploy so the
installed PWA busts its cache, and deploy all files together.

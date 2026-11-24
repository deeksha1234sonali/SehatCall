---
title: SehatCall frontend — 6-screen elderly-first healthcare reminders app
status: done
created: 2026-11-24
updated: 2026-11-24
model: deepseek-v4-flash
---

# SehatCall frontend — 6-screen elderly-first healthcare reminders app

A plain static multi-page app (HTML + CSS + JS, no build step, no framework) whose one consequential decision is **one data seam**: every screen reads and writes through `js/api.js`, which today persists to `localStorage` and, once Flask exists, becomes `fetch()` calls by flipping a single `USE_BACKEND` flag. That is what makes "connect the forms to Flask later" a mechanical change instead of a rewrite, and it is also what lets me honour "no fake buttons" — every important button writes real state that survives a reload.

Shared chrome (sidebar, topbar, icons, dialogs, toasts) is rendered from `js/ui.js` so six pages don't drift apart. Styling is two files: `design-tokens.css` (all colour, type and status tokens — the only place a hex lives) and `css/app.css` (layout and components).

Grounding it in the subject rather than a generic dashboard:
- **Colour** is a clinical teal (`#0d6e63`) on a warm-neutral surface, with teal-tinted surfaces in dark mode. Every pairing I intend to ship was already run through `check_contrast` — light and dark, body text, muted text, buttons, sidebar active state and all three status chips — and all pass AA for normal text (5.6:1 to 16.6:1). Missed reminders use a red chip, taken a green one, upcoming a blue one, so status is readable without relying on colour alone (each carries a text label too).
- **Type** is Atkinson Hyperlegible — designed by the Braille Institute specifically for low-vision readers — over a `Segoe UI` fallback for offline use. Base size 18px, not 16px, with a real "Text size" control in the sidebar (Normal / Large / Extra large, persisted) because the audience differs a lot in acuity.
- **Elderly-first interaction rules**: 48px minimum button height, no placeholder-only fields (every input keeps a visible label), plain words ("Missed", not "Overdue non-adherent"), destructive actions behind a confirm dialog with the item named, and a skip-to-content link.

Screens: login, register, dashboard (four stat cards + today's doses + upcoming appointments), medicines, appointments, reminder history. Sign-in is enforced — opening any inner page without a session lands on login with a return path, and the login page carries a "Use demo account" button that fills real credentials (`demo@sehatcall.app` / `demo1234`). First run seeds a small sample patient with medicines and history so the dashboard isn't four zeros, plus a visible "Clear sample data" button that actually wipes it.

Genuine actions, not decorations: add/edit/pause/delete a medicine, add/edit/complete/cancel an appointment, download a real `.ics` calendar file generated client-side, mark a dose taken (which writes a reminder-log row and moves the dashboard counters), back-fill a missed dose, filter history by status/date, and export that history to CSV.

I will verify by serving the folder over `http.server` and driving the real flow in the browser — login, add a medicine, mark a dose taken, add an appointment, check history — rather than assuming it renders.

## Steps

- [x] 1. Write `design-tokens.css` — the starter token system re-themed to the validated clinical-teal palette (light + dark), the semantic/status chip tokens, the Atkinson Hyperlegible type stack, and a `--font-scale` hook the text-size control drives.
- [x] 2. Write `css/app.css` — app shell (fixed sidebar, topbar, off-canvas drawer under 900px), page grid, stat cards, list/table rows that restack into cards on mobile, chips, 48px buttons, labelled form controls with inline error slots, `<dialog>`-based modal, toast, empty states, skip link and focus rings.
- [x] 3. Write `js/api.js` — the single data seam: `USE_BACKEND` flag, `localStorage` store for patients/medicines/appointments/reminder-logs, CRUD + query methods, first-run seed data, and a comment block naming the exact Flask route each method will call.
- [x] 4. Write `js/auth.js` — session get/set/clear, register (email uniqueness, validation), login (credential check, SHA-256 via `crypto.subtle` with a documented fallback for non-secure contexts), logout, and `requireAuth()` redirect-with-return-path.
- [x] 5. Write `js/ui.js` — inline SVG icon set (no emoji), sidebar/topbar shell renderer with active-route state, mobile drawer behaviour (Escape, overlay, `aria-expanded`), text-size + theme toggles persisted, toast, confirm dialog, date/time formatters, and a `?new=1` auto-open helper.
- [x] 6. Build `login.html` + `js/login.js` — email/password, real show/hide password toggle, inline validation with `aria-live` errors, demo-account fill button, and `?next=` redirect after success.
- [x] 7. Build `register.html` + `js/register.js` — full name, email, phone, date of birth, password + confirm, consent checkbox; field-level validation; success creates the patient, signs them in and lands on the dashboard.
- [x] 8. Build `index.html` + `js/dashboard.js` — patients/medicines/missed-reminders/appointments stat cards each linking to their screen, today's doses with working "Mark as taken", upcoming appointments with "Mark completed", quick-action buttons, and sample-data notice with its reset.
- [x] 9. Build `medicines.html` + `js/medicines.js` — searchable medicine list (name, dose, times, dates, notes), add/edit dialog, pause/resume, delete-with-confirm, and an empty state that opens the add form.
- [x] 10. Build `appointments.html` + `js/appointments.js` — upcoming/past sections, add/edit dialog (doctor, speciality, date, time, location, notes), mark completed, cancel, delete-with-confirm, and a working `.ics` download per appointment.
- [x] 11. Build `reminders.html` + `js/reminders.js` — reminder-log history with taken/missed/skipped chips, adherence summary, status + date-range filters, "Mark as taken" back-fill for missed doses, and a real CSV export.
- [x] 12. Write `FRONTEND-NOTES.md` — the Flask hand-off: route/method/payload table matching каждый `api.js` method, where the flag flips, what the server must own (password hashing, session cookies, real due-date generation), and how to run the static preview.
- [x] 13. Verify end to end: serve the folder on a local port, then drive login → dashboard → add medicine → mark taken → add appointment → history in the browser, fix whatever breaks, and re-check both the console and the mobile-width layout.

## Not doing

- No Flask/Python code at all — the brief says connect the backend later, so the deliverable is the frontend plus a written route contract in `FRONTEND-NOTES.md`.
- No real email/SMS/push reminder delivery: that needs a server and a service worker with a permission prompt. The history page shows scheduled-vs-taken state honestly rather than faking a "reminder sent" confirmation.
- No genuine security in the frontend auth — SHA-256 in the browser is a stand-in so the demo behaves correctly, and the notes state plainly that the server must own hashing, sessions and rate limiting.
- No separate patient-roster page: the brief lists six screens and asks for a patients *card*, which counts real registered accounts and links to registration. A multi-patient roster for caregivers would be the natural next addition, not something to slip in now.
- No calendar-month grid or drag-and-drop scheduling — a plain dated list is markedly easier for the stated audience to read.
- No build tooling, bundler or npm dependencies; everything is plain files so it can be dropped next to Flask's `templates/` and `static/` later.


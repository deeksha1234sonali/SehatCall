# SehatCall — frontend notes and Flask hand-off

The frontend is complete and works on its own. This file is what you read when
you start connecting the Flask backend.

## Run it as it is now

No build step, no dependencies. Any static server works:

```
python -m http.server 8000
```

Then open `http://localhost:8000/login.html`.

Use a server rather than opening the files directly. `file://` breaks
`crypto.subtle` (so password hashing falls back to a weaker path) and blocks the
storage APIs in some browsers.

**Demo account:** `demo@sehatcall.app` / `demo1234`, or press *Use the demo
account* on the sign-in page. First load seeds one sample patient with four
medicines, three appointments and two weeks of reminder history. The dashboard
has a *Clear sample data* button that really deletes it.

## File layout

```
design-tokens.css      every colour, type size, space and radius (the only file with a hex value)
css/app.css            layout and components; reads tokens only
js/api.js              THE DATA SEAM — all reads and writes go through here
js/auth.js             session, sign-in, registration, validators
js/ui.js               icons, sidebar shell, drawer, prefs, toast, confirm, formatters
login.html             sign-in
register.html          registration (also reachable as "Add a patient" via ?new=1)
index.html             dashboard
medicines.html         medicine management
appointments.html      appointment management
reminders.html         reminder history
```

## Connecting the backend

Everything is already in place for this. In `js/api.js`:

```js
var USE_BACKEND = false;   // flip to true
var BASE_URL = '';         // '' if Flask serves these pages, or e.g. 'http://127.0.0.1:5000'
```

Then implement the routes below. No page logic changes: every `API.*` method is
already `async` and returns plain objects, so swapping the body of a method for a
`fetch` call is invisible to the rest of the app.

Requests are sent with `credentials: 'include'`, so set a session cookie and
make sure CORS allows credentials if the backend runs on another origin.

### Route contract

| API method | Method | Route | Payload / notes |
| --- | --- | --- | --- |
| `listPatients()` | GET | `/api/patients` | Must **never** include `passwordHash` |
| `countPatients()` | GET | `/api/patients` | Could become a `COUNT(*)` later |
| `getPatient(id)` | GET | `/api/patients/<id>` | `404` if missing |
| `createPatient(payload)` | POST | `/api/patients` | `{name, email, phone, dob, passwordHash}` — see *security* below |
| `listMedicines(patientId, opts)` | GET | `/api/medicines?patient_id=&active=1` | sorted by name |
| `createMedicine(patientId, payload)` | POST | `/api/medicines` | `{patient_id, name, dose, times[], startDate, endDate, notes, active}` |
| `updateMedicine(id, patch)` | PATCH | `/api/medicines/<id>` | partial; `active` is the pause/resume toggle |
| `deleteMedicine(id)` | DELETE | `/api/medicines/<id>` | keep reminder history, set `medicineDeleted` |
| `listAppointments(patientId)` | GET | `/api/appointments?patient_id=` | |
| `createAppointment(patientId, payload)` | POST | `/api/appointments` | `{patient_id, doctor, speciality, date, time, location, notes}` |
| `updateAppointment(id, patch)` | PATCH | `/api/appointments/<id>` | `status` is one of `scheduled`/`completed`/`cancelled` |
| `deleteAppointment(id)` | DELETE | `/api/appointments/<id>` | |
| `listLogs(patientId, filters)` | GET | `/api/reminders?patient_id=&status=&from=&to=` | newest first |
| `markDose(patientId, entry)` | POST | `/api/reminders` | **upsert** on `(medicine_id, scheduled_date, scheduled_time)` |
| `todayDoses(patientId)` | GET | `/api/reminders/today?patient_id=` | resolved rows, see below |
| `getCounts(patientId)` | GET | `/api/dashboard/summary?patient_id=` | `{patients, medicines, dosesToday, takenToday, missed, appointments, nextAppointment}` |
| `adherenceSummary(patientId, from, to)` | GET | `/api/reminders/summary?patient_id=&from=&to=` | `{total, taken, missed, skipped, adherence}` |
| `dismissSampleNotice()` | POST | `/api/patients/me/dismiss-sample-notice` | |
| `clearSampleData(patientId)` | POST | `/api/patients/<id>/clear-sample-data` | deletes only rows with `sample = true` |
| `resetEverything()` | POST | `/api/dev/reset` | remove this route in production |

Dates are `YYYY-MM-DD`, times are `HH:MM` 24-hour local. Match that exactly —
the frontend formats them for display itself.

### Doses are derived, not stored ahead of time

There is no scheduler in a browser, so `API.reconcileLogs()` walks back 14 days
and materialises a `missed` row for every scheduled dose whose time has passed
with no record. That is what makes "Missed reminders" a real number that the
user can act on rather than an invented one.

The server should own this instead. Two honest options:

1. **Keep it derived** — compute missed rows in the `GET /api/reminders` handler
   with the same 14-day window, and `POST /api/reminders` upserts onto them. This
   is the smallest change and behaves identically.
2. **Real scheduler** — a cron job or APScheduler task writes one row per due
   dose, and the query simply reads rows. Better, because it then survives
   changes to a medicine's schedule.

Either way `GET /api/reminders/today` must return resolved rows, not raw
schedules:

```json
[{ "medicineId": "med_1", "medicineName": "Metformin", "dose": "500 mg",
   "scheduledDate": "2024-05-14", "scheduledTime": "08:00",
   "status": "taken", "logId": "log_9" }]
```

`status` is `taken` | `missed` | `skipped` | `upcoming`.

## What the server must own (do not skip this)

The current auth is a **demo stand-in, not security**, and the notes below are
the difference between the two.

- **Password hashing.** The browser sends a SHA-256 of `password + pepper`. That
  is not an acceptable stored password: it is fast to brute-force, and the
  pepper ships to the user in `js/api.js`. The server must re-hash with
  `bcrypt` or `argon2` and store only that. The cleanest path is to have
  `createPatient` accept the raw password over HTTPS and drop `passwordHash`
  from the payload entirely.
- **Sessions.** Replace the `localStorage` session in `js/auth.js` with a real
  server session in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Then delete
  `Auth.login` and have the login form POST to `/api/session`. `localStorage` is
  readable by any script on the page, so it cannot hold a credential.
- **Authorisation.** Every `/api/*` route needs to check that the session's
  patient owns the `patient_id` in the request. The frontend redirect guard stops
  an honest user from wandering into the wrong page; it stops an attacker from
  nothing.
- **Rate limiting** on login and registration, and **email verification** before
  an account can be used for anything.
- **Validation.** The rules in `Auth.validators` are there for good error
  messages, not as a security boundary. Re-validate everything server-side.

## Deliberately not built

- **No real reminder delivery** (email, SMS, push). The history page shows what
  was scheduled against what was recorded; it never claims a reminder was *sent*.
  Adding this means a scheduler plus a service worker for push, or an SMS
  provider.
- **No multi-patient roster.** "Registered patients" counts accounts. A
  caregiver managing several family members needs a proper patient switcher, and
  the data model already supports it (`patientId` on every row) — only the UI is
  missing.
- **No calendar month grid.** A dated list is easier for the target audience.
- **No build tooling.** Plain files on purpose, so they can be dropped next to
  Flask's `templates/` and `static/` with minimal changes. If you do move them,
  the `/design-tokens.css` and `/css/app.css` paths in each page are absolute —
  point them at Flask's `url_for('static', ...)` or keep serving them from the
  same root.

## Accessibility decisions worth keeping

These were chosen for elderly and low-vision users and are easy to undo by
accident:

- Base font size is 18px (`.text-base: 1.125rem`), not 16px. All sizes are `rem`
  so the sidebar's text-size control works by changing one `--font-scale`.
- Atkinson Hyperlegible, drawn by the Braille Institute for low vision. Falls
  back to Segoe UI.
- Every colour pairing that ships was measured for WCAG contrast: lowest is
  5.6:1, most are 7:1 or better, in both light and dark. Re-check with a contrast
  tool if you change a token.
- 48px minimum tap target on everything clickable.
- Icons are inline SVG, never emoji (emoji are announced as words and cannot be
  recoloured).
- Every input has a visible `<label>` — no placeholder-only fields.
- Status is a chip with a word in it, never colour alone.
- Destructive actions name the item being destroyed in the confirm dialog.
- Times display as 12-hour with AM/PM even though they are stored 24-hour.

/*
  SehatCall -- data layer.

  This file is the single seam between the UI and storage. Every screen talks
  to `API.*` and nothing else; no page reads localStorage or calls fetch on
  its own. That is deliberate: when the Flask backend exists, you flip
  USE_BACKEND to true below, point BASE_URL at the server, and the same UI
  code keeps working. Nothing else changes.

  Every method is `async` even though the local implementations are
  synchronous. That is what makes the swap to network calls non-breaking.

  ---------------------------------------------------------------------------
  Flask route contract (see FRONTEND-NOTES.md for payloads)
  ---------------------------------------------------------------------------
    listPatients            GET    /api/patients
    getPatient              GET    /api/patients/<id>
    findPatientByEmail      (server-side only -- never expose this as a route)
    createPatient           POST   /api/patients
    listMedicines           GET    /api/medicines?patient_id=&active=
    createMedicine          POST   /api/medicines
    updateMedicine          PATCH  /api/medicines/<id>
    deleteMedicine          DELETE /api/medicines/<id>
    listAppointments        GET    /api/appointments?patient_id=
    createAppointment       POST   /api/appointments
    updateAppointment       PATCH  /api/appointments/<id>
    deleteAppointment       DELETE /api/appointments/<id>
    listLogs                GET    /api/reminders?patient_id=&status=&from=&to=
    markDose                POST   /api/reminders
    todayDoses              GET    /api/reminders/today?patient_id=
    getCounts               GET    /api/dashboard/summary?patient_id=
    adherenceSummary        GET    /api/reminders/summary?patient_id=&from=&to=
    clearSampleData         POST   /api/patients/<id>/clear-sample-data
*/

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------------
     The switch. Set to true once Flask is serving the routes above.
     --------------------------------------------------------------------------- */
  var USE_BACKEND = true;
  var BASE_URL = ''; // e.g. 'http://127.0.0.1:5000' when the backend runs apart

  var STORAGE_KEY = 'sehatcall.v1';
  var SCHEMA_VERSION = 1;

  /* How far back the app materialises reminder rows. Without a scheduler on
     the server, "missed" has to be derived: any scheduled dose whose time has
     passed with no record becomes a missed row. Fourteen days is enough for a
     useful adherence picture without generating thousands of rows. */
  var LOG_WINDOW_DAYS = 14;

  var DEMO_EMAIL = 'demo@sehatcall.app';
  var DEMO_PASSWORD = 'demo1234';

  /* ---------------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------------- */

  function uid(prefix) {
    var rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rand;
  }

  /* Local-date ISO (YYYY-MM-DD). Deliberately NOT toISOString(), which is UTC
     and would shift the day either side of midnight -- a dose logged at 11pm
     would land on tomorrow's list. */
  function toISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function addDays(iso, days) {
    var parts = iso.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  /* "HH:MM" -> minutes since midnight, for ordering and past/future checks. */
  function timeToMinutes(t) {
    var parts = String(t || '00:00').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function normaliseTime(t) {
    var parts = String(t || '').split(':');
    if (parts.length < 2) return '00:00';
    return String(parts[0]).padStart(2, '0') + ':' + String(parts[1]).padStart(2, '0');
  }

  /* SHA-256 of the password plus a constant pepper.

     THIS IS NOT SECURITY. It exists so the demo behaves like a real login --
     the stored value is never the plaintext, and a wrong password fails.
     A browser cannot keep a secret, so the Flask server must re-hash with
     bcrypt/argon2 and own the session entirely. See FRONTEND-NOTES.md. */
  var PEPPER = 'sehatcall-frontend-v1';

  function fallbackHash(text) {
    /* Only used when crypto.subtle is unavailable (non-secure context).
       FNV-1a, widened -- weak, and named as weak on purpose. */
    var h1 = 0x811c9dc5;
    var h2 = 0x1000193;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      h1 = (h1 ^ c) * 0x01000193;
      h2 = (h2 ^ (c + i)) * 0x85ebca6b;
      h1 >>>= 0;
      h2 >>>= 0;
    }
    return 'weak:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  async function hashPassword(password) {
    var input = PEPPER + '|' + String(password);
    if (global.crypto && global.crypto.subtle && global.TextEncoder) {
      try {
        var bytes = new TextEncoder().encode(input);
        var digest = await global.crypto.subtle.digest('SHA-256', bytes);
        var hex = Array.from(new Uint8Array(digest))
          .map(function (b) { return b.toString(16).padStart(2, '0'); })
          .join('');
        return 'sha256:' + hex;
      } catch (err) {
        /* fall through to the weak hash */
      }
    }
    return fallbackHash(input);
  }

  /* ---------------------------------------------------------------------------
     Storage
     ---------------------------------------------------------------------------
     One blob, written atomically. Separate keys would let the medicines array
     and the reminder log disagree after a failed write, and the whole point of
     this layer is that it never hands the UI inconsistent data.
     --------------------------------------------------------------------------- */

  var memoryOnly = false;
  var memoryStore = null;

  function emptyStore() {
    return {
      version: SCHEMA_VERSION,
      patients: [],
      medicines: [],
      appointments: [],
      logs: [],
      meta: { seeded: false, sampleNoticeDismissed: false, sampleCleared: false },
    };
  }

  function read() {
    if (memoryOnly) return memoryStore || (memoryStore = emptyStore());
    var raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      /* Private browsing / disabled storage: degrade to memory rather than
         throwing on every page. The UI keeps working for this session. */
      memoryOnly = true;
      memoryStore = emptyStore();
      return memoryStore;
    }
    if (!raw) return emptyStore();
    try {
      var parsed = JSON.parse(raw);
      var base = emptyStore();
      return {
        version: parsed.version || SCHEMA_VERSION,
        patients: parsed.patients || base.patients,
        medicines: parsed.medicines || base.medicines,
        appointments: parsed.appointments || base.appointments,
        logs: parsed.logs || base.logs,
        meta: Object.assign(base.meta, parsed.meta || {}),
      };
    } catch (err) {
      return emptyStore();
    }
  }

  function write(store) {
    if (memoryOnly) {
      memoryStore = store;
      return;
    }
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      memoryOnly = true;
      memoryStore = store;
    }
  }

  /* ---------------------------------------------------------------------------
     Backend transport
     --------------------------------------------------------------------------- */

  async function http(method, path, body) {
    var res = await fetch(BASE_URL + path, {
      method: method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      var payload = null;
      try { payload = await res.json(); } catch (err) { /* not JSON */ }
      var message = (payload && (payload.error || payload.message)) || 'Request failed (' + res.status + ')';
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /* ---------------------------------------------------------------------------
     Seed data
     ---------------------------------------------------------------------------
     A brand-new install would otherwise show four zeroes, an empty list and no
     way to tell whether the app works. The seed creates ONE demo account with
     a realistic medication list, a couple of appointments and two weeks of
     reminder history including a few genuine misses. It is clearly labelled as
     sample data in the UI, and the dashboard offers a button that really
     deletes it.
     --------------------------------------------------------------------------- */

  async function seedDemo() {
    var store = read();
    if (store.meta.seeded) return store;

    var passwordHash = await hashPassword(DEMO_PASSWORD);
    var patientId = uid('pat');
    var today = todayISO();

    var patient = {
      id: patientId,
      name: 'Meera Sharma',
      email: DEMO_EMAIL,
      phone: '+91 98200 41122',
      dob: '1952-03-14',
      passwordHash: passwordHash,
      createdAt: new Date().toISOString(),
      sample: true,
    };

    var medicines = [
      {
        id: uid('med'), patientId: patientId, name: 'Metformin', dose: '500 mg',
        times: ['08:00', '20:00'], startDate: addDays(today, -60), endDate: null,
        notes: 'Take with food. For blood sugar control.', active: true, sample: true,
      },
      {
        id: uid('med'), patientId: patientId, name: 'Amlodipine', dose: '5 mg',
        times: ['09:00'], startDate: addDays(today, -45), endDate: null,
        notes: 'One tablet after breakfast. For blood pressure.', active: true, sample: true,
      },
      {
        id: uid('med'), patientId: patientId, name: 'Atorvastatin', dose: '10 mg',
        times: ['21:00'], startDate: addDays(today, -30), endDate: null,
        notes: 'Take after dinner.', active: true, sample: true,
      },
      {
        id: uid('med'), patientId: patientId, name: 'Vitamin D3', dose: '1000 IU',
        times: ['09:00'], startDate: addDays(today, -20), endDate: addDays(today, 10),
        notes: 'Short course. Stop when the box is finished.', active: true, sample: true,
      },
    ];

    var appointments = [
      {
        id: uid('apt'), patientId: patientId, doctor: 'Dr. Anita Rao',
        speciality: 'Cardiologist', date: addDays(today, 3), time: '10:30',
        location: 'City Heart Clinic, Room 4',
        notes: 'Bring the blood pressure diary.', status: 'scheduled', sample: true,
      },
      {
        id: uid('apt'), patientId: patientId, doctor: 'Dr. Farhan Ali',
        speciality: 'Diabetes clinic', date: addDays(today, 12), time: '15:00',
        location: 'Sunrise Medical Centre, Block B',
        notes: 'Fasting sugar test one day before.', status: 'scheduled', sample: true,
      },
      {
        id: uid('apt'), patientId: patientId, doctor: 'Dr. Anita Rao',
        speciality: 'Cardiologist', date: addDays(today, -21), time: '11:00',
        location: 'City Heart Clinic, Room 4',
        notes: 'Routine review. Dose unchanged.', status: 'completed', sample: true,
      },
    ];

    /* Two weeks of history, with two realistic gaps so "missed reminders" is
       not a decorative zero: the evening Metformin was skipped four days ago
       and again eight days ago. Today's earlier doses are recorded as taken so
       the dashboard has something true to show on first open. */
    var logs = [];
    var missedOffsets = { 4: '20:00', 8: '20:00' };
    for (var offset = LOG_WINDOW_DAYS - 1; offset >= 0; offset--) {
      var date = addDays(today, -offset);
      var nowM = nowMinutes();
      for (var i = 0; i < medicines.length; i++) {
        var med = medicines[i];
        if (date < med.startDate) continue;
        if (med.endDate && date > med.endDate) continue;
        for (var j = 0; j < med.times.length; j++) {
          var time = med.times[j];
          if (offset === 0 && timeToMinutes(time) > nowM) continue; // not due yet
          var missed = missedOffsets[offset] === time && med.name === 'Metformin';
          logs.push({
            id: uid('log'),
            patientId: patientId,
            medicineId: med.id,
            medicineName: med.name,
            dose: med.dose,
            scheduledDate: date,
            scheduledTime: time,
            status: missed ? 'missed' : 'taken',
            recordedAt: missed ? null : new Date(date + 'T' + time + ':00').toISOString(),
            auto: false,
            sample: true,
          });
        }
      }
    }

    store.patients.push(patient);
    store.medicines = store.medicines.concat(medicines);
    store.appointments = store.appointments.concat(appointments);
    store.logs = store.logs.concat(logs);
    store.meta.seeded = true;
    write(store);
    return store;
  }

  /* ---------------------------------------------------------------------------
     Derived reminder rows
     ---------------------------------------------------------------------------
     Real reminder systems have a scheduler writing a row per due dose. There is
     no server here, so the same result is computed on read: walk back over the
     window, and for every scheduled dose whose time has passed with no record,
     materialise a `missed` row. That keeps "missed" honest -- it is a real
     record the user can then mark as taken -- instead of a number invented by
     the dashboard.
     --------------------------------------------------------------------------- */

  function inSchedule(med, dateISO) {
    if (!med.active) return false;
    if (med.startDate && dateISO < med.startDate) return false;
    if (med.endDate && dateISO > med.endDate) return false;
    return true;
  }

  function reconcileLogs(patientId) {
    var store = read();
    var now = new Date();
    var today = todayISO();
    var nowM = nowMinutes();
    var changed = false;
    var mine = store.medicines.filter(function (m) {
      return m.patientId === patientId;
    });

    /* Index existing rows so this stays linear rather than n*m per day. */
    var seen = Object.create(null);
    store.logs.forEach(function (l) {
      if (l.patientId !== patientId) return;
      seen[l.medicineId + '|' + l.scheduledDate + '|' + l.scheduledTime] = true;
    });

    for (var offset = LOG_WINDOW_DAYS - 1; offset >= 0; offset--) {
      var date = addDays(today, -offset);
      for (var i = 0; i < mine.length; i++) {
        var med = mine[i];
        if (!inSchedule(med, date)) continue;
        for (var j = 0; j < med.times.length; j++) {
          var time = normaliseTime(med.times[j]);
          if (offset === 0 && timeToMinutes(time) > nowM) continue;
          var key = med.id + '|' + date + '|' + time;
          if (seen[key]) continue;
          seen[key] = true;
          store.logs.push({
            id: uid('log'),
            patientId: patientId,
            medicineId: med.id,
            medicineName: med.name,
            dose: med.dose,
            scheduledDate: date,
            scheduledTime: time,
            status: 'missed',
            recordedAt: null,
            auto: true,
            sample: !!med.sample,
          });
          changed = true;
        }
      }
    }

    if (changed) write(store);
    return store;
  }

  function sortByDateTime(a, b) {
    var ka = (a.scheduledDate || a.date || '') + ' ' + (a.scheduledTime || a.time || '');
    var kb = (b.scheduledDate || b.date || '') + ' ' + (b.scheduledTime || b.time || '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  /* ---------------------------------------------------------------------------
     Public API
     --------------------------------------------------------------------------- */

  var API = {
    USE_BACKEND: USE_BACKEND,
    DEMO_EMAIL: DEMO_EMAIL,
    DEMO_PASSWORD: DEMO_PASSWORD,
    hashPassword: hashPassword,
    toISODate: toISODate,
    todayISO: todayISO,
    addDays: addDays,
    timeToMinutes: timeToMinutes,
    nowMinutes: nowMinutes,
    normaliseTime: normaliseTime,

    /* Called once per page load before anything renders. */
    async init() {
      if (USE_BACKEND) return;
      await seedDemo();
    },

    /* -- session / login -------------------------------------------------- */

    /* In backend mode this POSTs to /api/session and the server owns the real
       password check. Locally it reproduces the old credential check so the
       same UI keeps working without Flask. */
    async login(email, password) {
      if (USE_BACKEND) {
        return http('POST', '/api/session', { email: email, password: password });
      }
      var patient = API._findPatientForAuth(email);
      if (!patient) {
        throw new Error('That email and password do not match. Please try again.');
      }
      var hash = await hashPassword(password);
      if (hash !== patient.passwordHash) {
        throw new Error('That email and password do not match. Please try again.');
      }
      var copy = Object.assign({}, patient);
      delete copy.passwordHash;
      return copy;
    },

    /* -- patients ---------------------------------------------------------- */

    async listPatients() {
      if (USE_BACKEND) return http('GET', '/api/patients');
      return read().patients.map(function (p) {
        var copy = Object.assign({}, p);
        delete copy.passwordHash;
        return copy;
      });
    },

    async countPatients() {
      if (USE_BACKEND) {
        var rows = await http('GET', '/api/patients');
        return rows.length;
      }
      return read().patients.length;
    },

    async getPatient(id) {
      if (USE_BACKEND) return http('GET', '/api/patients/' + encodeURIComponent(id));
      var p = read().patients.find(function (x) { return x.id === id; });
      if (!p) return null;
      var copy = Object.assign({}, p);
      delete copy.passwordHash;
      return copy;
    },

    /* Used by auth. Returns the record including passwordHash, so it is local
       to this module's callers and must never be handed to a template. In
       backend mode login is a POST and this never runs. */
    async _findPatientForAuth(email) {
      var target = String(email || '').trim().toLowerCase();
      return read().patients.find(function (p) {
        return String(p.email).toLowerCase() === target;
      }) || null;
    },

    async createPatient(payload) {
      if (USE_BACKEND) return http('POST', '/api/patients', payload);
      var store = read();
      var email = String(payload.email || '').trim().toLowerCase();
      if (store.patients.some(function (p) { return String(p.email).toLowerCase() === email; })) {
        throw new Error('An account already exists with that email address.');
      }
      var patient = {
        id: uid('pat'),
        name: String(payload.name || '').trim(),
        email: email,
        phone: String(payload.phone || '').trim(),
        dob: payload.dob || '',
        passwordHash: payload.passwordHash,
        createdAt: new Date().toISOString(),
        sample: false,
      };
      store.patients.push(patient);
      write(store);
      var copy = Object.assign({}, patient);
      delete copy.passwordHash;
      return copy;
    },

    /* -- medicines --------------------------------------------------------- */

    async listMedicines(patientId, opts) {
      if (USE_BACKEND) {
        var q = '/api/medicines?patient_id=' + encodeURIComponent(patientId);
        if (opts && opts.activeOnly) q += '&active=1';
        return http('GET', q);
      }
      var activeOnly = opts && opts.activeOnly;
      return read().medicines
        .filter(function (m) {
          return m.patientId === patientId && (!activeOnly || m.active);
        })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
    },

    async createMedicine(patientId, payload) {
      if (USE_BACKEND) return http('POST', '/api/medicines', Object.assign({ patient_id: patientId }, payload));
      var store = read();
      var med = {
        id: uid('med'),
        patientId: patientId,
        name: String(payload.name || '').trim(),
        dose: String(payload.dose || '').trim(),
        times: (payload.times || []).map(normaliseTime),
        startDate: payload.startDate || todayISO(),
        endDate: payload.endDate || null,
        notes: String(payload.notes || '').trim(),
        active: payload.active !== false,
        sample: false,
      };
      store.medicines.push(med);
      write(store);
      /* Fill in any dose that is already due today, so a medicine added at
         9am appears correctly on today's list rather than silently missing
         its first slot. */
      reconcileLogs(patientId);
      return med;
    },

    async updateMedicine(id, patch) {
      if (USE_BACKEND) return http('PATCH', '/api/medicines/' + encodeURIComponent(id), patch);
      var store = read();
      var med = store.medicines.find(function (m) { return m.id === id; });
      if (!med) throw new Error('That medicine could not be found.');
      Object.assign(med, patch);
      if (patch.times) med.times = patch.times.map(normaliseTime);
      write(store);
      return med;
    },

    async deleteMedicine(id) {
      if (USE_BACKEND) return http('DELETE', '/api/medicines/' + encodeURIComponent(id));
      var store = read();
      store.medicines = store.medicines.filter(function (m) { return m.id !== id; });
      /* Reminder history is deliberately kept: it records what actually
         happened, and it already carries a copy of the medicine name, so the
         history page still reads correctly afterwards. */
      store.logs.forEach(function (l) {
        if (l.medicineId === id) l.medicineDeleted = true;
      });
      write(store);
      return true;
    },

    /* -- appointments ------------------------------------------------------ */

    async listAppointments(patientId) {
      if (USE_BACKEND) return http('GET', '/api/appointments?patient_id=' + encodeURIComponent(patientId));
      return read().appointments
        .filter(function (a) { return a.patientId === patientId; })
        .sort(sortByDateTime);
    },

    async createAppointment(patientId, payload) {
      if (USE_BACKEND) {
        return http('POST', '/api/appointments', Object.assign({ patient_id: patientId }, payload));
      }
      var store = read();
      var apt = {
        id: uid('apt'),
        patientId: patientId,
        doctor: String(payload.doctor || '').trim(),
        speciality: String(payload.speciality || '').trim(),
        date: payload.date,
        time: normaliseTime(payload.time || '09:00'),
        location: String(payload.location || '').trim(),
        notes: String(payload.notes || '').trim(),
        status: 'scheduled',
        sample: false,
        createdAt: new Date().toISOString(),
      };
      store.appointments.push(apt);
      write(store);
      return apt;
    },

    async updateAppointment(id, patch) {
      if (USE_BACKEND) return http('PATCH', '/api/appointments/' + encodeURIComponent(id), patch);
      var store = read();
      var apt = store.appointments.find(function (a) { return a.id === id; });
      if (!apt) throw new Error('That appointment could not be found.');
      Object.assign(apt, patch);
      if (patch.time) apt.time = normaliseTime(patch.time);
      write(store);
      return apt;
    },

    async deleteAppointment(id) {
      if (USE_BACKEND) return http('DELETE', '/api/appointments/' + encodeURIComponent(id));
      var store = read();
      store.appointments = store.appointments.filter(function (a) { return a.id !== id; });
      write(store);
      return true;
    },

    /* -- reminder log ------------------------------------------------------ */

    async listLogs(patientId, filters) {
      if (USE_BACKEND) {
        var params = ['patient_id=' + encodeURIComponent(patientId)];
        if (filters && filters.status && filters.status !== 'all') params.push('status=' + encodeURIComponent(filters.status));
        if (filters && filters.from) params.push('from=' + encodeURIComponent(filters.from));
        if (filters && filters.to) params.push('to=' + encodeURIComponent(filters.to));
        return http('GET', '/api/reminders?' + params.join('&'));
      }

      var store = reconcileLogs(patientId);
      var from = filters && filters.from;
      var to = filters && filters.to;
      var status = filters && filters.status;

      return store.logs
        .filter(function (l) {
          if (l.patientId !== patientId) return false;
          if (status && status !== 'all' && l.status !== status) return false;
          if (from && l.scheduledDate < from) return false;
          if (to && l.scheduledDate > to) return false;
          return true;
        })
        .sort(function (a, b) { return sortByDateTime(b, a); }); // newest first
    },

    /* Record a dose as taken / skipped. Upserts on the (medicine, date, time)
       slot so marking an auto-generated `missed` row as taken corrects it
       rather than adding a duplicate. */
    async markDose(patientId, entry) {
      if (USE_BACKEND) {
        return http('POST', '/api/reminders', Object.assign({ patient_id: patientId }, entry));
      }
      var store = read();
      var date = entry.scheduledDate || todayISO();
      var time = normaliseTime(entry.scheduledTime);
      var row = store.logs.find(function (l) {
        return (
          l.patientId === patientId &&
          l.medicineId === entry.medicineId &&
          l.scheduledDate === date &&
          l.scheduledTime === time
        );
      });
      if (row) {
        row.status = entry.status || 'taken';
        row.recordedAt = new Date().toISOString();
        row.auto = false;
        row.note = entry.note || row.note || '';
      } else {
        row = {
          id: uid('log'),
          patientId: patientId,
          medicineId: entry.medicineId,
          medicineName: entry.medicineName || '',
          dose: entry.dose || '',
          scheduledDate: date,
          scheduledTime: time,
          status: entry.status || 'taken',
          recordedAt: new Date().toISOString(),
          auto: false,
          note: entry.note || '',
          sample: false,
        };
        store.logs.push(row);
      }
      write(store);
      return row;
    },

    /* Today's schedule, resolved against the log so each row knows whether it
       is already taken, missed, or still upcoming. */
    async todayDoses(patientId) {
      if (USE_BACKEND) return http('GET', '/api/reminders/today?patient_id=' + encodeURIComponent(patientId));

      var date = todayISO();
      var store = reconcileLogs(patientId);
      var nowM = nowMinutes();

      var meds = store.medicines.filter(function (m) { return inSchedule(m, date) && m.patientId === patientId; });

      var doses = [];
      meds.forEach(function (med) {
        med.times.forEach(function (rawTime) {
          var time = normaliseTime(rawTime);
          var log = store.logs.find(function (l) {
            return l.patientId === patientId && l.medicineId === med.id &&
              l.scheduledDate === date && l.scheduledTime === time;
          });
          var status;
          if (log && log.status === 'taken') status = 'taken';
          else if (log && log.status === 'skipped') status = 'skipped';
          else if (log && log.status === 'missed') status = 'missed';
          else status = timeToMinutes(time) > nowM ? 'upcoming' : 'missed';

          doses.push({
            medicineId: med.id,
            medicineName: med.name,
            dose: med.dose,
            notes: med.notes,
            scheduledDate: date,
            scheduledTime: time,
            status: status,
            logId: log ? log.id : null,
          });
        });
      });

      return doses.sort(function (a, b) {
        return timeToMinutes(a.scheduledTime) - timeToMinutes(b.scheduledTime);
      });
    },

    /* -- dashboard aggregates --------------------------------------------- */

    async getCounts(patientId) {
      if (USE_BACKEND) return http('GET', '/api/dashboard/summary?patient_id=' + encodeURIComponent(patientId));

      var store = reconcileLogs(patientId);
      var today = todayISO();
      var nowM = nowMinutes();

      var medicines = store.medicines.filter(function (m) { return m.patientId === patientId && m.active; });

      var dosesToday = 0;
      medicines.forEach(function (m) {
        if (inSchedule(m, today)) dosesToday += m.times.length;
      });

      var takenToday = store.logs.filter(function (l) {
        return l.patientId === patientId && l.status === 'taken' && l.scheduledDate === today;
      }).length;

      /* Missed = rows still outstanding. Excludes future slots so the number
         is a real backlog the user can act on, not a count of things that
         have not happened yet. */
      var missed = store.logs.filter(function (l) {
        if (l.patientId !== patientId || l.status !== 'missed') return false;
        if (l.scheduledDate < today) return true;
        return l.scheduledDate === today && timeToMinutes(l.scheduledTime) <= nowM;
      }).length;

      var upcomingAppointments = store.appointments.filter(function (a) {
        return a.patientId === patientId && a.status === 'scheduled' && a.date >= today;
      }).length;

      var nextAppointment = store.appointments
        .filter(function (a) { return a.patientId === patientId && a.status === 'scheduled' && a.date >= today; })
        .sort(sortByDateTime)[0] || null;

      return {
        patients: store.patients.length,
        medicines: medicines.length,
        medicinesTotal: store.medicines.filter(function (m) { return m.patientId === patientId; }).length,
        dosesToday: dosesToday,
        takenToday: takenToday,
        missed: missed,
        appointments: upcomingAppointments,
        nextAppointment: nextAppointment,
      };
    },

    async adherenceSummary(patientId, from, to) {
      if (USE_BACKEND) {
        return http('GET', '/api/reminders/summary?patient_id=' + encodeURIComponent(patientId) +
          '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
      }
      var store = reconcileLogs(patientId);
      var rows = store.logs.filter(function (l) {
        return l.patientId === patientId && l.scheduledDate >= from && l.scheduledDate <= to;
      });
      var taken = rows.filter(function (l) { return l.status === 'taken'; }).length;
      var missed = rows.filter(function (l) { return l.status === 'missed'; }).length;
      var skipped = rows.filter(function (l) { return l.status === 'skipped'; }).length;
      var total = rows.length;
      return {
        total: total,
        taken: taken,
        missed: missed,
        skipped: skipped,
        adherence: total ? Math.round((taken / total) * 100) : 0,
      };
    },

    /* -- sample data control ---------------------------------------------- */

    async isSampleNoticeVisible(patientId) {
      var store = read();
      if (store.meta.sampleNoticeDismissed) return false;
      var patient = store.patients.find(function (p) { return p.id === patientId; });
      return !!(patient && patient.sample);
    },

    async dismissSampleNotice() {
      if (USE_BACKEND) return http('POST', '/api/patients/me/dismiss-sample-notice');
      var store = read();
      store.meta.sampleNoticeDismissed = true;
      write(store);
      return true;
    },

    async clearSampleData(patientId) {
      if (USE_BACKEND) return http('POST', '/api/patients/' + encodeURIComponent(patientId) + '/clear-sample-data');
      var store = read();
      var removed = 0;
      store.medicines = store.medicines.filter(function (m) {
        var kill = m.patientId === patientId && m.sample;
        if (kill) removed++;
        return !kill;
      });
      store.appointments = store.appointments.filter(function (a) {
        return !(a.patientId === patientId && a.sample);
      });
      store.logs = store.logs.filter(function (l) {
        return !(l.patientId === patientId && l.sample);
      });
      /* Keeps the account itself -- the user stays signed in and lands on an
         empty, honest dashboard they can fill with their own details. */
      var patient = store.patients.find(function (p) { return p.id === patientId; });
      if (patient) patient.sample = false;
      store.meta.sampleCleared = true;
      store.meta.sampleNoticeDismissed = true;
      write(store);
      return { removed: removed };
    },

    /* Destructive, and only reachable from the account footer. Clears
       everything for this browser. */
    async resetEverything() {
      if (USE_BACKEND) return http('POST', '/api/dev/reset');
      if (memoryOnly) memoryStore = emptyStore();
      else global.localStorage.removeItem(STORAGE_KEY);
      return true;
    },
  };

  global.API = API;
})(window);

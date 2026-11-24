/*
  SehatCall -- authentication and form validation.

  IMPORTANT: this is frontend authentication only. It exists so the interface
  behaves correctly (register, sign in, protected pages, sign out). It is not
  secure, and it cannot be: the browser ships the checking code to the user.
  The Flask server must own hashing (bcrypt/argon2), sessions (HttpOnly
  cookie), email verification and rate limiting. See FRONTEND-NOTES.md.

  What it does do honestly:
   - a wrong password fails, and the failure is not silent;
   - a duplicate email cannot register twice;
   - the stored password is a hash, never the plaintext;
   - every inner page is actually gated, with a return path after sign-in.
*/

(function (global) {
  'use strict';

  var SESSION_KEY = 'sehatcall.session.v1';
  var api = global.API;

  function readSession() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.patientId) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      global.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) {
      /* Storage unavailable: the session lives for this page only, which is
         an acceptable degradation -- better than throwing on login. */
    }
  }

  function clearSession() {
    try {
      global.localStorage.removeItem(SESSION_KEY);
    } catch (err) { /* ignore */ }
  }

  /* ---------------------------------------------------------------------------
     Validation
     ---------------------------------------------------------------------------
     Each validator returns null when valid, or a sentence the user can act on.
     The messages avoid jargon and say what to do, not what went wrong.
     --------------------------------------------------------------------------- */

  var validators = {
    name: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter your full name.';
      if (v.length < 2) return 'Please enter at least 2 characters.';
      if (v.length > 80) return 'That name is too long (80 characters maximum).';
      return null;
    },

    email: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter your email address.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        return 'Please enter a valid email address, for example name@example.com';
      }
      return null;
    },

    phone: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter your phone number.';
      var digits = v.replace(/[^0-9]/g, '');
      if (digits.length < 7) return 'Please enter a complete phone number.';
      if (digits.length > 15) return 'That phone number looks too long.';
      return null;
    },

    dob: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter your date of birth.';
      var d = new Date(v + 'T00:00:00');
      if (isNaN(d.getTime())) return 'Please enter a valid date.';
      var now = new Date();
      if (d > now) return 'Date of birth cannot be in the future.';
      var age = (now - d) / (1000 * 60 * 60 * 24 * 365.25);
      if (age > 120) return 'Please check the year of birth.';
      return null;
    },

    password: function (value) {
      var v = String(value || '');
      if (!v) return 'Please choose a password.';
      if (v.length < 8) return 'Please use at least 8 characters.';
      return null;
    },

    /* Sign-in is deliberately relaxed compared with registration: an existing
       account should never be locked out by a rule changed after it was made. */
    loginPassword: function (value) {
      if (!String(value || '')) return 'Please enter your password.';
      return null;
    },

    medicineName: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter the medicine name.';
      if (v.length > 80) return 'That name is too long.';
      return null;
    },

    dose: function (value) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter the dose, for example 500 mg or 1 tablet.';
      return null;
    },

    times: function (value) {
      var list = Array.isArray(value) ? value : [];
      if (!list.length) return 'Please add at least one time of day.';
      return null;
    },

    futureOrToday: function (value, label) {
      var v = String(value || '').trim();
      if (!v) return 'Please enter a ' + (label || 'date') + '.';
      var today = api.todayISO();
      if (v < today) return 'Please choose today or a later date.';
      return null;
    },

    date: function (value) {
      if (!String(value || '').trim()) return 'Please enter a date.';
      return null;
    },

    doctor: function (value) {
      if (!String(value || '').trim()) return "Please enter the doctor's name.";
      return null;
    },
  };

  /* ---------------------------------------------------------------------------
     Auth
     --------------------------------------------------------------------------- */

  var Auth = {
    validators: validators,

    current: readSession,

    /* Resolve the session to a live patient record. Returns null and clears a
       stale session if the account no longer exists (e.g. after a full reset). */
    async resolve() {
      var session = readSession();
      if (!session) return null;
      var patient = await api.getPatient(session.patientId);
      if (!patient) {
        clearSession();
        return null;
      }
      return patient;
    },

    async login(email, password) {
      var patient = await api.login(email, password);
      var session = {
        patientId: patient.id,
        name: patient.name,
        email: patient.email,
        signedInAt: new Date().toISOString(),
      };
      writeSession(session);
      return session;
    },

    async register(payload) {
      var patientPayload = {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        dob: payload.dob,
      };
      if (api.USE_BACKEND) {
        /* The server hashes the raw password, so it never has to trust the
           browser's stand-in hash. */
        patientPayload.password = payload.password;
      } else {
        patientPayload.passwordHash = await api.hashPassword(payload.password);
      }
      var patient = await api.createPatient(patientPayload);
      var session = {
        patientId: patient.id,
        name: patient.name,
        email: patient.email,
        signedInAt: new Date().toISOString(),
      };
      writeSession(session);
      return session;
    },

    logout() {
      clearSession();
      global.location.href = 'login.html';
    },

    /* Guard for every inner page. Redirects to login and remembers where the
       user was trying to go, so signing in does not dump them on the dashboard
       when they wanted the appointment they clicked. */
    async requireAuth() {
      var patient = await Auth.resolve();
      if (!patient) {
        var here = global.location.pathname.split('/').pop() || 'index.html';
        var search = global.location.search || '';
        var next = encodeURIComponent(here + search);
        global.location.replace('login.html?next=' + next);
        return null;
      }
      return patient;
    },

    /* For the login/register pages: an already signed-in user is sent on. */
    async redirectIfSignedIn() {
      var session = readSession();
      if (!session) return false;
      var target = new URLSearchParams(global.location.search).get('next');
      global.location.replace(target || 'index.html');
      return true;
    },
  };

  global.Auth = Auth;
})(window);

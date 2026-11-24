/*
  SehatCall -- shared interface layer.

  Everything that appears on more than one page lives here: the icon set, the
  sidebar shell, the mobile drawer, the text-size and theme preferences, toasts,
  the confirm dialog, status chips and form-error helpers.

  Two conventions worth keeping:
    1. Icons are inline SVG, never emoji. Emoji render differently on every
       platform, are announced as words by screen readers, and cannot be
       recoloured by the token system.
    2. Anything interpolated into HTML goes through esc(). Medicine names and
       notes are user input, and innerHTML does not care whose text it is.
*/

(function (global) {
  'use strict';

  var api = global.API;

  /* ---------------------------------------------------------------------------
     Icons -- 24x24, stroke-based, currentColor so they follow their context.
     --------------------------------------------------------------------------- */

  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    pill: '<path d="M10.5 20.5a6.36 6.36 0 0 1-9-9l7-7a6.36 6.36 0 0 1 9 9z"/><path d="m8.5 13.5 5-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    calendarPlus: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    skip: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.4 3.3"/><path d="M6.6 6.7A17.7 17.7 0 0 0 2 13s3.5 7 10 7a9.9 9.9 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    pulse: '<path d="M2 12h4l2-5 3 10 2.5-6 1.5 1h7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    type: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  };

  function icon(name, extraClass) {
    var body = ICONS[name] || ICONS.info;
    return (
      '<svg class="icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>'
    );
  }

  /* Escapes text for interpolation into HTML. Used on every user-supplied
     string: names, doses, notes, locations. */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------------------
     Preferences: text size and theme
     --------------------------------------------------------------------------- */

  var THEME_KEY = 'sehatcall.theme';
  var SIZE_KEY = 'sehatcall.textsize';

  var TEXT_SIZES = [
    { key: 'normal', label: 'Normal', scale: 1 },
    { key: 'large', label: 'Large', scale: 1.15 },
    { key: 'xlarge', label: 'Largest', scale: 1.3 },
  ];

  function readPref(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writePref(key, value) {
    try {
      if (value == null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, value);
    } catch (err) { /* storage blocked: preference lasts this session only */ }
  }

  function osPrefersDark() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* 'light' | 'dark' | 'auto' stored; the resolved value is what goes on the
     <html> element and what the CSS responds to. */
  function resolveTheme(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return osPrefersDark() ? 'dark' : 'light';
  }

  function applyTheme(pref) {
    var resolved = resolveTheme(pref);
    if (resolved === 'dark') global.document.documentElement.setAttribute('data-theme', 'dark');
    else global.document.documentElement.removeAttribute('data-theme');
    return resolved;
  }

  function currentScale() {
    var saved = parseFloat(readPref(SIZE_KEY) || '1');
    if (!saved || saved < 0.8 || saved > 1.6) return 1;
    return saved;
  }

  function applyTextScale(scale) {
    global.document.documentElement.style.setProperty('--font-scale', String(scale));
  }

  /* ---------------------------------------------------------------------------
     Formatters
     --------------------------------------------------------------------------- */

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function parseISODate(iso) {
    if (!iso) return null;
    var p = String(iso).split('-').map(Number);
    var d = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    return isNaN(d.getTime()) ? null : d;
  }

  /* 12-hour with AM/PM: an 82-year-old reading "20:00" is being asked to do
     arithmetic the interface should have done. */
  function formatTime(hhmm) {
    var parts = String(hhmm || '00:00').split(':');
    var h = Number(parts[0]) || 0;
    var m = Number(parts[1]) || 0;
    var suffix = h >= 12 ? 'PM' : 'AM';
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ':' + String(m).padStart(2, '0') + ' ' + suffix;
  }

  function formatDateShort(iso) {
    var d = parseISODate(iso);
    if (!d) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }

  function formatDateLong(iso) {
    var d = parseISODate(iso);
    if (!d) return '';
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function dayDiff(iso) {
    var d = parseISODate(iso);
    if (!d) return null;
    var today = parseISODate(api.todayISO());
    return Math.round((d - today) / 86400000);
  }

  /* "Today" / "Tomorrow" reads faster than a date the reader has to compare
     against today in their head. */
  function relativeDay(iso) {
    var diff = dayDiff(iso);
    if (diff === null) return '';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return 'In ' + diff + ' days';
    if (diff < -1 && diff > -7) return Math.abs(diff) + ' days ago';
    return formatDateShort(iso);
  }

  function formatDateTimeStamp(isoTimestamp) {
    if (!isoTimestamp) return '';
    var d = new Date(isoTimestamp);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours();
    var suffix = h >= 12 ? 'PM' : 'AM';
    var hour12 = h % 12 || 12;
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() +
      ', ' + hour12 + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + suffix;
  }

  /* ---------------------------------------------------------------------------
     Status chips
     --------------------------------------------------------------------------- */

  var STATUS_META = {
    taken: { label: 'Taken', cls: 'chip--taken', icon: 'checkCircle' },
    missed: { label: 'Missed', cls: 'chip--missed', icon: 'alert' },
    upcoming: { label: 'Upcoming', cls: 'chip--upcoming', icon: 'clock' },
    skipped: { label: 'Skipped', cls: 'chip--done', icon: 'skip' },
    paused: { label: 'Paused', cls: 'chip--paused', icon: 'pause' },
    active: { label: 'Active', cls: 'chip--taken', icon: 'check' },
    scheduled: { label: 'Scheduled', cls: 'chip--upcoming', icon: 'calendar' },
    completed: { label: 'Completed', cls: 'chip--taken', icon: 'checkCircle' },
    cancelled: { label: 'Cancelled', cls: 'chip--done', icon: 'xCircle' },
    past: { label: 'Past', cls: 'chip--done', icon: 'history' },
  };

  function chip(status) {
    var meta = STATUS_META[status] || { label: status, cls: 'chip--neutral', icon: 'info' };
    return '<span class="chip ' + meta.cls + '">' + icon(meta.icon) + esc(meta.label) + '</span>';
  }

  /* ---------------------------------------------------------------------------
     Toast
     --------------------------------------------------------------------------- */

  function toastRegion() {
    var region = global.document.getElementById('toasts');
    if (!region) {
      region = global.document.createElement('div');
      region.id = 'toasts';
      region.className = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      global.document.body.appendChild(region);
    }
    return region;
  }

  function toast(message, type) {
    var region = toastRegion();
    var el = global.document.createElement('div');
    el.className = 'toast toast--' + (type || 'success');
    el.innerHTML = icon(type === 'error' ? 'alert' : 'checkCircle') + '<span>' + esc(message) + '</span>';
    /* Cap the stack: three visible at once is plenty and older ones age out. */
    while (region.children.length >= 3) region.removeChild(region.firstChild);
    region.appendChild(el);
    global.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4600);
  }

  /* ---------------------------------------------------------------------------
     Confirm dialog
     ---------------------------------------------------------------------------
     Uses the native <dialog> element, so focus trapping, Escape handling and
     the backdrop come from the browser rather than from hand-written JS that
     usually gets one of them wrong. Returns a promise so callers can `await`.
     --------------------------------------------------------------------------- */

  function confirmDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var dialog = global.document.createElement('dialog');
      dialog.className = 'dialog dialog--confirm';
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      dialog.innerHTML =
        '<div class="dialog__header">' +
          '<div>' +
            '<h2 class="dialog__title" id="confirm-title">' + esc(opts.title || 'Are you sure?') + '</h2>' +
          '</div>' +
          '<button class="icon-btn dialog__close" type="button" data-close aria-label="Close this dialog">' +
            icon('x') +
          '</button>' +
        '</div>' +
        '<div class="dialog__body">' +
          '<p style="margin:0">' + esc(opts.message || '') + '</p>' +
          (opts.details ? '<p class="muted" style="margin:var(--space-3) 0 0">' + esc(opts.details) + '</p>' : '') +
        '</div>' +
        '<div class="dialog__footer">' +
          '<button class="btn btn--secondary" type="button" data-close>' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
          '<button class="btn ' + (opts.danger ? 'btn--danger' : 'btn--primary') + '" type="button" data-confirm>' +
            esc(opts.confirmLabel || 'Yes, continue') +
          '</button>' +
        '</div>';

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
        if (dialog.open) dialog.close();
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      }

      dialog.addEventListener('click', function (event) {
        if (event.target.closest('[data-confirm]')) {
          finish(true);
        } else if (event.target.closest('[data-close]') || event.target === dialog) {
          finish(false);
        }
      });

      /* Escape fires 'cancel'; treat it as "no" rather than letting the promise
         hang forever. */
      dialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        finish(false);
      });

      global.document.body.appendChild(dialog);
      dialog.showModal();
      var confirmBtn = dialog.querySelector('[data-confirm]');
      if (confirmBtn) confirmBtn.focus();
    });
  }

  /* ---------------------------------------------------------------------------
     Form helpers
     --------------------------------------------------------------------------- */

  function fieldErrorEl(form, name) {
    return form.querySelector('[data-error-for="' + name + '"]');
  }

  function setFieldError(form, name, message) {
    var slot = fieldErrorEl(form, name);
    var input = form.elements[name];
    if (slot) {
      slot.innerHTML = message ? icon('alert') + '<span>' + esc(message) + '</span>' : '';
    }
    if (input && input.setAttribute) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearErrors(form) {
    form.querySelectorAll('[data-error-for]').forEach(function (slot) {
      slot.innerHTML = '';
    });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (input) {
      input.removeAttribute('aria-invalid');
    });
    var status = form.querySelector('.form-status');
    if (status) {
      status.textContent = '';
      status.className = 'form-status';
    }
  }

  function showErrors(form, errors) {
    var first = null;
    Object.keys(errors).forEach(function (name) {
      setFieldError(form, name, errors[name]);
      if (!first) first = name;
    });
    if (first) {
      var input = form.elements[first];
      if (input && input.focus) input.focus();
    }
    return first;
  }

  function formStatus(form, message, type) {
    var status = form.querySelector('.form-status');
    if (!status) return;
    status.className = 'form-status form-status--' + (type || 'info');
    status.textContent = message || '';
  }

  /* Prevents a double submit (a real problem with slow, deliberate taps) and
     keeps the label stable so the button does not jump in size. */
  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.label) button.dataset.label = button.textContent.trim();
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (busyLabel) button.textContent = busyLabel;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }

  /* Password show/hide. A genuine toggle: it changes the input type and says,
     in aria-pressed and the label, which state it is in. */
  function wirePasswordToggle(buttonId, inputId) {
    var btn = global.document.getElementById(buttonId);
    var input = global.document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.innerHTML = icon(showing ? 'eye' : 'eyeOff');
      input.focus();
      /* Keep the caret at the end rather than jumping to the start. */
      var len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (err) { /* not supported */ }
    });
  }

  /* ---------------------------------------------------------------------------
     Dashboard "add" buttons land on a page with ?new=1, which opens the form
     immediately instead of making the user find the button again.
     --------------------------------------------------------------------------- */

  function hasNewParam() {
    try {
      return new URLSearchParams(global.location.search).get('new') === '1';
    } catch (err) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------------
     Shell: sidebar + mobile drawer
     --------------------------------------------------------------------------- */

  var NAV_ITEMS = [
    { key: 'dashboard', href: 'index.html', label: 'Dashboard', icon: 'grid' },
    { key: 'medicines', href: 'medicines.html', label: 'My medicines', icon: 'pill' },
    { key: 'appointments', href: 'appointments.html', label: 'Appointments', icon: 'calendar' },
    { key: 'reminders', href: 'reminders.html', label: 'Reminder history', icon: 'history' },
  ];

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0); }).join('') || '?';
  }

  function sidebarHTML(patient, active, badges) {
    var nav = NAV_ITEMS.map(function (item) {
      var isActive = item.key === active;
      var badge = item.key === 'reminders' && badges && badges.missed > 0
        ? '<span class="nav-badge">' + esc(badges.missed) + '</span>'
        : '';
      return (
        '<a class="nav-link' + (isActive ? ' is-active' : '') + '" href="' + item.href + '"' +
        (isActive ? ' aria-current="page"' : '') + '>' +
          icon(item.icon) + '<span>' + esc(item.label) + '</span>' + badge +
        '</a>'
      );
    }).join('');

    var scale = currentScale();

    return (
      '<a class="sidebar__brand" href="index.html">' +
        '<span class="brand-mark" aria-hidden="true">' + icon('heart') + '</span>' +
        '<span class="brand-text">' +
          '<span class="brand-name">SehatCall</span>' +
          '<span class="brand-tag">Medicine reminders</span>' +
        '</span>' +
      '</a>' +

      '<nav class="sidebar__nav" aria-label="Main">' +
        '<span class="nav-section-label">Menu</span>' +
        nav +
        '<span class="nav-section-label">Family</span>' +
        '<a class="nav-link" href="register.html?new=1">' +
          icon('users') + '<span>Add a patient</span>' +
        '</a>' +
      '</nav>' +

      '<div class="sidebar__footer">' +
        '<div class="pref-group">' +
          '<span class="pref-label" id="textsize-label">' + icon('type') + ' Text size</span>' +
          '<div class="segmented" role="group" aria-labelledby="textsize-label">' +
            TEXT_SIZES.map(function (size) {
              return '<button type="button" data-textsize="' + size.scale + '"' +
                ' aria-pressed="' + (Math.abs(scale - size.scale) < 0.01 ? 'true' : 'false') + '">' +
                esc(size.label) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<button class="btn btn--secondary btn--block" type="button" data-theme-toggle>' +
          icon('moon') + '<span>Dark theme</span>' +
        '</button>' +

        '<div class="sidebar__user">' +
          '<span class="avatar" aria-hidden="true">' + esc(initials(patient.name)) + '</span>' +
          '<span class="sidebar__user-meta">' +
            '<span class="sidebar__user-name">' + esc(patient.name) + '</span>' +
            '<span class="sidebar__user-email">' + esc(patient.email) + '</span>' +
          '</span>' +
        '</div>' +

        '<button class="btn btn--secondary btn--block" type="button" data-logout>' +
          icon('logout') + '<span>Sign out</span>' +
        '</button>' +
      '</div>'
    );
  }

  /* Mounts the sidebar and wires every control that exists on every page.
     Returns the signed-in patient, or null if a redirect has started. */
  async function mountShell(options) {
    var opts = options || {};
    var patient = await global.Auth.requireAuth();
    if (!patient) return null;

    applyTextScale(currentScale());
    applyTheme(readPref(THEME_KEY));

    var root = global.document.getElementById('sidebar-root');
    if (root) {
      root.innerHTML =
        '<aside class="sidebar" id="sidebar" data-open="false" aria-label="SehatCall menu">' +
        sidebarHTML(patient, opts.active, opts.badges) +
        '</aside>';
    }

    var sidebar = global.document.getElementById('sidebar');
    var menuBtn = global.document.getElementById('menuBtn');
    var scrim = null;

    function closeDrawer() {
      if (!sidebar) return;
      sidebar.setAttribute('data-open', 'false');
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
      if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
      scrim = null;
    }

    function openDrawer() {
      if (!sidebar) return;
      sidebar.setAttribute('data-open', 'true');
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
      if (!scrim) {
        scrim = global.document.createElement('button');
        scrim.type = 'button';
        scrim.className = 'sidebar-scrim';
        scrim.setAttribute('aria-label', 'Close menu');
        scrim.addEventListener('click', closeDrawer);
        global.document.body.appendChild(scrim);
      }
      var firstLink = sidebar.querySelector('.nav-link');
      if (firstLink) firstLink.focus();
    }

    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        if (sidebar && sidebar.getAttribute('data-open') === 'true') closeDrawer();
        else openDrawer();
      });
    }

    /* Escape closes the drawer, and so does clicking a destination. */
    global.document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
    });

    if (sidebar) {
      sidebar.addEventListener('click', function (event) {
        if (event.target.closest('.nav-link')) closeDrawer();
      });
    }

    /* Growing the window past the breakpoint turns the drawer into a rail; if
       the scrim is still mounted it would sit over the whole page. */
    global.addEventListener('resize', function () {
      if (global.innerWidth >= 900) closeDrawer();
    });

    /* -- text size -- */
    Array.prototype.forEach.call(global.document.querySelectorAll('[data-textsize]'), function (btn) {
      btn.addEventListener('click', function () {
        var scale = parseFloat(btn.getAttribute('data-textsize')) || 1;
        applyTextScale(scale);
        writePref(SIZE_KEY, String(scale));
        Array.prototype.forEach.call(
          global.document.querySelectorAll('[data-textsize]'),
          function (other) {
            other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
          }
        );
        toast('Text size set to ' + btn.textContent.trim() + '.');
      });
    });

    /* -- theme -- */
    var themeBtn = global.document.querySelector('[data-theme-toggle]');
    if (themeBtn) {
      var resolved = applyTheme(readPref(THEME_KEY));
      function paintThemeButton() {
        var isDark = global.document.documentElement.getAttribute('data-theme') === 'dark';
        themeBtn.innerHTML = icon(isDark ? 'sun' : 'moon') +
          '<span>' + (isDark ? 'Light theme' : 'Dark theme') + '</span>';
      }
      paintThemeButton();
      themeBtn.addEventListener('click', function () {
        var isDark = global.document.documentElement.getAttribute('data-theme') === 'dark';
        var next = isDark ? 'light' : 'dark';
        writePref(THEME_KEY, next);
        applyTheme(next);
        paintThemeButton();
      });
      /* If the OS flips while the tab is open and the user has no explicit
         preference, follow it. */
      if (global.matchMedia) {
        var mq = global.matchMedia('(prefers-color-scheme: dark)');
        var onOsChange = function () {
          if (!readPref(THEME_KEY)) {
            applyTheme(null);
            paintThemeButton();
          }
        };
        if (mq.addEventListener) mq.addEventListener('change', onOsChange);
        else if (mq.addListener) mq.addListener(onOsChange);
      }
    }

    /* -- sign out -- */
    var logoutBtn = global.document.querySelector('[data-logout]');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        var yes = await confirmDialog({
          title: 'Sign out of SehatCall?',
          message: 'Your medicines and history stay saved on this device. You can sign in again any time.',
          confirmLabel: 'Yes, sign out',
          cancelLabel: 'Stay signed in',
        });
        if (yes) global.Auth.logout();
      });
    }

    return patient;
  }

  /* ---------------------------------------------------------------------------
     Shared row renderer for "today's doses" and history back-fill
     --------------------------------------------------------------------------- */

  function doseActionButton(dose, contextLabel) {
    if (dose.status === 'taken') return '';
    return (
      '<button class="btn btn--primary btn--sm" type="button" data-mark-taken' +
      ' data-medicine-id="' + esc(dose.medicineId) + '"' +
      ' data-medicine-name="' + esc(dose.medicineName) + '"' +
      ' data-dose="' + esc(dose.dose) + '"' +
      ' data-date="' + esc(dose.scheduledDate) + '"' +
      ' data-time="' + esc(dose.scheduledTime) + '">' +
        icon('check') + '<span>Mark as taken</span>' +
      '</button>'
    );
  }

  /* ---------------------------------------------------------------------------
     Nav badge
     ---------------------------------------------------------------------------
     The sidebar renders its badge at mount time, but the missed count is only
     known after the page has loaded its data. This updates it in place so the
     number in the menu matches the number in the cards.
     --------------------------------------------------------------------------- */

  function updateMissedBadge(count) {
    var link = global.document.querySelector('.sidebar .nav-link[href="reminders.html"]');
    if (!link) return;
    var badge = link.querySelector('.nav-badge');
    var n = Number(count) || 0;
    if (n > 0) {
      if (!badge) {
        badge = global.document.createElement('span');
        badge.className = 'nav-badge';
        link.appendChild(badge);
      }
      badge.textContent = String(n);
      /* Screen readers announce the link text, so the count has to be in it. */
      link.setAttribute('aria-label', 'Reminder history, ' + n + ' missed to record');
    } else {
      if (badge) badge.parentNode.removeChild(badge);
      link.removeAttribute('aria-label');
    }
  }

  global.UI = {
    icon: icon,
    esc: esc,
    ICONS: ICONS,
    chip: chip,
    STATUS_META: STATUS_META,
    toast: toast,
    confirm: confirmDialog,
    mountShell: mountShell,
    updateMissedBadge: updateMissedBadge,
    hasNewParam: hasNewParam,
    TEXT_SIZES: TEXT_SIZES,
    currentScale: currentScale,
    applyTextScale: applyTextScale,
    applyTheme: applyTheme,
    readPref: readPref,
    writePref: writePref,
    formatTime: formatTime,
    formatDateShort: formatDateShort,
    formatDateLong: formatDateLong,
    formatDateTimeStamp: formatDateTimeStamp,
    relativeDay: relativeDay,
    dayDiff: dayDiff,
    initials: initials,
    fieldError: setFieldError,
    clearErrors: clearErrors,
    showErrors: showErrors,
    formStatus: formStatus,
    setBusy: setBusy,
    wirePasswordToggle: wirePasswordToggle,
    doseActionButton: doseActionButton,
    toastRegion: toastRegion,
  };
})(window);

/*
  SehatCall -- appointment management.

  Beyond add/edit/cancel, this page does one thing a paper diary cannot: it
  produces a real .ics file the user can open in their own calendar app. That is
  a genuine feature with a real artefact at the end, not a decorative button.

  The .ics uses floating local time (DTSTART without a Z suffix), which is the
  correct choice for "10:30 at the clinic" -- converting it to UTC would move the
  appointment if the user travels.
*/

(function () {
  'use strict';

  var el = {
    upcomingList: document.getElementById('upcomingList'),
    pastList: document.getElementById('pastList'),
    upcomingCount: document.getElementById('upcomingCount'),
    pastCount: document.getElementById('pastCount'),
    nextLine: document.getElementById('nextLine'),
    addBtn: document.getElementById('addApptBtn'),
    dialog: document.getElementById('apptDialog'),
    form: document.getElementById('apptForm'),
    dialogTitle: document.getElementById('apptDialogTitle'),
    dialogSubtitle: document.getElementById('apptDialogSubtitle'),
    saveBtn: document.getElementById('saveApptBtn'),
    doctor: document.getElementById('aptDoctor'),
    speciality: document.getElementById('aptSpeciality'),
    date: document.getElementById('aptDate'),
    time: document.getElementById('aptTime'),
    location: document.getElementById('aptLocation'),
    notes: document.getElementById('aptNotes'),
  };

  var patient = null;
  var appointments = [];
  var editingId = null;

  /* ---------------------------------------------------------------------------
     Calendar file
     --------------------------------------------------------------------------- */

  /* RFC 5545 requires backslash-escaping of these four characters, and folding
     long lines -- but a summary/location of ordinary length stays on one line,
     which is all this app produces. */
  function icsEscape(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function icsStamp(dateISO, timeHHMM) {
    /* "2024-05-14" + "10:30" -> "20240514T103000" */
    var d = String(dateISO).replace(/-/g, '');
    var t = String(timeHHMM).replace(':', '') + '00';
    return d + 'T' + t;
  }

  function icsEndStamp(dateISO, timeHHMM) {
    /* A one-hour visit is the conventional default when no end time is known. */
    var parts = String(timeHHMM).split(':').map(Number);
    var startMinutes = (parts[0] || 0) * 60 + (parts[1] || 0);
    var endMinutes = startMinutes + 60;
    var dayShift = 0;
    if (endMinutes >= 24 * 60) {
      endMinutes -= 24 * 60;
      dayShift = 1;
    }
    var hh = String(Math.floor(endMinutes / 60)).padStart(2, '0');
    var mm = String(endMinutes % 60).padStart(2, '0');
    var date = dayShift ? API.addDays(dateISO, 1) : dateISO;
    return icsStamp(date, hh + ':' + mm);
  }

  function buildICS(apt) {
    var now = new Date();
    var stamp = now.getUTCFullYear() +
      String(now.getUTCMonth() + 1).padStart(2, '0') +
      String(now.getUTCDate()).padStart(2, '0') + 'T' +
      String(now.getUTCHours()).padStart(2, '0') +
      String(now.getUTCMinutes()).padStart(2, '0') +
      String(now.getUTCSeconds()).padStart(2, '0') + 'Z';

    var summary = 'Appointment with ' + apt.doctor +
      (apt.speciality ? ' (' + apt.speciality + ')' : '');
    var description = [];
    if (apt.notes) description.push(apt.notes);
    description.push('Added from SehatCall for ' + patient.name + '.');

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SehatCall//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + apt.id + '@sehatcall.app',
      'DTSTAMP:' + stamp,
      'DTSTART:' + icsStamp(apt.date, apt.time),
      'DTEND:' + icsEndStamp(apt.date, apt.time),
      'SUMMARY:' + icsEscape(summary),
      apt.location ? 'LOCATION:' + icsEscape(apt.location) : null,
      'DESCRIPTION:' + icsEscape(description.join('\n')),
      /* A 30-minute-before popup is the whole point of exporting: the user's own
         calendar holds it, so the reminder survives this app being closed. */
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape('Appointment with ' + apt.doctor),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(function (line) { return line !== null && line !== ''; });

    /* RFC 5545 mandates CRLF, and some calendar apps reject LF-only files. */
    return lines.join('\r\n') + '\r\n';
  }

  function downloadICS(apt) {
    var blob = new Blob([buildICS(apt)], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    var safeDoctor = String(apt.doctor).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    link.download = 'sehatcall-' + apt.date + '-' + (safeDoctor || 'appointment') + '.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    UI.toast('Calendar file saved. Open it to add the visit to your calendar.');
  }

  /* ---------------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------------- */

  function appointmentRow(apt, section) {
    var isUpcoming = section === 'upcoming';
    var diff = UI.dayDiff(apt.date);
    var statusChip = isUpcoming
      ? UI.chip(diff !== null && diff <= 7 ? 'upcoming' : 'scheduled')
      : (apt.status === 'completed' ? UI.chip('completed')
        : apt.status === 'cancelled' ? UI.chip('cancelled')
        : UI.chip('past'));

    var actions = '';

    if (isUpcoming) {
      actions +=
        '<button class="btn btn--primary btn--sm" type="button" data-complete>' +
          UI.icon('check') + '<span>Mark completed</span>' +
        '</button>';
    }

    actions +=
      '<button class="btn btn--secondary btn--sm" type="button" data-calendar>' +
        UI.icon('download') + '<span>Add to calendar</span>' +
      '</button>' +
      '<button class="btn btn--secondary btn--sm" type="button" data-edit>' +
        UI.icon('edit') + '<span>Edit</span>' +
      '</button>';

    if (isUpcoming) {
      actions +=
        '<button class="btn btn--secondary btn--sm" type="button" data-cancel>' +
          UI.icon('xCircle') + '<span>Cancel</span>' +
        '</button>';
    }

    actions +=
      '<button class="btn btn--danger-quiet btn--sm" type="button" data-delete>' +
        UI.icon('trash') + '<span>Delete</span>' +
      '</button>';

    return (
      '<li class="item" data-appt-id="' + UI.esc(apt.id) + '">' +
        '<span class="item__time">' +
          (isUpcoming ? UI.esc(UI.relativeDay(apt.date)) : UI.esc(UI.formatDateShort(apt.date))) +
          '<small>' + UI.esc(UI.formatTime(apt.time)) + '</small>' +
        '</span>' +
        '<div class="item__main">' +
          '<p class="item__title">' +
            UI.esc(apt.doctor) + ' ' + statusChip +
          '</p>' +
          '<p class="item__meta">' +
            (apt.speciality ? UI.esc(apt.speciality) + ' · ' : '') +
            UI.esc(UI.formatDateLong(apt.date)) +
          '</p>' +
          (apt.location
            ? '<p class="item__meta">' + UI.icon('pin') +
                '<span style="display:inline;vertical-align:middle"> ' + UI.esc(apt.location) + '</span></p>'
            : '') +
          (apt.notes ? '<p class="item__meta" style="margin-top:2px">' + UI.esc(apt.notes) + '</p>' : '') +
        '</div>' +
        '<div class="item__actions">' + actions + '</div>' +
      '</li>'
    );
  }

  function emptyState(section) {
    if (section === 'upcoming') {
      return (
        '<li>' +
          '<div class="empty">' +
            '<span class="empty__icon">' + UI.icon('calendar') + '</span>' +
            '<h3 class="empty__title">No upcoming appointments</h3>' +
            '<p class="empty__text">When you book a visit it appears here, in date order, ' +
              'with a button to add it to your phone calendar.</p>' +
            '<button class="btn btn--primary" type="button" data-open-add>' +
              UI.icon('plus') + '<span>Book an appointment</span>' +
            '</button>' +
          '</div>' +
        '</li>'
      );
    }
    return (
      '<li>' +
        '<div class="empty">' +
          '<span class="empty__icon">' + UI.icon('history') + '</span>' +
          '<h3 class="empty__title">Nothing here yet</h3>' +
          '<p class="empty__text">Appointments you have finished or cancelled are kept here for your records.</p>' +
        '</div>' +
      '</li>'
    );
  }

  function render() {
    var today = API.todayISO();

    var upcoming = appointments.filter(function (a) {
      return a.status === 'scheduled' && a.date >= today;
    });
    var past = appointments.filter(function (a) {
      return a.status !== 'scheduled' || a.date < today;
    }).sort(function (a, b) {
      /* Most recent first is what a person looking back actually wants. */
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    el.upcomingCount.textContent = upcoming.length
      ? upcoming.length + (upcoming.length === 1 ? ' visit booked' : ' visits booked')
      : '';
    el.pastCount.textContent = past.length
      ? past.length + (past.length === 1 ? ' past visit' : ' past visits')
      : '';

    if (upcoming.length) {
      el.upcomingList.innerHTML = upcoming.map(function (a) {
        return appointmentRow(a, 'upcoming');
      }).join('');
      var next = upcoming[0];
      el.nextLine.textContent = 'Next: ' + next.doctor + ' · ' +
        UI.relativeDay(next.date) + ' at ' + UI.formatTime(next.time);
    } else {
      el.upcomingList.innerHTML = emptyState('upcoming');
      el.nextLine.textContent = 'No appointments booked.';
    }

    el.pastList.innerHTML = past.length
      ? past.map(function (a) { return appointmentRow(a, 'past'); }).join('')
      : emptyState('past');
  }

  /* ---------------------------------------------------------------------------
     Dialog
     --------------------------------------------------------------------------- */

  function openDialog(apt) {
    editingId = apt ? apt.id : null;
    UI.clearErrors(el.form);
    el.form.reset();

    el.dialogTitle.textContent = apt ? 'Edit appointment' : 'Book an appointment';
    el.dialogSubtitle.textContent = apt
      ? 'Change the details below, then save.'
      : 'Who are you seeing, and when?';

    el.doctor.value = apt ? apt.doctor : '';
    el.speciality.value = apt ? (apt.speciality || '') : '';
    el.date.value = apt ? apt.date : API.todayISO();
    el.time.value = apt ? apt.time : '10:00';
    el.location.value = apt ? (apt.location || '') : '';
    el.notes.value = apt ? (apt.notes || '') : '';

    el.dialog.showModal();
    el.doctor.focus();
  }

  function closeDialog() {
    if (el.dialog.open) el.dialog.close();
    editingId = null;
  }

  el.form.addEventListener('submit', async function (event) {
    event.preventDefault();
    UI.clearErrors(el.form);

    var values = {
      doctor: el.doctor.value,
      speciality: el.speciality.value,
      date: el.date.value,
      time: el.time.value,
      location: el.location.value,
      notes: el.notes.value,
    };

    var errors = {};
    var doctorErr = Auth.validators.doctor(values.doctor);
    if (doctorErr) errors.doctor = doctorErr;

    if (!values.date) {
      errors.date = 'Please choose the date of the appointment.';
    }
    if (!values.time) {
      errors.time = 'Please choose the time of the appointment.';
    }

    if (Object.keys(errors).length) {
      UI.showErrors(el.form, errors);
      return;
    }

    /* A brand-new appointment in the past is almost always a typo -- the year
       is off by one, or the month. Editing an old record is not blocked, because
       back-filling a visit that already happened is legitimate. */
    if (!editingId && values.date < API.todayISO()) {
      var keepPast = await UI.confirm({
        title: 'That date has already passed',
        message: 'You picked ' + UI.formatDateLong(values.date) + ', which is in the past.',
        details: 'Save it anyway to keep a record of a visit that already happened.',
        confirmLabel: 'Yes, save it as a past visit',
        cancelLabel: 'Go back and change the date',
      });
      if (!keepPast) {
        el.date.focus();
        return;
      }
    }

    UI.setBusy(el.saveBtn, true, 'Saving…');

    try {
      if (editingId) {
        await API.updateAppointment(editingId, values);
        UI.toast('Appointment updated.');
      } else {
        await API.createAppointment(patient.id, values);
        UI.toast('Appointment booked for ' + UI.formatDateShort(values.date) + '.');
      }
      closeDialog();
      await load();
    } catch (err) {
      UI.setBusy(el.saveBtn, false);
      UI.formStatus(el.form, err.message, 'error');
    }
  });

  /* ---------------------------------------------------------------------------
     List interactions
     --------------------------------------------------------------------------- */

  function findAppointment(id) {
    return appointments.find(function (a) { return a.id === id; }) || null;
  }

  function bindList(list) {
    list.addEventListener('click', async function (event) {
      if (event.target.closest('[data-open-add]')) {
        openDialog(null);
        return;
      }

      var row = event.target.closest('[data-appt-id]');
      if (!row) return;
      var apt = findAppointment(row.getAttribute('data-appt-id'));
      if (!apt) return;

      if (event.target.closest('[data-calendar]')) {
        downloadICS(apt);
        return;
      }

      if (event.target.closest('[data-edit]')) {
        openDialog(apt);
        return;
      }

      if (event.target.closest('[data-complete]')) {
        var done = await UI.confirm({
          title: 'Mark this visit as completed?',
          message: 'Has your appointment with ' + apt.doctor + ' on ' +
            UI.formatDateShort(apt.date) + ' finished?',
          details: 'It moves to Past appointments. You can still edit it afterwards.',
          confirmLabel: 'Yes, mark completed',
          cancelLabel: 'Not yet',
        });
        if (!done) return;
        try {
          await API.updateAppointment(apt.id, { status: 'completed' });
          UI.toast('Appointment marked as completed.');
          await load();
        } catch (err) {
          UI.toast(err.message, 'error');
        }
        return;
      }

      if (event.target.closest('[data-cancel]')) {
        var cancelling = await UI.confirm({
          title: 'Cancel this appointment?',
          message: 'Cancel your visit with ' + apt.doctor + ' on ' + UI.formatDateShort(apt.date) + '?',
          details: 'It moves to Past appointments and is marked Cancelled. Delete it instead if you want it gone completely.',
          confirmLabel: 'Yes, cancel the visit',
          cancelLabel: 'Keep it',
        });
        if (!cancelling) return;
        try {
          await API.updateAppointment(apt.id, { status: 'cancelled' });
          UI.toast('Appointment cancelled.');
          await load();
        } catch (err) {
          UI.toast(err.message, 'error');
        }
        return;
      }

      if (event.target.closest('[data-delete]')) {
        var gone = await UI.confirm({
          title: 'Delete this appointment?',
          message: 'Remove your visit with ' + apt.doctor + ' on ' + UI.formatDateShort(apt.date) + '?',
          details: 'This cannot be undone. Cancel it instead if you want to keep the record.',
          confirmLabel: 'Yes, delete it',
          danger: true,
        });
        if (!gone) return;
        try {
          await API.deleteAppointment(apt.id);
          UI.toast('Appointment deleted.');
          await load();
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      }
    });
  }

  bindList(el.upcomingList);
  bindList(el.pastList);

  /* ---------------------------------------------------------------------------
     Global wiring and boot
     --------------------------------------------------------------------------- */

  el.addBtn.addEventListener('click', function () { openDialog(null); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close-dialog]'), function (btn) {
    btn.addEventListener('click', closeDialog);
  });

  el.dialog.addEventListener('click', function (event) {
    if (event.target === el.dialog) closeDialog();
  });

  el.dialog.addEventListener('cancel', function () {
    editingId = null;
  });

  async function load() {
    appointments = await API.listAppointments(patient.id);
    render();
  }

  (async function init() {
    await API.init();
    patient = await UI.mountShell({ active: 'appointments' });
    if (!patient) return;

    await load();

    if (UI.hasNewParam()) openDialog(null);
  })();
})();

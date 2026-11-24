/*
  SehatCall -- dashboard.

  Every number on this page is derived from stored records at render time; none
  is hardcoded. Marking a dose as taken here writes a real reminder row, so the
  "missed" counter and the history page both change as a consequence. That is
  the difference between a working dashboard and a picture of one.
*/

(function () {
  'use strict';

  var el = {
    greeting: document.getElementById('greeting'),
    todayLine: document.getElementById('todayLine'),
    notices: document.getElementById('notices'),
    statGrid: document.getElementById('statGrid'),
    doseList: document.getElementById('doseList'),
    dosesSummary: document.getElementById('dosesSummary'),
    apptList: document.getElementById('apptList'),
    exportToday: document.getElementById('exportToday'),
  };

  var patient = null;
  var state = { counts: null, doses: [], appointments: [] };

  /* ---------------------------------------------------------------------------
     Regions
     --------------------------------------------------------------------------- */

  function statCard(options) {
    return (
      '<a class="stat-card' + (options.alert ? ' stat-card--alert' : '') + '" href="' + options.href + '">' +
        '<span class="stat-card__top">' +
          '<span class="stat-card__label">' + UI.esc(options.label) + '</span>' +
          '<span class="stat-card__icon">' + UI.icon(options.icon) + '</span>' +
        '</span>' +
        '<span class="stat-card__value tabular">' + UI.esc(options.value) + '</span>' +
        '<span class="stat-card__hint">' + UI.esc(options.hint) + '</span>' +
      '</a>'
    );
  }

  function renderStats(counts) {
    var missedHint = counts.missed === 0
      ? 'Nothing outstanding — well done'
      : counts.missed === 1
        ? '1 dose needs recording'
        : counts.missed + ' doses need recording';

    var medHint = counts.medicines === 0
      ? 'No medicines added yet'
      : counts.medicines + (counts.medicines === 1 ? ' active medicine' : ' active medicines');

    var apptHint = counts.appointments === 0
      ? 'Nothing booked yet'
      : counts.appointments + (counts.appointments === 1 ? ' appointment booked' : ' appointments booked');

    el.statGrid.innerHTML =
      statCard({
        label: 'Registered patients',
        value: counts.patients,
        hint: 'Accounts saved on this device',
        href: 'register.html?new=1',
        icon: 'users',
      }) +
      statCard({
        label: 'Medicines',
        value: counts.medicines,
        hint: medHint,
        href: 'medicines.html',
        icon: 'pill',
      }) +
      statCard({
        label: 'Missed reminders',
        value: counts.missed,
        hint: missedHint,
        href: 'reminders.html?status=missed',
        icon: 'alert',
        alert: counts.missed > 0,
      }) +
      statCard({
        label: 'Appointments',
        value: counts.appointments,
        hint: apptHint,
        href: 'appointments.html',
        icon: 'calendar',
      });
  }

  function renderDoses(doses, counts) {
    if (!doses.length) {
      el.dosesSummary.textContent = '';
      el.doseList.innerHTML =
        '<li>' +
          '<div class="empty">' +
            '<span class="empty__icon">' + UI.icon('pill') + '</span>' +
            '<h3 class="empty__title">No medicines due today</h3>' +
            '<p class="empty__text">When you add a medicine, every dose appears here in the order it is due.</p>' +
            '<a class="btn btn--primary" href="medicines.html?new=1">' + UI.icon('plus') + '<span>Add your first medicine</span></a>' +
          '</div>' +
        '</li>';
      return;
    }

    var taken = doses.filter(function (d) { return d.status === 'taken'; }).length;
    var remaining = doses.length - taken;
    el.dosesSummary.textContent = taken + ' of ' + doses.length + ' taken' +
      (remaining > 0 ? ' · ' + remaining + ' still to go' : ' · all done for today');

    el.doseList.innerHTML = doses.map(function (dose) {
      var isTaken = dose.status === 'taken';
      var isSkipped = dose.status === 'skipped';
      return (
        '<li class="item">' +
          '<span class="item__time tabular">' +
            UI.esc(UI.formatTime(dose.scheduledTime)) +
          '</span>' +
          '<div class="item__main">' +
            '<p class="item__title">' +
              UI.esc(dose.medicineName) +
              (dose.dose ? ' <span class="muted">· ' + UI.esc(dose.dose) + '</span>' : '') +
              ' ' + UI.chip(dose.status) +
            '</p>' +
            (dose.notes ? '<p class="item__meta">' + UI.esc(dose.notes) + '</p>' : '') +
          '</div>' +
          '<div class="item__actions">' +
            (isTaken || isSkipped
              ? '<span class="muted" style="font-size:var(--text-sm)">' +
                  (isTaken ? 'Recorded at ' + UI.esc(UI.formatDateTimeStamp(dose.recordedAt || '')) : 'Marked as skipped') +
                '</span>'
              : '<button class="btn btn--primary btn--sm" type="button" data-mark-taken' +
                  ' data-medicine-id="' + UI.esc(dose.medicineId) + '"' +
                  ' data-medicine-name="' + UI.esc(dose.medicineName) + '"' +
                  ' data-dose="' + UI.esc(dose.dose) + '"' +
                  ' data-date="' + UI.esc(dose.scheduledDate) + '"' +
                  ' data-time="' + UI.esc(dose.scheduledTime) + '">' +
                  UI.icon('check') + '<span>Mark as taken</span>' +
                '</button>' +
                '<button class="btn btn--secondary btn--sm" type="button" data-skip-dose' +
                  ' data-medicine-id="' + UI.esc(dose.medicineId) + '"' +
                  ' data-medicine-name="' + UI.esc(dose.medicineName) + '"' +
                  ' data-dose="' + UI.esc(dose.dose) + '"' +
                  ' data-date="' + UI.esc(dose.scheduledDate) + '"' +
                  ' data-time="' + UI.esc(dose.scheduledTime) + '"' +
                  ' aria-label="Mark ' + UI.esc(dose.medicineName) + ' as skipped">' +
                  UI.icon('skip') + '<span>Skip</span>' +
                '</button>') +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  function renderAppointments(all) {
    var today = API.todayISO();
    var upcoming = all
      .filter(function (a) { return a.status === 'scheduled' && a.date >= today; })
      .slice(0, 3);

    if (!upcoming.length) {
      el.apptList.innerHTML =
        '<li>' +
          '<div class="empty">' +
            '<span class="empty__icon">' + UI.icon('calendar') + '</span>' +
            '<h3 class="empty__title">No appointments booked</h3>' +
            '<p class="empty__text">Add a doctor visit and SehatCall will keep the date and time here.</p>' +
            '<a class="btn btn--primary" href="appointments.html?new=1">' + UI.icon('plus') + '<span>Book an appointment</span></a>' +
          '</div>' +
        '</li>';
      return;
    }

    el.apptList.innerHTML = upcoming.map(function (apt) {
      var rel = UI.relativeDay(apt.date);
      var diff = UI.dayDiff(apt.date);
      return (
        '<li class="item">' +
          '<span class="item__time">' +
            UI.esc(rel) +
            '<small>' + UI.esc(UI.formatTime(apt.time)) + '</small>' +
          '</span>' +
          '<div class="item__main">' +
            '<p class="item__title">' + UI.esc(apt.doctor) + '</p>' +
            '<p class="item__meta">' +
              (apt.speciality ? UI.esc(apt.speciality) + ' · ' : '') +
              UI.esc(UI.formatDateShort(apt.date)) +
              (apt.location ? ' · ' + UI.esc(apt.location) : '') +
            '</p>' +
          '</div>' +
          '<div class="item__actions">' +
            (diff === 0
              ? '<span class="chip chip--upcoming">' + UI.icon('clock') + 'Today</span>'
              : '<button class="btn btn--secondary btn--sm" type="button" data-complete-appt' +
                  ' data-id="' + UI.esc(apt.id) + '"' +
                  ' data-doctor="' + UI.esc(apt.doctor) + '">' +
                  UI.icon('check') + '<span>Mark completed</span>' +
                '</button>') +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  async function renderNotices() {
    var parts = [];

    /* After registration, confirm what just happened rather than dropping the
       user on an unfamiliar screen with no acknowledgement. */
    if (new URLSearchParams(window.location.search).get('welcome') === '1') {
      parts.push(
        '<div class="notice notice--info" style="margin-bottom:var(--space-4)">' +
          UI.icon('checkCircle') +
          '<div class="notice__body">' +
            '<p class="notice__title">Your account is ready</p>' +
            '<p class="notice__text">Add your first medicine to start tracking doses. ' +
              'Nothing is sent to a doctor or pharmacy — this is your own record.</p>' +
          '</div>' +
        '</div>'
      );
    }

    var sampleVisible = await API.isSampleNoticeVisible(patient.id);
    if (sampleVisible) {
      var counts = state.counts || { medicines: 0 };
      parts.push(
        '<div class="notice notice--sample" style="margin-bottom:var(--space-4)">' +
          UI.icon('info') +
          '<div class="notice__body">' +
            '<p class="notice__title">You are looking at sample data</p>' +
            '<p class="notice__text">This account was filled with example medicines and appointments so the app is not empty. ' +
              'Clear it whenever you are ready and add your own.</p>' +
            '<div class="btn-row" style="margin-top:var(--space-3)">' +
              '<button class="btn btn--secondary btn--sm" type="button" id="clearSampleBtn">' +
                UI.icon('trash') + '<span>Clear sample data</span>' +
              '</button>' +
              '<button class="btn btn--quiet btn--sm" type="button" id="keepSampleBtn">Keep it for now</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    el.notices.innerHTML = parts.join('');
  }

  /* ---------------------------------------------------------------------------
     Load
     --------------------------------------------------------------------------- */

  async function refresh() {
    state.counts = await API.getCounts(patient.id);
    state.doses = await API.todayDoses(patient.id);
    state.appointments = await API.listAppointments(patient.id);

    renderStats(state.counts);
    renderDoses(state.doses, state.counts);
    renderAppointments(state.appointments);
    await renderNotices();
  }

  /* ---------------------------------------------------------------------------
     Actions
     --------------------------------------------------------------------------- */

  function dosePayloadFrom(button) {
    return {
      medicineId: button.getAttribute('data-medicine-id'),
      medicineName: button.getAttribute('data-medicine-name'),
      dose: button.getAttribute('data-dose'),
      scheduledDate: button.getAttribute('data-date'),
      scheduledTime: button.getAttribute('data-time'),
    };
  }

  /* One delegated listener on the page, so re-rendering the lists never leaves
     dead buttons behind. */
  document.getElementById('main').addEventListener('click', async function (event) {
    var takenBtn = event.target.closest('[data-mark-taken]');
    var skipBtn = event.target.closest('[data-skip-dose]');
    var completeBtn = event.target.closest('[data-complete-appt]');
    var clearSampleBtn = event.target.closest('#clearSampleBtn');
    var keepSampleBtn = event.target.closest('#keepSampleBtn');

    if (takenBtn) {
      var dose = dosePayloadFrom(takenBtn);
      UI.setBusy(takenBtn, true, 'Saving…');
      try {
        await API.markDose(patient.id, Object.assign({ status: 'taken' }, dose));
        UI.toast(dose.medicineName + ' marked as taken.');
        await refresh();
      } catch (err) {
        UI.setBusy(takenBtn, false);
        UI.toast(err.message, 'error');
      }
      return;
    }

    if (skipBtn) {
      var skipDose = dosePayloadFrom(skipBtn);
      var skip = await UI.confirm({
        title: 'Mark this dose as skipped?',
        message: 'Skip ' + skipDose.medicineName + ' (' + skipDose.dose + ') at ' +
          UI.formatTime(skipDose.scheduledTime) + ' today?',
        details: 'It will show as skipped in your history rather than missed, so your record stays accurate.',
        confirmLabel: 'Yes, skip this dose',
        cancelLabel: 'Keep it on the list',
      });
      if (!skip) return;
      try {
        await API.markDose(patient.id, Object.assign({ status: 'skipped' }, skipDose));
        UI.toast('Dose marked as skipped.');
        await refresh();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
      return;
    }

    if (completeBtn) {
      var id = completeBtn.getAttribute('data-id');
      var doctor = completeBtn.getAttribute('data-doctor');
      var yes = await UI.confirm({
        title: 'Mark this appointment as completed?',
        message: 'Has your visit with ' + doctor + ' finished?',
        details: 'It will move from Upcoming to Past on the appointments page.',
        confirmLabel: 'Yes, mark completed',
        cancelLabel: 'Not yet',
      });
      if (!yes) return;
      try {
        await API.updateAppointment(id, { status: 'completed' });
        UI.toast('Appointment marked as completed.');
        await refresh();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
      return;
    }

    if (clearSampleBtn) {
      var clear = await UI.confirm({
        title: 'Clear the sample data?',
        message: 'This removes the example medicines, appointments and reminder history from this account.',
        details: 'Your account stays signed in. Anything you added yourself is kept.',
        confirmLabel: 'Yes, clear it',
        danger: true,
      });
      if (!clear) return;
      try {
        await API.clearSampleData(patient.id);
        UI.toast('Sample data cleared. You can start fresh.');
        await refresh();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
      return;
    }

    if (keepSampleBtn) {
      await API.dismissSampleNotice();
      el.notices.innerHTML = '';
      UI.toast('Sample data kept. You can clear it any time from this page.');
    }
  });

  /* ---------------------------------------------------------------------------
     "Save today's list" -- a real file download. Useful in exactly the situation
     this audience hits: printing the list or showing it to a chemist or carer.
     --------------------------------------------------------------------------- */

  if (el.exportToday) {
    el.exportToday.addEventListener('click', async function () {
      var doses = await API.todayDoses(patient.id);
      var today = API.todayISO();

      var lines = [];
      lines.push('SehatCall — medicines for ' + UI.formatDateLong(today));
      lines.push('Patient: ' + patient.name);
      lines.push('');
      if (!doses.length) {
        lines.push('No medicines are scheduled for today.');
      } else {
        doses.forEach(function (dose) {
          var label = dose.status === 'taken' ? '[TAKEN]'
            : dose.status === 'skipped' ? '[SKIPPED]'
            : dose.status === 'missed' ? '[MISSED]'
            : '[UPCOMING]';
          lines.push(label + '  ' + UI.formatTime(dose.scheduledTime) + '  ' +
            dose.medicineName + (dose.dose ? ' — ' + dose.dose : ''));
          if (dose.notes) lines.push('          ' + dose.notes);
        });
      }
      lines.push('');
      lines.push('Generated by SehatCall on ' + UI.formatDateTimeStamp(new Date().toISOString()));
      lines.push('This is a record kept by the patient, not a prescription.');

      var blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'sehatcall-medicines-' + today + '.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      UI.toast('List saved to your downloads.');
    });
  }

  /* ---------------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------------- */

  (async function init() {
    await API.init();
    patient = await UI.mountShell({ active: 'dashboard' });
    if (!patient) return;

    /* Greet by name and state the date in words. A bare "Dashboard" heading on a
       page full of numbers does not orient anyone. */
    var hour = new Date().getHours();
    var partOfDay = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var firstName = String(patient.name || '').trim().split(/\s+/)[0];
    el.greeting.textContent = partOfDay + ', ' + firstName;
    el.todayLine.textContent = UI.formatDateLong(API.todayISO());

    await refresh();
  })();
})();

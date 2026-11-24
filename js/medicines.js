/*
  SehatCall -- medicine management.

  The times editor is the interesting part: a medicine can be taken once, twice
  or more times a day, so "times" is a real list the user builds, not a single
  field. Each row can be removed, and the whole list is validated as one unit
  (at least one time is required).

  Everything the list shows -- including the "last 14 days" adherence line -- is
  computed from stored reminder rows, so pausing or editing a medicine changes
  what appears here immediately.
*/

(function () {
  'use strict';

  var el = {
    list: document.getElementById('medicineList'),
    listCount: document.getElementById('listCount'),
    search: document.getElementById('searchInput'),
    status: document.getElementById('statusFilter'),
    resetFilters: document.getElementById('resetFiltersBtn'),
    addBtn: document.getElementById('addMedicineBtn'),
    dialog: document.getElementById('medicineDialog'),
    form: document.getElementById('medicineForm'),
    dialogTitle: document.getElementById('medicineDialogTitle'),
    dialogSubtitle: document.getElementById('medicineDialogSubtitle'),
    saveBtn: document.getElementById('saveMedicineBtn'),
    timeRows: document.getElementById('timeRows'),
    addTimeBtn: document.getElementById('addTimeBtn'),
    twiceDailyBtn: document.getElementById('twiceDailyBtn'),
    preview: document.getElementById('schedulePreview'),
    name: document.getElementById('medName'),
    dose: document.getElementById('medDose'),
    start: document.getElementById('medStart'),
    end: document.getElementById('medEnd'),
    notes: document.getElementById('medNotes'),
    active: document.getElementById('medActive'),
  };

  var patient = null;
  var medicines = [];
  var logs = [];
  var editingId = null;

  /* ---------------------------------------------------------------------------
     Times editor
     --------------------------------------------------------------------------- */

  function addTimeRow(value) {
    var row = document.createElement('div');
    row.className = 'btn-row';
    row.style.alignItems = 'center';
    row.setAttribute('data-time-row', '');

    var input = document.createElement('input');
    input.type = 'time';
    input.className = 'input';
    input.name = 'time';
    input.value = value || '';
    input.style.maxWidth = '200px';
    input.setAttribute('aria-label', 'Time of day for this dose');

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--danger-quiet btn--sm';
    remove.innerHTML = UI.icon('trash') + '<span>Remove</span>';
    remove.addEventListener('click', function () {
      /* Keep at least one row: an empty editor with no way back is a dead end. */
      if (el.timeRows.querySelectorAll('[data-time-row]').length === 1) {
        input.value = '';
        updatePreview();
        return;
      }
      row.parentNode.removeChild(row);
      updatePreview();
    });

    input.addEventListener('input', updatePreview);

    row.appendChild(input);
    row.appendChild(remove);
    el.timeRows.appendChild(row);
    updatePreview();
    return input;
  }

  function readTimes() {
    return Array.prototype.map.call(
      el.timeRows.querySelectorAll('input[name="time"]'),
      function (input) { return input.value; }
    ).filter(Boolean);
  }

  /* Says the schedule back in words. "Twice a day at 8:00 AM and 8:00 PM" is
     checkable at a glance; a list of two times is not. */
  function updatePreview() {
    var times = readTimes().sort();
    if (!times.length) {
      el.preview.textContent = 'No times added yet.';
      return;
    }
    var count = times.length;
    var frequency = count === 1 ? 'Once a day' : count === 2 ? 'Twice a day' : count + ' times a day';
    el.preview.textContent = frequency + ' at ' + times.map(UI.formatTime).join(', ') + '.';
  }

  function setTimes(times) {
    el.timeRows.innerHTML = '';
    (times && times.length ? times : ['']).forEach(function (t) { addTimeRow(t); });
    updatePreview();
  }

  /* ---------------------------------------------------------------------------
     List
     --------------------------------------------------------------------------- */

  function adherenceLine(medicine) {
    var from = API.addDays(API.todayISO(), -14);
    var rows = logs.filter(function (l) {
      return l.medicineId === medicine.id && l.scheduledDate >= from;
    });
    if (!rows.length) return '';
    var taken = rows.filter(function (l) { return l.status === 'taken'; }).length;
    var missed = rows.filter(function (l) { return l.status === 'missed'; }).length;
    var text = 'Last 14 days: ' + taken + ' of ' + rows.length + ' doses taken';
    if (missed > 0) text += ' · ' + missed + ' missed';
    return text;
  }

  function medicineRow(med) {
    var times = med.times.slice().sort();
    var dateRange;
    if (med.endDate) {
      dateRange = UI.formatDateShort(med.startDate) + ' to ' + UI.formatDateShort(med.endDate);
    } else {
      dateRange = 'From ' + UI.formatDateShort(med.startDate) + ' · ongoing';
    }

    var adherence = adherenceLine(med);

    return (
      '<li class="item" data-medicine-id="' + UI.esc(med.id) + '">' +
        '<span class="item__time">' +
          times.length + '<small>' + (times.length === 1 ? 'dose a day' : 'doses a day') + '</small>' +
        '</span>' +

        '<div class="item__main">' +
          '<p class="item__title">' +
            UI.esc(med.name) +
            ' <span class="muted">· ' + UI.esc(med.dose) + '</span> ' +
            UI.chip(med.active ? 'active' : 'paused') +
          '</p>' +
          '<p class="item__meta">' +
            times.map(function (t) {
              return '<span class="chip chip--neutral">' + UI.icon('clock') + UI.esc(UI.formatTime(t)) + '</span>';
            }).join(' ') +
          '</p>' +
          '<p class="item__meta" style="margin-top: var(--space-1)">' + UI.esc(dateRange) + '</p>' +
          (med.notes ? '<p class="item__meta" style="margin-top: 2px">' + UI.esc(med.notes) + '</p>' : '') +
          (adherence ? '<p class="item__meta" style="margin-top: var(--space-1)">' + UI.esc(adherence) + '</p>' : '') +
        '</div>' +

        '<div class="item__actions">' +
          '<button class="btn btn--secondary btn--sm" type="button" data-edit>' +
            UI.icon('edit') + '<span>Edit</span>' +
          '</button>' +
          '<button class="btn btn--secondary btn--sm" type="button" data-toggle>' +
            UI.icon(med.active ? 'pause' : 'play') +
            '<span>' + (med.active ? 'Pause' : 'Resume') + '</span>' +
          '</button>' +
          '<button class="btn btn--danger-quiet btn--sm" type="button" data-delete>' +
            UI.icon('trash') + '<span>Delete</span>' +
          '</button>' +
        '</div>' +
      '</li>'
    );
  }

  function emptyState(kind) {
    if (kind === 'none-at-all') {
      return (
        '<li>' +
          '<div class="empty">' +
            '<span class="empty__icon">' + UI.icon('pill') + '</span>' +
            '<h3 class="empty__title">No medicines yet</h3>' +
            '<p class="empty__text">Add the first one and SehatCall will work out every dose, ' +
              'every day, and show it on your dashboard.</p>' +
            '<button class="btn btn--primary" type="button" data-open-add>' +
              UI.icon('plus') + '<span>Add your first medicine</span>' +
            '</button>' +
          '</div>' +
        '</li>'
      );
    }
    return (
      '<li>' +
        '<div class="empty">' +
          '<span class="empty__icon">' + UI.icon('search') + '</span>' +
          '<h3 class="empty__title">No medicines match that</h3>' +
          '<p class="empty__text">Try a shorter search, or clear the filters to see everything.</p>' +
          '<button class="btn btn--secondary" type="button" data-clear-filters>Clear filters</button>' +
        '</div>' +
      '</li>'
    );
  }

  function render() {
    var query = el.search.value.trim().toLowerCase();
    var status = el.status.value;

    var filtered = medicines.filter(function (med) {
      if (query && med.name.toLowerCase().indexOf(query) === -1 &&
          String(med.dose || '').toLowerCase().indexOf(query) === -1) {
        return false;
      }
      if (status === 'active' && !med.active) return false;
      if (status === 'paused' && med.active) return false;
      return true;
    });

    var activeCount = medicines.filter(function (m) { return m.active; }).length;
    el.listCount.textContent = medicines.length
      ? medicines.length + ' medicine' + (medicines.length === 1 ? '' : 's') +
        ' · ' + activeCount + ' active'
      : '';

    if (!medicines.length) {
      el.list.innerHTML = emptyState('none-at-all');
      return;
    }
    if (!filtered.length) {
      el.list.innerHTML = emptyState('filtered');
      return;
    }

    el.list.innerHTML = filtered.map(medicineRow).join('');
  }

  /* ---------------------------------------------------------------------------
     Dialog
     --------------------------------------------------------------------------- */

  function openDialog(medicine) {
    editingId = medicine ? medicine.id : null;
    UI.clearErrors(el.form);
    el.form.reset();
    setTimes(medicine ? medicine.times : ['08:00']);

    el.dialogTitle.textContent = medicine ? 'Edit medicine' : 'Add a medicine';
    el.dialogSubtitle.textContent = medicine
      ? 'Change the details below, then save.'
      : 'Tell us what to take and when.';

    el.name.value = medicine ? medicine.name : '';
    el.dose.value = medicine ? medicine.dose : '';
    el.start.value = medicine ? medicine.startDate : API.todayISO();
    el.end.value = medicine && medicine.endDate ? medicine.endDate : '';
    el.notes.value = medicine ? (medicine.notes || '') : '';
    el.active.checked = medicine ? !!medicine.active : true;

    /* An end date can never precede the start date, so the constraint is put on
       the input itself rather than being reported after the fact. */
    syncEndMin();
    updatePreview();

    el.dialog.showModal();
    el.name.focus();
  }

  function syncEndMin() {
    if (el.start.value) el.end.setAttribute('min', el.start.value);
    else el.end.removeAttribute('min');
  }

  function closeDialog() {
    if (el.dialog.open) el.dialog.close();
    editingId = null;
  }

  el.start.addEventListener('change', function () {
    syncEndMin();
    /* If shrinking the window left the end date invalid, clear it rather than
       letting the save silently fail later. */
    if (el.end.value && el.start.value && el.end.value < el.start.value) {
      el.end.value = '';
      UI.fieldError(el.form, 'endDate', null);
    }
  });

  el.addTimeBtn.addEventListener('click', function () {
    var input = addTimeRow('');
    if (input) input.focus();
  });

  /* A shortcut for by far the most common schedule, so most users never have to
     build the list by hand. */
  el.twiceDailyBtn.addEventListener('click', function () {
    setTimes(['08:00', '20:00']);
    UI.toast('Set to twice a day — change the times if needed.');
  });

  el.form.addEventListener('submit', async function (event) {
    event.preventDefault();
    UI.clearErrors(el.form);

    var values = {
      name: el.name.value,
      dose: el.dose.value,
      times: readTimes(),
      startDate: el.start.value,
      endDate: el.end.value,
      notes: el.notes.value,
      active: el.active.checked,
    };

    var errors = {};

    var nameErr = Auth.validators.medicineName(values.name);
    if (nameErr) errors.name = nameErr;

    var doseErr = Auth.validators.dose(values.dose);
    if (doseErr) errors.dose = doseErr;

    var timesErr = Auth.validators.times(values.times);
    if (timesErr) errors.times = timesErr;

    if (!values.startDate) {
      errors.startDate = 'Please choose the date you start taking this medicine.';
    }

    if (values.endDate && values.startDate && values.endDate < values.startDate) {
      errors.endDate = 'The end date cannot be before the start date.';
    }

    if (Object.keys(errors).length) {
      UI.showErrors(el.form, errors);
      /* A hidden or collapsed times area should not be the place focus lands
         with no visible cause, so scroll it into view within the dialog. */
      if (errors.times) el.timeRows.scrollIntoView({ block: 'nearest' });
      return;
    }

    UI.setBusy(el.saveBtn, true, 'Saving…');

    try {
      if (editingId) {
        await API.updateMedicine(editingId, values);
        UI.toast(values.name + ' updated.');
      } else {
        await API.createMedicine(patient.id, values);
        UI.toast(values.name + ' added. It will appear on your dashboard today.');
      }
      closeDialog();
      await load();
    } catch (err) {
      UI.setBusy(el.saveBtn, false);
      UI.formStatus(el.form, err.message, 'error');
    }
  });

  /* ---------------------------------------------------------------------------
     List interactions (delegated, so re-rendering never leaves dead handlers)
     --------------------------------------------------------------------------- */

  el.list.addEventListener('click', async function (event) {
    var openAdd = event.target.closest('[data-open-add]');
    var clearFilters = event.target.closest('[data-clear-filters]');

    if (openAdd) {
      openDialog(null);
      return;
    }
    if (clearFilters) {
      el.search.value = '';
      el.status.value = 'all';
      render();
      return;
    }

    var row = event.target.closest('[data-medicine-id]');
    if (!row) return;
    var id = row.getAttribute('data-medicine-id');
    var med = medicines.find(function (m) { return m.id === id; });
    if (!med) return;

    if (event.target.closest('[data-edit]')) {
      openDialog(med);
      return;
    }

    if (event.target.closest('[data-toggle]')) {
      var pausing = med.active;
      var yes = await UI.confirm({
        title: pausing ? 'Pause ' + med.name + '?' : 'Resume ' + med.name + '?',
        message: pausing
          ? 'Reminders stop and it will no longer appear on your daily list.'
          : 'It will appear on your daily list again from today.',
        details: 'The medicine and its history are kept either way. Nothing is deleted.',
        confirmLabel: pausing ? 'Yes, pause it' : 'Yes, resume it',
        cancelLabel: 'Cancel',
      });
      if (!yes) return;
      try {
        await API.updateMedicine(id, { active: !med.active });
        UI.toast(med.name + (pausing ? ' paused.' : ' resumed.'));
        await load();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
      return;
    }

    if (event.target.closest('[data-delete]')) {
      var remove = await UI.confirm({
        title: 'Delete ' + med.name + '?',
        message: 'It will be removed from your medicine list and no longer appear in your daily doses.',
        details: 'Past reminder history is kept, so your record of what was taken stays accurate.',
        confirmLabel: 'Yes, delete it',
        danger: true,
      });
      if (!remove) return;
      try {
        await API.deleteMedicine(id);
        UI.toast(med.name + ' deleted.');
        await load();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    }
  });

  /* ---------------------------------------------------------------------------
     Load
     --------------------------------------------------------------------------- */

  async function load() {
    medicines = await API.listMedicines(patient.id);
    logs = await API.listLogs(patient.id, { from: API.addDays(API.todayISO(), -14) });
    render();
  }

  el.search.addEventListener('input', render);
  el.status.addEventListener('change', render);
  el.resetFilters.addEventListener('click', function () {
    el.search.value = '';
    el.status.value = 'all';
    render();
    el.search.focus();
  });

  el.addBtn.addEventListener('click', function () { openDialog(null); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close-dialog]'), function (btn) {
    btn.addEventListener('click', closeDialog);
  });

  /* Clicking the backdrop dismisses the dialog. The dialog element itself is the
     target in that case, not a child. */
  el.dialog.addEventListener('click', function (event) {
    if (event.target === el.dialog) closeDialog();
  });

  el.dialog.addEventListener('cancel', function () {
    editingId = null;
  });

  /* ---------------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------------- */

  (async function init() {
    await API.init();
    patient = await UI.mountShell({ active: 'medicines' });
    if (!patient) return;

    await load();

    /* Arriving from a "Add medicine" button on another page should put the user
       straight into the form they asked for. */
    if (UI.hasNewParam()) openDialog(null);
  })();
})();

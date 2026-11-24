/*
  SehatCall -- reminder history.

  This page is honest about what it is. Rows marked "Taken" were recorded by the
  user; rows marked "Missed" are doses whose time passed with no record. Nothing
  here claims a reminder was "sent", because this is a frontend with no
  scheduler behind it -- see FRONTEND-NOTES.md for what the server must add.

  The useful action it does offer is back-filling: if someone forgot to tick off
  yesterday's dose, they can record it now and their adherence figure becomes
  accurate again.
*/

(function () {
  'use strict';

  var el = {
    status: document.getElementById('statusFilter'),
    from: document.getElementById('fromDate'),
    to: document.getElementById('toDate'),
    clear: document.getElementById('clearFiltersBtn'),
    body: document.getElementById('historyBody'),
    empty: document.getElementById('historyEmpty'),
    rowCount: document.getElementById('rowCount'),
    rangeLine: document.getElementById('rangeLine'),
    summary: document.getElementById('summaryStrip'),
    exportBtn: document.getElementById('exportCsvBtn'),
  };

  var patient = null;
  var filters = { status: 'all', from: '', to: '' };
  var rows = [];
  var summary = null;

  /* ---------------------------------------------------------------------------
     Filters
     --------------------------------------------------------------------------- */

  function applyRange(days) {
    var today = API.todayISO();
    el.to.value = today;
    el.from.value = API.addDays(today, -(days - 1));
  }

  function readFilters() {
    filters.status = el.status.value || 'all';
    filters.from = el.from.value || '';
    filters.to = el.to.value || '';
    /* A reversed range silently returns nothing, which looks like a bug to the
       user. Swap it and tell them what happened. */
    if (filters.from && filters.to && filters.from > filters.to) {
      var swap = filters.from;
      filters.from = filters.to;
      filters.to = swap;
      el.from.value = filters.from;
      el.to.value = filters.to;
      UI.toast('Those dates were the wrong way round, so they have been swapped.');
    }
  }

  /* ---------------------------------------------------------------------------
     Summary
     --------------------------------------------------------------------------- */

  function renderSummary(data) {
    if (!data || !data.total) {
      el.summary.innerHTML =
        '<div class="summary-item">' +
          '<span class="summary-item__label">No records</span>' +
          '<span class="summary-item__value">—</span>' +
        '</div>';
      return;
    }

    el.summary.innerHTML =
      '<div class="summary-item">' +
        '<span class="summary-item__label">Doses taken</span>' +
        '<span class="summary-item__value tabular">' + data.taken + '</span>' +
      '</div>' +
      '<div class="summary-item">' +
        '<span class="summary-item__label">Doses missed</span>' +
        '<span class="summary-item__value tabular" style="color:var(--status-missed-fg)">' + data.missed + '</span>' +
      '</div>' +
      '<div class="summary-item">' +
        '<span class="summary-item__label">Doses skipped</span>' +
        '<span class="summary-item__value tabular">' + data.skipped + '</span>' +
      '</div>' +
      '<div class="summary-item">' +
        '<span class="summary-item__label">Taken on time</span>' +
        '<span class="summary-item__value tabular">' + data.adherence + '<small>% of ' + data.total + '</small></span>' +
      '</div>';
  }

  /* ---------------------------------------------------------------------------
     Table
     --------------------------------------------------------------------------- */

  function renderRows() {
    if (!rows.length) {
      el.body.innerHTML = '';
      el.empty.innerHTML =
        '<div class="empty">' +
          '<span class="empty__icon">' + UI.icon('inbox') + '</span>' +
          '<h3 class="empty__title">Nothing to show for these dates</h3>' +
          '<p class="empty__text">' +
            (filters.status !== 'all' || filters.from || filters.to
              ? 'No reminders match these filters. Try clearing them to see everything.'
              : 'Once you add a medicine and its dose times pass, every one is listed here.') +
          '</p>' +
        '</div>';
      return;
    }

    el.empty.innerHTML = '';

    el.body.innerHTML = rows.map(function (row) {
      var canBackfill = row.status === 'missed';
      var recorded = row.status === 'taken' && row.recordedAt
        ? UI.formatDateTimeStamp(row.recordedAt)
        : row.auto
          ? 'Not recorded'
          : row.status === 'skipped'
            ? 'Marked as skipped'
            : '—';

      return (
        '<tr>' +
          '<td data-label="Date" class="cell-strong">' + UI.esc(UI.formatDateShort(row.scheduledDate)) + '</td>' +
          '<td data-label="Time" class="tabular">' + UI.esc(UI.formatTime(row.scheduledTime)) + '</td>' +
          '<td data-label="Medicine" class="cell-strong">' +
            UI.esc(row.medicineName) +
            (row.medicineDeleted ? ' <span class="muted" style="font-weight:400">(deleted)</span>' : '') +
          '</td>' +
          '<td data-label="Dose">' + UI.esc(row.dose || '—') + '</td>' +
          '<td data-label="Status">' + UI.chip(row.status) + '</td>' +
          '<td data-label="Recorded" class="muted" style="font-size:var(--text-xs)">' + UI.esc(recorded) + '</td>' +
          '<td data-label="Action">' +
            (canBackfill
              ? '<button class="btn btn--primary btn--sm" type="button" data-backfill' +
                  ' data-medicine-id="' + UI.esc(row.medicineId) + '"' +
                  ' data-medicine-name="' + UI.esc(row.medicineName) + '"' +
                  ' data-dose="' + UI.esc(row.dose || '') + '"' +
                  ' data-date="' + UI.esc(row.scheduledDate) + '"' +
                  ' data-time="' + UI.esc(row.scheduledTime) + '">' +
                  UI.icon('check') + '<span>Mark as taken</span>' +
                '</button>'
              : '<span class="muted" style="font-size:var(--text-xs)">—</span>') +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderHeader() {
    var count = rows.length;
    el.rowCount.textContent = count
      ? count + (count === 1 ? ' record' : ' records') +
        (filters.status !== 'all' ? ' · ' + filters.status : '')
      : '';

    var from = filters.from || 'the beginning';
    var to = filters.to || 'today';
    el.rangeLine.textContent = filters.from || filters.to
      ? 'Showing ' + UI.formatDateShort(from === 'the beginning' ? API.addDays(API.todayISO(), -365) : from) +
        ' to ' + UI.formatDateShort(to === 'today' ? API.todayISO() : to)
      : 'Showing the last two weeks. Use the filters to look further back.';
  }

  /* ---------------------------------------------------------------------------
     Load
     --------------------------------------------------------------------------- */

  async function load() {
    readFilters();

    /* The log can only be materialised for the window the API scans, so an
       empty "from" means "the whole recorded window" rather than "everything
       since forever" -- the label above says so plainly. */
    rows = await API.listLogs(patient.id, {
      status: filters.status,
      from: filters.from,
      to: filters.to,
    });

    summary = await API.adherenceSummary(
      patient.id,
      filters.from || API.addDays(API.todayISO(), -365),
      filters.to || API.todayISO()
    );

    renderHeader();
    renderSummary(summary);
    renderRows();

    var counts = await API.getCounts(patient.id);
    UI.updateMissedBadge(counts.missed);
  }

  /* ---------------------------------------------------------------------------
     Actions
     --------------------------------------------------------------------------- */

  el.body.addEventListener('click', async function (event) {
    var btn = event.target.closest('[data-backfill]');
    if (!btn) return;

    var payload = {
      medicineId: btn.getAttribute('data-medicine-id'),
      medicineName: btn.getAttribute('data-medicine-name'),
      dose: btn.getAttribute('data-dose'),
      scheduledDate: btn.getAttribute('data-date'),
      scheduledTime: btn.getAttribute('data-time'),
    };

    var yes = await UI.confirm({
      title: 'Record this dose as taken?',
      message: payload.medicineName + ' on ' + UI.formatDateShort(payload.scheduledDate) +
        ' at ' + UI.formatTime(payload.scheduledTime) + '.',
      details: 'Only do this if you did take it. Honest records are what make this page useful to your doctor.',
      confirmLabel: 'Yes, I took it',
      cancelLabel: 'Leave it as missed',
    });
    if (!yes) return;

    UI.setBusy(btn, true, 'Saving…');
    try {
      await API.markDose(patient.id, Object.assign({ status: 'taken' }, payload));
      UI.toast('Dose recorded as taken.');
      await load();
    } catch (err) {
      UI.setBusy(btn, false);
      UI.toast(err.message, 'error');
    }
  });

  /* ---------------------------------------------------------------------------
     CSV export
     ---------------------------------------------------------------------------
     Exports exactly what is on screen -- same filters, same order -- so the file
     and the page never disagree. A UTF-8 BOM is prepended because Excel on
     Windows otherwise renders non-ASCII names as mojibake.
     --------------------------------------------------------------------------- */

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    /* Quote anything containing a separator, a quote or a newline, and double
       the quotes. Notes fields routinely contain commas. */
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  el.exportBtn.addEventListener('click', async function () {
    if (!rows.length) {
      UI.toast('There is nothing to export for these filters.', 'error');
      return;
    }

    var header = ['Date', 'Time', 'Medicine', 'Dose', 'Status', 'Recorded at', 'Notes'];
    var lines = [header.map(csvCell).join(',')];

    rows.forEach(function (row) {
      lines.push([
        row.scheduledDate,
        UI.formatTime(row.scheduledTime),
        row.medicineName,
        row.dose || '',
        row.status,
        row.recordedAt ? UI.formatDateTimeStamp(row.recordedAt) : 'Not recorded',
        row.notes || '',
      ].map(csvCell).join(','));
    });

    /* A trailing summary block, separated by a blank line. It is still valid
       CSV and it is the first thing anyone opening the file wants to know. */
    lines.push('');
    if (summary) {
      lines.push(['Summary', '', '', '', '', '', ''].map(csvCell).join(','));
      lines.push(['Doses recorded', summary.total].map(csvCell).join(','));
      lines.push(['Taken', summary.taken].map(csvCell).join(','));
      lines.push(['Missed', summary.missed].map(csvCell).join(','));
      lines.push(['Skipped', summary.skipped].map(csvCell).join(','));
      lines.push(['Taken on time (%)', summary.adherence].map(csvCell).join(','));
    }
    lines.push(['Patient', patient.name].map(csvCell).join(','));
    lines.push(['Exported', UI.formatDateTimeStamp(new Date().toISOString())].map(csvCell).join(','));

    var csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'sehatcall-history-' + API.todayISO() + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    UI.toast('CSV saved to your downloads.');
  });

  /* ---------------------------------------------------------------------------
     Wiring and boot
     --------------------------------------------------------------------------- */

  el.status.addEventListener('change', load);
  el.from.addEventListener('change', load);
  el.to.addEventListener('change', load);

  el.clear.addEventListener('click', function () {
    el.status.value = 'all';
    el.from.value = '';
    el.to.value = '';
    load();
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (btn) {
    btn.addEventListener('click', function () {
      applyRange(Number(btn.getAttribute('data-range')));
      load();
    });
  });

  (async function init() {
    await API.init();
    patient = await UI.mountShell({ active: 'reminders' });
    if (!patient) return;

    /* The dashboard's missed-reminders card links here with ?status=missed so it
       lands on the thing the user clicked about. */
    var preset = new URLSearchParams(window.location.search).get('status');
    if (preset && ['taken', 'missed', 'skipped'].indexOf(preset) !== -1) {
      el.status.value = preset;
    }

    await load();
  })();
})();

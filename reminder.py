"""
SehatCall -- reminder scheduler.

Uses APScheduler to run a background job once a minute. Each run:

  1. finds medicine doses due at the current minute,
  2. writes a 'pending' reminder row if one does not exist yet,
  3. sends the patient an SMS (or prints a mock message),
  4. finds appointments starting in the next 30 minutes and reminds those too.

The job runs in a background thread inside the Flask process, so there is no
separate worker to start -- just run ``python app.py``.
"""

from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler

import database
import notifications


def _now_hhmm():
    return datetime.now().strftime("%H:%M")


def _today_iso():
    return datetime.now().date().isoformat()


def _check_due_reminders():
    """One scheduler tick: check medicines and appointments that are due."""
    now = datetime.now()
    today = _today_iso()
    hhmm = _now_hhmm()
    now_minutes = now.hour * 60 + now.minute

    # --- Medicine reminders (due at the exact scheduled time) -------------
    for item in database.list_active_medicines_with_patients():
        medicine = item["medicine"]
        patient = item["patient"]

        # Only consider medicines that are active on today's date.
        if medicine["startDate"] and medicine["startDate"] > today:
            continue
        if medicine["endDate"] and medicine["endDate"] < today:
            continue
        if hhmm not in medicine["times"]:
            continue

        reminder, created = database.get_or_create_pending_reminder(
            patient["id"], medicine, today, hhmm
        )

        # Send once: either this is a brand-new row or it was never notified.
        if created or not reminder.get("notifiedAt"):
            notifications.send_medicine_reminder(patient, medicine, hhmm)
            database.mark_reminder_notified(reminder["id"])

    # --- Appointment reminders (30 minutes before) ------------------------
    for item in database.list_upcoming_appointments_with_patients():
        appointment = item["appointment"]
        patient = item["patient"]

        if appointment.get("reminderSent"):
            continue
        if appointment["date"] != today:
            continue

        due_minutes = database._time_to_minutes(appointment["time"])
        minutes_until = due_minutes - now_minutes
        if 0 <= minutes_until <= 30:
            notifications.send_appointment_reminder(patient, appointment)
            database.mark_appointment_reminder_sent(appointment["id"])


def start_scheduler(app):
    """
    Start the background scheduler and return it.

    ``app`` is accepted for future use (for example, if a job ever needs the
    Flask application context); the current job only touches the database
    helpers, which manage their own connections.
    """
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _check_due_reminders,
        trigger="interval",
        minutes=1,
        id="sehatcall-reminders",
        name="Check due medicine and appointment reminders",
    )
    scheduler.start()
    print("[scheduler] Reminder checker started (runs every minute).")
    return scheduler

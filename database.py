"""
SehatCall -- database layer.

This file owns everything that touches SQLite:

  * creating the ``database/`` folder and ``database/sehatcall.db`` on startup,
  * creating the tables (patients, medicines, appointments, reminders),
  * validating phone numbers and preventing duplicate accounts,
  * all the CRUD + query helpers the Flask routes call.

It uses Python's built-in ``sqlite3`` module, so there is no separate ORM to
learn. Every function opens its own short-lived connection, which keeps things
simple and also makes the APScheduler background thread safe.
"""

import json
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta

# Werkzeug ships with Flask and provides secure password hashing for free.
from werkzeug.security import check_password_hash, generate_password_hash

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR = os.path.join(BASE_DIR, "database")
DATABASE_PATH = os.path.join(DATABASE_DIR, "sehatcall.db")

# The demo account shown on the sign-in page.
DEMO_EMAIL = "demo@sehatcall.app"
DEMO_PASSWORD = "demo1234"

# Reminder history is materialised for this many days when no date range is
# supplied. It mirrors the window the frontend uses, so behaviour stays the same.
DEFAULT_LOG_WINDOW_DAYS = 14


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _now_iso():
    """Return the current local time as an ISO-ish string, e.g. 2026-11-24T10:30:00."""
    return datetime.now().isoformat(timespec="seconds")


def _today_iso():
    """Return today's date as YYYY-MM-DD (local time, not UTC)."""
    return date.today().isoformat()


def _normalise_time(value):
    """Turn any 'H:MM' style string into a clean 'HH:MM' string."""
    parts = str(value or "").split(":")
    if len(parts) < 2:
        return "00:00"
    try:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    except (ValueError, TypeError):
        return "00:00"


def _time_to_minutes(value):
    """Convert 'HH:MM' into minutes since midnight, for ordering and comparisons."""
    parts = str(value or "00:00").split(":")
    try:
        return (int(parts[0]) * 60) + int(parts[1])
    except (ValueError, TypeError):
        return 0


def _is_past(date_iso, time_iso, now=None):
    """Return True when a scheduled date+time is in the past."""
    now = now or datetime.now()
    today = now.date().isoformat()
    if date_iso < today:
        return True
    if date_iso > today:
        return False
    return _time_to_minutes(time_iso) <= (now.hour * 60 + now.minute)


def _is_valid_date(value):
    try:
        datetime.strptime(str(value), "%Y-%m-%d")
        return True
    except (ValueError, TypeError):
        return False


def _is_valid_time(value):
    return bool(re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", str(value or "")))


# ---------------------------------------------------------------------------
# Phone validation
# ---------------------------------------------------------------------------

def normalise_phone(value):
    """
    Validate a phone number and return it in a consistent ``+91XXXXXXXXXX``
    format. Accepts:

      * a 10-digit Indian mobile number:  ``9820041122``
      * a number with a +91 prefix:      ``+919820041122``
      * a number with spaces/dashes:     ``+91 98200 41122``
      * a leading-zero local form:       ``09820041122``

    Raises ``ValueError`` with a human-readable message when it is not a valid
    10-digit Indian mobile number.
    """
    if value is None:
        raise ValueError("Please enter your phone number.")

    text = str(value).strip()
    # Keep only digits and a possible leading '+', so formatting never matters.
    text = re.sub(r"[\s\-()]", "", text)

    if text.startswith("+91"):
        digits = text[3:]
    elif text.startswith("91") and len(text) == 12:
        digits = text[2:]
    elif text.startswith("0") and len(text) == 11:
        digits = text[1:]
    else:
        digits = text

    if not digits.isdigit():
        raise ValueError("Please enter a 10-digit Indian mobile number, or one starting with +91.")
    if len(digits) != 10:
        raise ValueError("Please enter a 10-digit Indian mobile number, or one starting with +91.")
    if digits[0] not in "6789":
        raise ValueError("Please enter a valid Indian mobile number (it should start with 6, 7, 8 or 9).")

    return "+91" + digits


# ---------------------------------------------------------------------------
# Connection + schema
# ---------------------------------------------------------------------------

def get_connection():
    """Open a new SQLite connection configured to return rows as dictionaries."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS patients (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    email                    TEXT NOT NULL UNIQUE,
    phone                    TEXT NOT NULL UNIQUE,
    dob                      TEXT NOT NULL DEFAULT '',
    family_phone             TEXT NOT NULL DEFAULT '',
    password_hash            TEXT NOT NULL,
    sample                   INTEGER NOT NULL DEFAULT 0,
    sample_notice_dismissed  INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medicines (
    id           TEXT PRIMARY KEY,
    patient_id   TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    dose         TEXT NOT NULL DEFAULT '',
    times        TEXT NOT NULL DEFAULT '[]',   -- JSON list of 'HH:MM' strings
    start_date   TEXT NOT NULL,
    end_date     TEXT,
    notes        TEXT NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    sample       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
    id             TEXT PRIMARY KEY,
    patient_id     TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor         TEXT NOT NULL,
    speciality     TEXT NOT NULL DEFAULT '',
    date           TEXT NOT NULL,
    time           TEXT NOT NULL,
    location       TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'scheduled',
    sample         INTEGER NOT NULL DEFAULT 0,
    reminder_sent  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id                TEXT PRIMARY KEY,
    patient_id        TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    medicine_id       TEXT NOT NULL,
    medicine_name     TEXT NOT NULL,
    dose              TEXT NOT NULL DEFAULT '',
    scheduled_date    TEXT NOT NULL,
    scheduled_time    TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    recorded_at       TEXT,
    note              TEXT NOT NULL DEFAULT '',
    notified_at       TEXT,
    auto              INTEGER NOT NULL DEFAULT 0,
    sample            INTEGER NOT NULL DEFAULT 0,
    medicine_deleted  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(patient_id, medicine_id, scheduled_date, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_medicines_patient   ON medicines(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminders_patient   ON reminders(patient_id);
"""


def init_db():
    """Create the database folder and tables, then seed the demo account once."""
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        _seed_demo_if_needed(conn)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Row -> JSON helpers (SQLite uses snake_case, the frontend uses camelCase)
# ---------------------------------------------------------------------------

def _patient_to_dict(row, include_password_hash=False):
    if row is None:
        return None
    data = {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "dob": row["dob"],
        "familyPhone": row["family_phone"],
        "sample": bool(row["sample"]),
        "createdAt": row["created_at"],
    }
    if include_password_hash:
        data["passwordHash"] = row["password_hash"]
    return data


def _medicine_to_dict(row):
    if row is None:
        return None
    try:
        times = json.loads(row["times"] or "[]")
    except (ValueError, TypeError):
        times = []
    return {
        "id": row["id"],
        "patientId": row["patient_id"],
        "name": row["name"],
        "dose": row["dose"],
        "times": times,
        "startDate": row["start_date"],
        "endDate": row["end_date"],
        "notes": row["notes"],
        "active": bool(row["active"]),
        "sample": bool(row["sample"]),
        "createdAt": row["created_at"],
    }


def _appointment_to_dict(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "patientId": row["patient_id"],
        "doctor": row["doctor"],
        "speciality": row["speciality"],
        "date": row["date"],
        "time": row["time"],
        "location": row["location"],
        "notes": row["notes"],
        "status": row["status"],
        "sample": bool(row["sample"]),
        "reminderSent": bool(row["reminder_sent"]),
        "createdAt": row["created_at"],
    }


def _reminder_to_dict(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "patientId": row["patient_id"],
        "medicineId": row["medicine_id"],
        "medicineName": row["medicine_name"],
        "dose": row["dose"],
        "scheduledDate": row["scheduled_date"],
        "scheduledTime": row["scheduled_time"],
        "status": row["status"],
        "recordedAt": row["recorded_at"],
        "note": row["note"],
        "notifiedAt": row["notified_at"],
        "auto": bool(row["auto"]),
        "sample": bool(row["sample"]),
        "medicineDeleted": bool(row["medicine_deleted"]),
    }


# ---------------------------------------------------------------------------
# Patients / users
# ---------------------------------------------------------------------------

def list_patients():
    """Return every patient, never including the password hash."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM patients ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_patient_to_dict(row) for row in rows]
    finally:
        conn.close()


def get_patient(patient_id):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM patients WHERE id = ?", (patient_id,)
        ).fetchone()
        return _patient_to_dict(row)
    finally:
        conn.close()


def get_patient_by_phone(phone):
    """Look a patient up by phone number, validating/normalising it first."""
    try:
        normalised = normalise_phone(phone)
    except ValueError:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM patients WHERE phone = ?", (normalised,)
        ).fetchone()
        return _patient_to_dict(row)
    finally:
        conn.close()


def verify_patient(email, password):
    """Return the patient if the email/password pair is correct, else None."""
    email = str(email or "").strip().lower()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM patients WHERE email = ?", (email,)
        ).fetchone()
        if row is None:
            return None
        if not check_password_hash(row["password_hash"], password):
            return None
        return _patient_to_dict(row)
    finally:
        conn.close()


def create_patient(data):
    """
    Create a new patient. Raises ``ValueError`` for invalid input or a
    duplicate email / phone number.
    """
    name = str(data.get("name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    phone_raw = str(data.get("phone") or "").strip()
    dob = str(data.get("dob") or "").strip()
    family_raw = str(data.get("family_phone") or data.get("familyPhone") or "").strip()
    password = str(data.get("password") or "")

    if not name:
        raise ValueError("Please enter your full name.")
    if len(name) > 80:
        raise ValueError("That name is too long (80 characters maximum).")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
        raise ValueError("Please enter a valid email address, for example name@example.com")
    if not phone_raw:
        raise ValueError("Please enter your phone number.")
    if not dob:
        raise ValueError("Please enter your date of birth.")
    if not _is_valid_date(dob):
        raise ValueError("Please enter a valid date of birth.")
    if not password:
        raise ValueError("Please choose a password.")
    if len(password) < 8:
        raise ValueError("Please use at least 8 characters.")

    phone = normalise_phone(phone_raw)
    family_phone = normalise_phone(family_raw) if family_raw else ""

    conn = get_connection()
    try:
        # Prevent duplicate accounts: email is the primary key the UI shows,
        # and the phone number must also be unique so SMS replies route to the
        # right person.
        existing = conn.execute(
            "SELECT email, phone FROM patients WHERE email = ? OR phone = ?",
            (email, phone),
        ).fetchone()
        if existing is not None:
            if existing["email"] == email:
                raise ValueError("An account already exists with that email address.")
            raise ValueError("An account already exists with that phone number.")

        patient_id = "pat_" + uuid.uuid4().hex[:12]
        password_hash = generate_password_hash(password)
        conn.execute(
            """
            INSERT INTO patients
                (id, name, email, phone, dob, family_phone, password_hash,
                 sample, sample_notice_dismissed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
            """,
            (patient_id, name, email, phone, dob, family_phone, password_hash, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()

    return get_patient(patient_id)


def dismiss_sample_notice(patient_id):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE patients SET sample_notice_dismissed = 1 WHERE id = ?",
            (patient_id,),
        )
        conn.commit()
    finally:
        conn.close()
    return True


def clear_sample_data(patient_id):
    """Delete only the rows marked as sample data, keeping the account itself."""
    conn = get_connection()
    try:
        removed = conn.execute(
            "DELETE FROM medicines WHERE patient_id = ? AND sample = 1",
            (patient_id,),
        ).rowcount
        conn.execute(
            "DELETE FROM appointments WHERE patient_id = ? AND sample = 1",
            (patient_id,),
        )
        conn.execute(
            "DELETE FROM reminders WHERE patient_id = ? AND sample = 1",
            (patient_id,),
        )
        conn.execute(
            "UPDATE patients SET sample = 0, sample_notice_dismissed = 1 WHERE id = ?",
            (patient_id,),
        )
        conn.commit()
    finally:
        conn.close()
    return {"removed": removed}


def reset_all():
    """Dangerous dev helper: wipe every table and re-seed the demo account."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM reminders")
        conn.execute("DELETE FROM appointments")
        conn.execute("DELETE FROM medicines")
        conn.execute("DELETE FROM patients")
        conn.commit()
        _seed_demo(conn)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Medicines
# ---------------------------------------------------------------------------

def list_medicines(patient_id, active_only=False):
    conn = get_connection()
    try:
        sql = "SELECT * FROM medicines WHERE patient_id = ?"
        params = [patient_id]
        if active_only:
            sql += " AND active = 1"
        sql += " ORDER BY name COLLATE NOCASE"
        rows = conn.execute(sql, params).fetchall()
        return [_medicine_to_dict(row) for row in rows]
    finally:
        conn.close()


def get_medicine(medicine_id):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM medicines WHERE id = ?", (medicine_id,)
        ).fetchone()
        return _medicine_to_dict(row)
    finally:
        conn.close()


def create_medicine(patient_id, data):
    name = str(data.get("name") or "").strip()
    dose = str(data.get("dose") or "").strip()
    times = data.get("times") or []
    start_date = data.get("startDate") or _today_iso()
    end_date = data.get("endDate") or None
    notes = str(data.get("notes") or "").strip()
    active = 1 if data.get("active", True) else 0

    if not name:
        raise ValueError("Please enter the medicine name.")
    if not dose:
        raise ValueError("Please enter the dose, for example 500 mg or 1 tablet.")
    if not isinstance(times, list) or not times:
        raise ValueError("Please add at least one time of day.")
    if not _is_valid_date(start_date):
        raise ValueError("Please enter a valid start date.")
    if end_date and not _is_valid_date(end_date):
        raise ValueError("Please enter a valid end date.")
    if end_date and end_date < start_date:
        raise ValueError("The end date cannot be before the start date.")

    clean_times = [_normalise_time(t) for t in times]

    conn = get_connection()
    try:
        patient = conn.execute(
            "SELECT 1 FROM patients WHERE id = ?", (patient_id,)
        ).fetchone()
        if patient is None:
            raise ValueError("That patient could not be found.")

        medicine_id = "med_" + uuid.uuid4().hex[:12]
        conn.execute(
            """
            INSERT INTO medicines
                (id, patient_id, name, dose, times, start_date, end_date,
                 notes, active, sample, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                medicine_id, patient_id, name, dose, json.dumps(clean_times),
                start_date, end_date, notes, active, _now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return get_medicine(medicine_id)


def update_medicine(medicine_id, data):
    """Apply a partial update. Only the fields present in ``data`` change."""
    field_map = {
        "name": "name",
        "dose": "dose",
        "times": "times",
        "startDate": "start_date",
        "endDate": "end_date",
        "notes": "notes",
        "active": "active",
    }

    sets = []
    params = []
    for key, column in field_map.items():
        if key in data and data[key] is not None:
            value = data[key]
            if key == "times":
                value = json.dumps([_normalise_time(t) for t in value])
            elif key == "active":
                value = 1 if value else 0
            sets.append(f"{column} = ?")
            params.append(value)

    if not sets:
        return get_medicine(medicine_id)

    params.append(medicine_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            f"UPDATE medicines SET {', '.join(sets)} WHERE id = ?", params
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
    finally:
        conn.close()

    return get_medicine(medicine_id)


def delete_medicine(medicine_id):
    """Delete a medicine but keep its reminder history, flagged as deleted."""
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT 1 FROM medicines WHERE id = ?", (medicine_id,)
        ).fetchone()
        if existing is None:
            return False

        conn.execute(
            "UPDATE reminders SET medicine_deleted = 1 WHERE medicine_id = ?",
            (medicine_id,),
        )
        conn.execute("DELETE FROM medicines WHERE id = ?", (medicine_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

def list_appointments(patient_id):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM appointments WHERE patient_id = ? ORDER BY date, time",
            (patient_id,),
        ).fetchall()
        return [_appointment_to_dict(row) for row in rows]
    finally:
        conn.close()


def get_appointment(appointment_id):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM appointments WHERE id = ?", (appointment_id,)
        ).fetchone()
        return _appointment_to_dict(row)
    finally:
        conn.close()


def create_appointment(patient_id, data):
    doctor = str(data.get("doctor") or "").strip()
    speciality = str(data.get("speciality") or "").strip()
    date_value = str(data.get("date") or "").strip()
    time_value = _normalise_time(data.get("time") or "09:00")
    location = str(data.get("location") or "").strip()
    notes = str(data.get("notes") or "").strip()
    status = str(data.get("status") or "scheduled").strip() or "scheduled"

    if not doctor:
        raise ValueError("Please enter the doctor's name.")
    if not date_value or not _is_valid_date(date_value):
        raise ValueError("Please enter a valid appointment date.")
    if not _is_valid_time(time_value):
        raise ValueError("Please enter a valid appointment time.")

    conn = get_connection()
    try:
        patient = conn.execute(
            "SELECT 1 FROM patients WHERE id = ?", (patient_id,)
        ).fetchone()
        if patient is None:
            raise ValueError("That patient could not be found.")

        appointment_id = "apt_" + uuid.uuid4().hex[:12]
        conn.execute(
            """
            INSERT INTO appointments
                (id, patient_id, doctor, speciality, date, time, location,
                 notes, status, sample, reminder_sent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
            """,
            (
                appointment_id, patient_id, doctor, speciality, date_value,
                time_value, location, notes, status, _now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return get_appointment(appointment_id)


def update_appointment(appointment_id, data):
    field_map = {
        "doctor": "doctor",
        "speciality": "speciality",
        "date": "date",
        "time": "time",
        "location": "location",
        "notes": "notes",
        "status": "status",
    }

    sets = []
    params = []
    for key, column in field_map.items():
        if key in data and data[key] is not None:
            value = data[key]
            if key == "time":
                value = _normalise_time(value)
            sets.append(f"{column} = ?")
            params.append(value)

    if not sets:
        return get_appointment(appointment_id)

    params.append(appointment_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            f"UPDATE appointments SET {', '.join(sets)} WHERE id = ?", params
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
    finally:
        conn.close()

    return get_appointment(appointment_id)


def delete_appointment(appointment_id):
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM appointments WHERE id = ?", (appointment_id,)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def mark_appointment_reminder_sent(appointment_id):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE appointments SET reminder_sent = 1 WHERE id = ?",
            (appointment_id,),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

def _stored_reminder_keys(patient_id, from_date, to_date):
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT medicine_id, scheduled_date, scheduled_time
            FROM reminders
            WHERE patient_id = ? AND scheduled_date BETWEEN ? AND ?
            """,
            (patient_id, from_date, to_date),
        ).fetchall()
        return {
            (row["medicine_id"], row["scheduled_date"], row["scheduled_time"])
            for row in rows
        }
    finally:
        conn.close()


def _stored_reminders(patient_id, from_date, to_date):
    """Return stored reminder rows, mapping past-due 'pending' to 'missed'."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM reminders
            WHERE patient_id = ? AND scheduled_date BETWEEN ? AND ?
            """,
            (patient_id, from_date, to_date),
        ).fetchall()
    finally:
        conn.close()

    result = []
    for row in rows:
        item = _reminder_to_dict(row)
        if item["status"] == "pending":
            item["status"] = "missed" if _is_past(item["scheduledDate"], item["scheduledTime"]) else "upcoming"
        result.append(item)
    return result


def _derive_reminders(patient_id, from_date, to_date):
    """
    Work out the 'missed' rows the scheduler has not written yet.

    For every active medicine, walk each day in the requested window and each
    dose time. If the time has passed and there is no stored reminder row for
    that slot, produce a synthetic 'missed' row. This matches the frontend's
    behaviour, so history is honest even for doses from before the backend was
    running.
    """
    medicines = [m for m in list_medicines(patient_id, active_only=False) if m["active"]]
    stored_keys = _stored_reminder_keys(patient_id, from_date, to_date)

    now = datetime.now()
    today = _today_iso()
    now_minutes = now.hour * 60 + now.minute

    try:
        start = datetime.strptime(from_date, "%Y-%m-%d").date()
        end = datetime.strptime(to_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return []

    derived = []
    day = start
    while day <= end:
        date_iso = day.isoformat()
        for med in medicines:
            if med["startDate"] and date_iso < med["startDate"]:
                continue
            if med["endDate"] and date_iso > med["endDate"]:
                continue
            for raw_time in med["times"]:
                time_value = _normalise_time(raw_time)
                # Never materialise future doses in the history view.
                if date_iso > today:
                    continue
                if date_iso == today and _time_to_minutes(time_value) > now_minutes:
                    continue

                key = (med["id"], date_iso, time_value)
                if key in stored_keys:
                    continue

                derived.append({
                    "id": f"derived_{med['id']}_{date_iso}_{time_value}",
                    "patientId": patient_id,
                    "medicineId": med["id"],
                    "medicineName": med["name"],
                    "dose": med["dose"],
                    "scheduledDate": date_iso,
                    "scheduledTime": time_value,
                    "status": "missed",
                    "recordedAt": None,
                    "note": "",
                    "notifiedAt": None,
                    "auto": True,
                    "sample": med["sample"],
                    "medicineDeleted": False,
                })
        day += timedelta(days=1)

    return derived


def list_reminders(patient_id, status=None, from_date=None, to_date=None):
    """
    Return reminder rows (stored + derived) newest first.

    When no range is supplied we look back ``DEFAULT_LOG_WINDOW_DAYS``, which is
    the same window the frontend uses.
    """
    today = _today_iso()
    if not from_date:
        from_date = (date.today() - timedelta(days=DEFAULT_LOG_WINDOW_DAYS - 1)).isoformat()
    if not to_date:
        to_date = today
    # History never shows the future.
    if to_date > today:
        to_date = today

    derived = _derive_reminders(patient_id, from_date, to_date)
    stored = _stored_reminders(patient_id, from_date, to_date)

    merged = {}
    for item in derived:
        merged[(item["medicineId"], item["scheduledDate"], item["scheduledTime"])] = item
    for item in stored:
        merged[(item["medicineId"], item["scheduledDate"], item["scheduledTime"])] = item

    rows = list(merged.values())
    if status and status != "all":
        rows = [r for r in rows if r["status"] == status]

    rows.sort(key=lambda r: (r["scheduledDate"], r["scheduledTime"]), reverse=True)
    return rows


def today_doses(patient_id):
    """Return today's schedule, resolved against any stored reminder rows."""
    today = _today_iso()
    now = datetime.now()
    now_minutes = now.hour * 60 + now.minute

    medicines = [m for m in list_medicines(patient_id, active_only=False) if m["active"]]

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE patient_id = ? AND scheduled_date = ?",
            (patient_id, today),
        ).fetchall()
    finally:
        conn.close()

    stored_by_key = {}
    for row in rows:
        item = _reminder_to_dict(row)
        stored_by_key[(item["medicineId"], item["scheduledTime"])] = item

    doses = []
    for med in medicines:
        if med["startDate"] and today < med["startDate"]:
            continue
        if med["endDate"] and today > med["endDate"]:
            continue
        for raw_time in med["times"]:
            time_value = _normalise_time(raw_time)
            log = stored_by_key.get((med["id"], time_value))

            if log is not None:
                if log["status"] == "pending":
                    status = "missed" if _time_to_minutes(time_value) <= now_minutes else "upcoming"
                else:
                    status = log["status"]
                log_id = log["id"]
            else:
                status = "missed" if _time_to_minutes(time_value) <= now_minutes else "upcoming"
                log_id = None

            doses.append({
                "medicineId": med["id"],
                "medicineName": med["name"],
                "dose": med["dose"],
                "notes": med["notes"],
                "scheduledDate": today,
                "scheduledTime": time_value,
                "status": status,
                "logId": log_id,
            })

    doses.sort(key=lambda d: _time_to_minutes(d["scheduledTime"]))
    return doses


def upsert_reminder(patient_id, data):
    """
    Record a dose as taken / skipped (or another explicit status).

    The frontend calls this with keys like ``medicineId`` and ``scheduledTime``.
    We upsert on (patient_id, medicine_id, scheduled_date, scheduled_time) so
    marking a derived 'missed' slot as taken corrects it instead of duplicating.
    """
    medicine_id = str(data.get("medicineId") or "")
    scheduled_date = str(data.get("scheduledDate") or _today_iso())
    scheduled_time = _normalise_time(data.get("scheduledTime") or "")
    status = str(data.get("status") or "taken").lower()
    if status not in ("taken", "skipped", "pending", "help", "later"):
        status = "taken"

    if not medicine_id:
        raise ValueError("Missing medicine id.")
    if not _is_valid_date(scheduled_date):
        raise ValueError("Please enter a valid reminder date.")
    if not _is_valid_time(scheduled_time):
        raise ValueError("Please enter a valid reminder time.")

    medicine_name = str(data.get("medicineName") or "")
    dose = str(data.get("dose") or "")
    note = str(data.get("note") or "")
    recorded_at = _now_iso() if status in ("taken", "skipped", "help", "later") else None

    conn = get_connection()
    try:
        existing = conn.execute(
            """
            SELECT id FROM reminders
            WHERE patient_id = ? AND medicine_id = ? AND scheduled_date = ? AND scheduled_time = ?
            """,
            (patient_id, medicine_id, scheduled_date, scheduled_time),
        ).fetchone()

        if existing is not None:
            conn.execute(
                """
                UPDATE reminders
                SET medicine_name = ?, dose = ?, status = ?, recorded_at = ?,
                    note = ?, auto = 0
                WHERE id = ?
                """,
                (medicine_name, dose, status, recorded_at, note, existing["id"]),
            )
            reminder_id = existing["id"]
        else:
            reminder_id = "rem_" + uuid.uuid4().hex[:12]
            conn.execute(
                """
                INSERT INTO reminders
                    (id, patient_id, medicine_id, medicine_name, dose,
                     scheduled_date, scheduled_time, status, recorded_at, note,
                     notified_at, auto, sample, medicine_deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
                """,
                (
                    reminder_id, patient_id, medicine_id, medicine_name, dose,
                    scheduled_date, scheduled_time, status, recorded_at, note,
                ),
            )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM reminders WHERE id = ?", (reminder_id,)
        ).fetchone()
        return _reminder_to_dict(row)
    finally:
        conn.close()


def get_or_create_pending_reminder(patient_id, medicine, scheduled_date, scheduled_time):
    """
    Create a 'pending' reminder row for a due dose if one does not exist yet.
    Returns ``(reminder_dict, created)``.
    """
    medicine_id = medicine["id"]
    name = medicine.get("name", "")
    dose = medicine.get("dose", "")
    reminder_id = "rem_" + uuid.uuid4().hex[:12]

    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO reminders
                (id, patient_id, medicine_id, medicine_name, dose,
                 scheduled_date, scheduled_time, status, recorded_at, note,
                 notified_at, auto, sample, medicine_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', NULL, 1, 0, 0)
            """,
            (reminder_id, patient_id, medicine_id, name, dose, scheduled_date, scheduled_time),
        )
        conn.commit()

        row = conn.execute(
            """
            SELECT * FROM reminders
            WHERE patient_id = ? AND medicine_id = ? AND scheduled_date = ? AND scheduled_time = ?
            """,
            (patient_id, medicine_id, scheduled_date, scheduled_time),
        ).fetchone()
        return _reminder_to_dict(row), row["id"] == reminder_id
    finally:
        conn.close()


def get_reminder(reminder_id):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM reminders WHERE id = ?", (reminder_id,)
        ).fetchone()
        return _reminder_to_dict(row)
    finally:
        conn.close()


def update_reminder_status(reminder_id, status):
    recorded_at = _now_iso() if status in ("taken", "skipped", "help", "later") else None
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE reminders SET status = ?, recorded_at = ?, auto = 0 WHERE id = ?",
            (status, recorded_at, reminder_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM reminders WHERE id = ?", (reminder_id,)
        ).fetchone()
        return _reminder_to_dict(row)
    finally:
        conn.close()


def mark_reminder_notified(reminder_id):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE reminders SET notified_at = ? WHERE id = ?",
            (_now_iso(), reminder_id),
        )
        conn.commit()
    finally:
        conn.close()


def find_reply_reminder(patient_id):
    """Find the reminder an SMS reply most likely refers to."""
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT * FROM reminders
            WHERE patient_id = ? AND status = 'pending'
            ORDER BY scheduled_date DESC, scheduled_time DESC
            LIMIT 1
            """,
            (patient_id,),
        ).fetchone()
        if row is None:
            row = conn.execute(
                """
                SELECT * FROM reminders
                WHERE patient_id = ?
                ORDER BY scheduled_date DESC, scheduled_time DESC
                LIMIT 1
                """,
                (patient_id,),
            ).fetchone()
        return _reminder_to_dict(row)
    finally:
        conn.close()


def create_fallback_reminder(patient_id):
    """
    If a reply arrives before the scheduler has written a row, create one from
    the patient's first active medicine so the demo reply still does something.
    """
    medicines = list_medicines(patient_id, active_only=True)
    if not medicines:
        return None
    med = medicines[0]
    times = sorted(med["times"])
    time_value = times[0] if times else "08:00"
    reminder, _ = get_or_create_pending_reminder(patient_id, med, _today_iso(), time_value)
    return reminder


# ---------------------------------------------------------------------------
# Dashboard aggregates
# ---------------------------------------------------------------------------

def _count_patients():
    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM patients").fetchone()
        return row["n"]
    finally:
        conn.close()


def _count_reminders(patient_id, status=None, date_value=None):
    conn = get_connection()
    try:
        sql = "SELECT COUNT(*) AS n FROM reminders WHERE patient_id = ?"
        params = [patient_id]
        if status:
            sql += " AND status = ?"
            params.append(status)
        if date_value:
            sql += " AND scheduled_date = ?"
            params.append(date_value)
        row = conn.execute(sql, params).fetchone()
        return row["n"]
    finally:
        conn.close()


def dashboard_summary(patient_id):
    """Return the numbers the dashboard's four stat cards need."""
    today = _today_iso()

    medicines = list_medicines(patient_id, active_only=False)
    active_medicines = [m for m in medicines if m["active"]]

    doses_today = 0
    for med in active_medicines:
        if med["startDate"] and today < med["startDate"]:
            continue
        if med["endDate"] and today > med["endDate"]:
            continue
        doses_today += len(med["times"])

    taken_today = _count_reminders(patient_id, status="taken", date_value=today)

    # Matches the frontend: only past-due slots still outstanding count as missed.
    missed = len(list_reminders(patient_id, status="missed"))

    appointments = [
        a for a in list_appointments(patient_id)
        if a["status"] == "scheduled" and a["date"] >= today
    ]
    appointments.sort(key=lambda a: (a["date"], a["time"]))
    next_appointment = appointments[0] if appointments else None

    return {
        "patients": _count_patients(),
        "medicines": len(active_medicines),
        "medicinesTotal": len(medicines),
        "dosesToday": doses_today,
        "takenToday": taken_today,
        "missed": missed,
        "appointments": len(appointments),
        "nextAppointment": next_appointment,
    }


def adherence_summary(patient_id, from_date=None, to_date=None):
    """Return taken/missed/skipped counts and a percentage for a date range."""
    if not from_date:
        from_date = (date.today() - timedelta(days=364)).isoformat()
    if not to_date:
        to_date = _today_iso()

    rows = list_reminders(patient_id, from_date=from_date, to_date=to_date)
    total = len(rows)
    taken = sum(1 for r in rows if r["status"] == "taken")
    missed = sum(1 for r in rows if r["status"] == "missed")
    skipped = sum(1 for r in rows if r["status"] == "skipped")
    adherence = round((taken / total) * 100) if total else 0

    return {
        "total": total,
        "taken": taken,
        "missed": missed,
        "skipped": skipped,
        "adherence": adherence,
    }


# ---------------------------------------------------------------------------
# Scheduler support
# ---------------------------------------------------------------------------

def list_active_medicines_with_patients():
    """Return active medicines joined with their patient's contact details."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT m.*, p.name AS patient_name, p.phone AS patient_phone,
                   p.family_phone AS patient_family_phone
            FROM medicines m
            JOIN patients p ON p.id = m.patient_id
            WHERE m.active = 1
            """
        ).fetchall()

        result = []
        for row in rows:
            result.append({
                "medicine": _medicine_to_dict(row),
                "patient": {
                    "id": row["patient_id"],
                    "name": row["patient_name"],
                    "phone": row["patient_phone"],
                    "familyPhone": row["patient_family_phone"],
                },
            })
        return result
    finally:
        conn.close()


def list_upcoming_appointments_with_patients():
    """Return scheduled (future/today) appointments joined with patient details."""
    today = _today_iso()
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT a.*, p.name AS patient_name, p.phone AS patient_phone,
                   p.family_phone AS patient_family_phone
            FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            WHERE a.status = 'scheduled' AND a.date >= ?
            ORDER BY a.date, a.time
            """,
            (today,),
        ).fetchall()

        result = []
        for row in rows:
            result.append({
                "appointment": _appointment_to_dict(row),
                "patient": {
                    "id": row["patient_id"],
                    "name": row["patient_name"],
                    "phone": row["patient_phone"],
                    "familyPhone": row["patient_family_phone"],
                },
            })
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Demo seed
# ---------------------------------------------------------------------------

def _seed_demo_if_needed(conn):
    row = conn.execute(
        "SELECT 1 FROM patients WHERE email = ?", (DEMO_EMAIL,)
    ).fetchone()
    if row is None:
        _seed_demo(conn)


def _seed_demo(conn):
    """Create one clearly-labelled sample account so the app is not empty."""
    now = _now_iso()
    today = date.today()
    patient_id = "pat_demo"
    password_hash = generate_password_hash(DEMO_PASSWORD)

    conn.execute(
        """
        INSERT INTO patients
            (id, name, email, phone, dob, family_phone, password_hash,
             sample, sample_notice_dismissed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
        """,
        (
            patient_id, "Meera Sharma", DEMO_EMAIL, "+919820041122",
            "1952-03-14", "+919811223344", password_hash, now,
        ),
    )

    medicines = [
        {"name": "Metformin", "dose": "500 mg", "times": ["08:00", "20:00"],
         "start": (today - timedelta(days=60)).isoformat(), "end": None,
         "notes": "Take with food. For blood sugar control."},
        {"name": "Amlodipine", "dose": "5 mg", "times": ["09:00"],
         "start": (today - timedelta(days=45)).isoformat(), "end": None,
         "notes": "One tablet after breakfast. For blood pressure."},
        {"name": "Atorvastatin", "dose": "10 mg", "times": ["21:00"],
         "start": (today - timedelta(days=30)).isoformat(), "end": None,
         "notes": "Take after dinner."},
        {"name": "Vitamin D3", "dose": "1000 IU", "times": ["09:00"],
         "start": (today - timedelta(days=20)).isoformat(),
         "end": (today + timedelta(days=10)).isoformat(),
         "notes": "Short course. Stop when the box is finished."},
    ]

    med_records = []
    for med in medicines:
        medicine_id = "med_demo_" + uuid.uuid4().hex[:8]
        med_records.append((medicine_id, med))
        conn.execute(
            """
            INSERT INTO medicines
                (id, patient_id, name, dose, times, start_date, end_date,
                 notes, active, sample, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
            """,
            (
                medicine_id, patient_id, med["name"], med["dose"],
                json.dumps(med["times"]), med["start"], med["end"],
                med["notes"], now,
            ),
        )

    appointments = [
        {"doctor": "Dr. Anita Rao", "speciality": "Cardiologist",
         "date": (today + timedelta(days=3)).isoformat(), "time": "10:30",
         "location": "City Heart Clinic, Room 4", "notes": "Bring the blood pressure diary."},
        {"doctor": "Dr. Farhan Ali", "speciality": "Diabetes clinic",
         "date": (today + timedelta(days=12)).isoformat(), "time": "15:00",
         "location": "Sunrise Medical Centre, Block B", "notes": "Fasting sugar test one day before."},
    ]
    for apt in appointments:
        conn.execute(
            """
            INSERT INTO appointments
                (id, patient_id, doctor, speciality, date, time, location,
                 notes, status, sample, reminder_sent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 1, 0, ?)
            """,
            (
                "apt_demo_" + uuid.uuid4().hex[:8], patient_id, apt["doctor"],
                apt["speciality"], apt["date"], apt["time"], apt["location"],
                apt["notes"], now,
            ),
        )

    # A week of 'taken' history so the history page and adherence figure are not
    # empty on first open. Today is left alone: the scheduler + derivation handle it.
    for medicine_id, med in med_records:
        for offset in range(1, 8):
            scheduled_date = (today - timedelta(days=offset)).isoformat()
            for raw_time in med["times"]:
                time_value = _normalise_time(raw_time)
                conn.execute(
                    """
                    INSERT INTO reminders
                        (id, patient_id, medicine_id, medicine_name, dose,
                         scheduled_date, scheduled_time, status, recorded_at, note,
                         notified_at, auto, sample, medicine_deleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'taken', ?, '', NULL, 0, 1, 0)
                    """,
                    (
                        "rem_demo_" + uuid.uuid4().hex[:10], patient_id,
                        medicine_id, med["name"], med["dose"], scheduled_date,
                        time_value, f"{scheduled_date}T{time_value}:00",
                    ),
                )

    conn.commit()

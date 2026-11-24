"""
SehatCall -- Flask server.

Run it on Windows from the project folder:

    pip install -r requirements.txt
    python app.py

Then open http://127.0.0.1:5000/login.html

This one file does three jobs:

  1. serves the existing HTML, CSS and JavaScript files,
  2. implements every API route that ``js/api.js`` calls,
  3. adds the Twilio SMS webhook and a demo ``/api/simulate-reply`` route.
"""

import os
from xml.sax.saxutils import escape as xml_escape

from flask import Flask, Response, abort, jsonify, request, send_from_directory, session

import database
import notifications
from reminder import start_scheduler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)

# The secret key signs the session cookie. Change this in production.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "sehatcall-dev-secret-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Make sure the database folder, tables and demo account exist before the first
# request arrives.
database.init_db()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def error(message, status=400):
    """Return a JSON error in the shape js/api.js expects."""
    return jsonify({"error": message}), status


def twiml(message):
    """Wrap a text message in the TwiML Twilio expects from a webhook."""
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Message>" + xml_escape(message) + "</Message></Response>"
    )
    return Response(xml, mimetype="text/xml")


# ---------------------------------------------------------------------------
# Static files (the existing frontend, served from the project root)
# ---------------------------------------------------------------------------

PAGES = {
    "index.html": "index.html",
    "login.html": "login.html",
    "register.html": "register.html",
    "medicines.html": "medicines.html",
    "appointments.html": "appointments.html",
    "reminders.html": "reminders.html",
}


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<page>")
def serve_page(page):
    if page in PAGES:
        return send_from_directory(BASE_DIR, PAGES[page])
    abort(404)


@app.route("/design-tokens.css")
def design_tokens():
    return send_from_directory(BASE_DIR, "design-tokens.css")


@app.route("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "js"), filename)


# ---------------------------------------------------------------------------
# Patients / users
# ---------------------------------------------------------------------------

@app.route("/api/patients", methods=["GET"])
def api_list_patients():
    return jsonify(database.list_patients())


@app.route("/api/patients", methods=["POST"])
def api_create_patient():
    data = request.get_json(silent=True) or {}
    try:
        patient = database.create_patient(data)
    except ValueError as exc:
        status = 409 if "already exists" in str(exc).lower() else 400
        return error(str(exc), status)

    # Log the new account in immediately (same behaviour as the frontend).
    session["patient_id"] = patient["id"]
    return jsonify(patient), 201


@app.route("/api/patients/<patient_id>", methods=["GET"])
def api_get_patient(patient_id):
    patient = database.get_patient(patient_id)
    if patient is None:
        return error("Patient not found.", 404)
    return jsonify(patient)


@app.route("/api/patients/me/dismiss-sample-notice", methods=["POST"])
def api_dismiss_sample_notice():
    patient_id = session.get("patient_id")
    if patient_id:
        database.dismiss_sample_notice(patient_id)
    return jsonify({"ok": True})


@app.route("/api/patients/<patient_id>/clear-sample-data", methods=["POST"])
def api_clear_sample_data(patient_id):
    return jsonify(database.clear_sample_data(patient_id))


@app.route("/api/dev/reset", methods=["POST"])
def api_dev_reset():
    """Dev-only: wipe everything and put the demo account back."""
    database.reset_all()
    session.clear()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Session (login / logout)
# ---------------------------------------------------------------------------

@app.route("/api/session", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "")
    password = str(data.get("password") or "")

    patient = database.verify_patient(email, password)
    if patient is None:
        return error("That email and password do not match. Please try again.", 401)

    session["patient_id"] = patient["id"]
    return jsonify(patient)


@app.route("/api/session", methods=["DELETE"])
def api_logout():
    session.clear()
    return "", 204


# ---------------------------------------------------------------------------
# Medicines
# ---------------------------------------------------------------------------

@app.route("/api/medicines", methods=["GET"])
def api_list_medicines():
    patient_id = request.args.get("patient_id", "")
    active_only = request.args.get("active") == "1"
    return jsonify(database.list_medicines(patient_id, active_only))


@app.route("/api/medicines", methods=["POST"])
def api_create_medicine():
    data = request.get_json(silent=True) or {}
    patient_id = str(data.get("patient_id") or data.get("patientId") or "")
    try:
        medicine = database.create_medicine(patient_id, data)
    except ValueError as exc:
        return error(str(exc), 400)
    return jsonify(medicine), 201


@app.route("/api/medicines/<medicine_id>", methods=["PATCH"])
def api_update_medicine(medicine_id):
    data = request.get_json(silent=True) or {}
    medicine = database.update_medicine(medicine_id, data)
    if medicine is None:
        return error("That medicine could not be found.", 404)
    return jsonify(medicine)


@app.route("/api/medicines/<medicine_id>", methods=["DELETE"])
def api_delete_medicine(medicine_id):
    if not database.delete_medicine(medicine_id):
        return error("That medicine could not be found.", 404)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

@app.route("/api/appointments", methods=["GET"])
def api_list_appointments():
    patient_id = request.args.get("patient_id", "")
    return jsonify(database.list_appointments(patient_id))


@app.route("/api/appointments", methods=["POST"])
def api_create_appointment():
    data = request.get_json(silent=True) or {}
    patient_id = str(data.get("patient_id") or data.get("patientId") or "")
    try:
        appointment = database.create_appointment(patient_id, data)
    except ValueError as exc:
        return error(str(exc), 400)
    return jsonify(appointment), 201


@app.route("/api/appointments/<appointment_id>", methods=["PATCH"])
def api_update_appointment(appointment_id):
    data = request.get_json(silent=True) or {}
    appointment = database.update_appointment(appointment_id, data)
    if appointment is None:
        return error("That appointment could not be found.", 404)
    return jsonify(appointment)


@app.route("/api/appointments/<appointment_id>", methods=["DELETE"])
def api_delete_appointment(appointment_id):
    if not database.delete_appointment(appointment_id):
        return error("That appointment could not be found.", 404)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

@app.route("/api/reminders", methods=["GET"])
def api_list_reminders():
    patient_id = request.args.get("patient_id", "")
    status = request.args.get("status", "")
    from_date = request.args.get("from", "")
    to_date = request.args.get("to", "")
    return jsonify(
        database.list_reminders(
            patient_id,
            status or None,
            from_date or None,
            to_date or None,
        )
    )


@app.route("/api/reminders", methods=["POST"])
def api_mark_dose():
    data = request.get_json(silent=True) or {}
    patient_id = str(data.get("patient_id") or data.get("patientId") or "")
    try:
        reminder = database.upsert_reminder(patient_id, data)
    except ValueError as exc:
        return error(str(exc), 400)
    return jsonify(reminder)


@app.route("/api/reminders/today", methods=["GET"])
def api_today_doses():
    patient_id = request.args.get("patient_id", "")
    return jsonify(database.today_doses(patient_id))


@app.route("/api/reminders/summary", methods=["GET"])
def api_reminders_summary():
    patient_id = request.args.get("patient_id", "")
    from_date = request.args.get("from", "")
    to_date = request.args.get("to", "")
    return jsonify(
        database.adherence_summary(
            patient_id,
            from_date or None,
            to_date or None,
        )
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@app.route("/api/dashboard/summary", methods=["GET"])
def api_dashboard_summary():
    patient_id = request.args.get("patient_id", "")
    return jsonify(database.dashboard_summary(patient_id))


# ---------------------------------------------------------------------------
# SMS webhook + demo reply
# ---------------------------------------------------------------------------

def _apply_reply(patient, reply):
    """
    Turn an SMS reply into an action.

      1 -> Taken
      2 -> Help   (send a family emergency alert)
      3 -> Later
    """
    reply = str(reply or "").strip().lower()

    if reply in ("1", "taken"):
        status = "taken"
    elif reply in ("2", "help"):
        status = "help"
    elif reply in ("3", "later"):
        status = "later"
    else:
        return {
            "message": "Please reply 1 for Taken, 2 for Help, or 3 for Later.",
            "status": "unknown",
        }

    reminder = database.find_reply_reminder(patient["id"])
    if reminder is None:
        reminder = database.create_fallback_reminder(patient["id"])
    if reminder is None:
        return {"message": "No reminder could be found for this account.", "status": "none"}

    reminder = database.update_reminder_status(reminder["id"], status)

    if status == "help":
        notifications.send_family_emergency_alert(patient, reminder.get("medicineName"))
        return {
            "message": "Help request received. Your family has been alerted.",
            "status": "help",
            "reminder": reminder,
        }
    if status == "taken":
        return {
            "message": "Marked as taken. Well done!",
            "status": "taken",
            "reminder": reminder,
        }
    return {
        "message": "Got it. We will remind you again later.",
        "status": "later",
        "reminder": reminder,
    }


@app.route("/webhook/sms", methods=["POST"])
def webhook_sms():
    """Twilio calls this route when a patient replies to a reminder SMS."""
    from_number = request.form.get("From", "")
    body = request.form.get("Body", "")

    patient = database.get_patient_by_phone(from_number)
    if patient is None:
        return twiml("Sorry, we could not find a SehatCall account for this number.")

    result = _apply_reply(patient, body)
    return twiml(result.get("message", "Thank you."))


@app.route("/api/simulate-reply", methods=["POST"])
def api_simulate_reply():
    """
    Hackathon demo helper: simulate an incoming SMS reply without Twilio.

    Send JSON like:

        {"phone": "+91 98200 41122", "reply": "2"}

    or, using a patient id:

        {"patient_id": "pat_demo", "reply": "1"}
    """
    if request.is_json:
        data = request.get_json(silent=True) or {}
    else:
        data = request.form.to_dict()

    patient_id = str(data.get("patient_id") or data.get("patientId") or "")
    phone = str(data.get("phone") or data.get("From") or "")
    reply = str(data.get("reply") or data.get("Body") or "")

    if patient_id:
        patient = database.get_patient(patient_id)
    elif phone:
        patient = database.get_patient_by_phone(phone)
    else:
        patient = None

    if patient is None:
        return error("No patient found for that phone number or patient id.", 404)

    return jsonify(_apply_reply(patient, reply))


# ---------------------------------------------------------------------------
# CORS (only needed if you serve the frontend from another localhost port)
# ---------------------------------------------------------------------------

ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
}


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    return response


@app.route("/api/<path:path>", methods=["OPTIONS"])
def api_options(path):
    return "", 204


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # use_reloader=False keeps the scheduler from starting twice in debug mode.
    start_scheduler(app)
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)

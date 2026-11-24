"""
SehatCall -- notifications.

This file contains the functions that send SMS messages:

  * medicine reminders,
  * appointment reminders,
  * family emergency alerts.

It uses Twilio when the three environment variables below are set. If they are
NOT set (the normal local/hackathon case on Windows), it falls back to printing
the message to the console so everything can be tested without a Twilio account.

Set the variables in PowerShell/Command Prompt like this before running:

    set TWILIO_ACCOUNT_SID=your_account_sid
    set TWILIO_AUTH_TOKEN=your_auth_token
    set TWILIO_FROM_NUMBER=+14155238886
"""

import os

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")


def _twilio_configured():
    """True when all three Twilio settings are present."""
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER)


def send_sms(to_number, message):
    """
    Send one SMS. Returns True on success.

    In mock mode the message is printed to the console instead, so the app is
    fully testable on Windows with no external service.
    """
    to_number = (to_number or "").strip()
    if not to_number:
        print("[notifications] Skipped SMS: no destination phone number.")
        return False

    if _twilio_configured():
        try:
            # Twilio is imported lazily so the rest of the app runs even if the
            # package is not installed and only the mock path is being used.
            from twilio.rest import Client

            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            sent = client.messages.create(
                to=to_number,
                from_=TWILIO_FROM_NUMBER,
                body=message,
            )
            print(f"[notifications] Twilio SMS sent to {to_number}: {sent.sid}")
            return True
        except Exception as exc:  # network/auth errors must not crash the app
            print(f"[notifications] Twilio error: {exc}")
            print(f"[notifications] MOCK SMS -> {to_number}: {message}")
            return False

    print(f"[notifications] MOCK SMS -> {to_number}: {message}")
    return True


def send_medicine_reminder(patient, medicine, time_value):
    """Remind a patient to take one dose, and explain the reply codes."""
    body = (
        f"SehatCall reminder: {patient.get('name', 'Patient')}, please take "
        f"{medicine.get('name', 'your medicine')} ({medicine.get('dose', '')}). "
        f"Reply 1=Taken, 2=Help, 3=Later."
    )
    return send_sms(patient.get("phone", ""), body)


def send_appointment_reminder(patient, appointment):
    """Remind a patient about an appointment that is coming up."""
    body = (
        f"SehatCall: {patient.get('name', 'Patient')}, you have an appointment "
        f"with {appointment.get('doctor', 'your doctor')} at "
        f"{appointment.get('time', '')} today"
        + (f" ({appointment.get('location')})" if appointment.get("location") else "")
        + "."
    )
    return send_sms(patient.get("phone", ""), body)


def send_family_emergency_alert(patient, medicine_name=None):
    """
    Alert the patient's family emergency contact. This is the action behind
    an SMS reply of "2" (Help).
    """
    body = (
        f"SehatCall emergency alert: {patient.get('name', 'A patient')} needs help "
        f"with {medicine_name or 'a medicine'}. Please contact them or their clinic."
    )
    destination = patient.get("familyPhone") or patient.get("family_phone") or ""
    return send_sms(destination, body)

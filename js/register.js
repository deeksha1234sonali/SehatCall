/*
  SehatCall -- registration page behaviour.

  Two things worth noting:

  1. The form is validated on submit rather than on every keystroke. Per-keystroke
     error messages on a form this size punish slow typists by shouting at them
     mid-word. Errors appear once, then clear as soon as that field is fixed.

  2. register.html is also reachable as "Add a patient" from the sidebar. In that
     case the visitor already has a session, so redirectIfSignedIn() must not
     bounce them -- the guard below only redirects when there is no ?new=1.
*/

(function () {
  'use strict';

  var form = document.getElementById('registerForm');
  var submitBtn = document.getElementById('registerBtn');
  var nameInput = document.getElementById('name');
  var emailInput = document.getElementById('email');
  var phoneInput = document.getElementById('phone');
  var dobInput = document.getElementById('dob');
  var passwordInput = document.getElementById('password');
  var confirmInput = document.getElementById('passwordConfirm');
  var consentInput = document.getElementById('consent');

  var isAddPatientMode = UI.hasNewParam();

  (async function init() {
    await API.init();
    /* Someone already signed in who came here from "Add a patient" still needs
       the form; anyone else with a session gets sent to their dashboard. */
    if (!isAddPatientMode) {
      await Auth.redirectIfSignedIn();
    }
    UI.wirePasswordToggle('togglePassword', 'password');
    UI.wirePasswordToggle('togglePasswordConfirm', 'passwordConfirm');

    if (isAddPatientMode) {
      var heading = document.querySelector('.auth-heading');
      var sub = document.querySelector('.auth-sub');
      if (heading) heading.textContent = 'Add another patient';
      if (sub) {
        sub.textContent = 'Create a separate account for a family member. You can switch by signing in with their email.';
      }
    }
  })();

  /* Clearing an error the moment its field is corrected -- but only touching
     the field that changed, so the others keep their messages. */
  function clearOnFix(input, name, validate) {
    if (!input) return;
    input.addEventListener('input', function () {
      if (validate(input.value) === null) UI.fieldError(form, name, null);
    });
  }

  clearOnFix(nameInput, 'name', Auth.validators.name);
  clearOnFix(emailInput, 'email', Auth.validators.email);
  clearOnFix(phoneInput, 'phone', Auth.validators.phone);
  clearOnFix(dobInput, 'dob', Auth.validators.dob);
  clearOnFix(passwordInput, 'password', Auth.validators.password);
  clearOnFix(consentInput, 'consent', function (value) {
    return consentInput.checked ? null : 'Please tick the box to continue.';
  });

  confirmInput.addEventListener('input', function () {
    if (confirmInput.value === passwordInput.value) UI.fieldError(form, 'passwordConfirm', null);
  });

  /* Date pickers on some platforms happily accept a future date by keyboard;
     a max attribute stops that before it becomes an error message. */
  if (dobInput) dobInput.setAttribute('max', API.todayISO());

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    UI.clearErrors(form);

    var errors = {};

    var nameErr = Auth.validators.name(nameInput.value);
    if (nameErr) errors.name = nameErr;

    var emailErr = Auth.validators.email(emailInput.value);
    if (emailErr) errors.email = emailErr;

    var phoneErr = Auth.validators.phone(phoneInput.value);
    if (phoneErr) errors.phone = phoneErr;

    var dobErr = Auth.validators.dob(dobInput.value);
    if (dobErr) errors.dob = dobErr;

    var passwordErr = Auth.validators.password(passwordInput.value);
    if (passwordErr) errors.password = passwordErr;

    if (!confirmInput.value) {
      errors.passwordConfirm = 'Please repeat your password.';
    } else if (confirmInput.value !== passwordInput.value) {
      errors.passwordConfirm = 'The two passwords do not match. Please type them again.';
    }

    if (!consentInput.checked) {
      errors.consent = 'Please tick the box to continue.';
    }

    if (Object.keys(errors).length) {
      UI.showErrors(form, errors);
      UI.formStatus(form, 'Please check the ' + Object.keys(errors).length +
        (Object.keys(errors).length === 1 ? ' highlighted field.' : ' highlighted fields.'), 'error');
      return;
    }

    UI.setBusy(submitBtn, true, 'Creating account…');
    UI.formStatus(form, 'Creating your account…', 'info');

    try {
      await Auth.register({
        name: nameInput.value,
        email: emailInput.value,
        phone: phoneInput.value,
        dob: dobInput.value,
        password: passwordInput.value,
      });
      UI.formStatus(form, 'Account created. Taking you to your dashboard…', 'success');
      window.location.href = 'index.html?welcome=1';
    } catch (err) {
      UI.setBusy(submitBtn, false);
      /* The common failure here is a duplicate email, which belongs on the
         email field -- not on the form as a whole. */
      var duplicate = /already exists/i.test(err.message);
      if (duplicate) {
        UI.fieldError(form, 'email', err.message);
        emailInput.focus();
      }
      UI.formStatus(form, err.message, 'error');
    }
  });
})();

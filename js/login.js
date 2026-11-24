/*
  SehatCall -- sign-in page behaviour.
*/

(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var submitBtn = document.getElementById('loginBtn');
  var demoBtn = document.getElementById('demoBtn');
  var resetLink = document.getElementById('resetLink');

  /* Where to land after signing in. Only a same-origin page name is accepted,
     so a crafted ?next=https://elsewhere.example cannot bounce the user off
     the app. */
  function nextTarget() {
    var raw = new URLSearchParams(window.location.search).get('next');
    if (!raw) return 'index.html';
    if (!/^[a-z0-9._-]+\.html(\?.*)?$/i.test(raw)) return 'index.html';
    return raw;
  }

  (async function init() {
    await API.init();
    /* An already signed-in visitor goes straight through rather than being
       asked to sign in twice. */
    await Auth.redirectIfSignedIn();
    /* Wired exactly once, here. Calling it twice would attach two handlers and
       the second would immediately undo the first, so the toggle would appear
       to do nothing at all. */
    UI.wirePasswordToggle('togglePassword', 'password');
  })();

  /* -- demo account ------------------------------------------------------- */

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      emailInput.value = API.DEMO_EMAIL;
      passwordInput.value = API.DEMO_PASSWORD;
      UI.clearErrors(form);
      UI.formStatus(form, 'Demo details filled in. Press Sign in to continue.', 'info');
      submitBtn.focus();
    });
  }

  /* -- sign in ------------------------------------------------------------ */

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    UI.clearErrors(form);

    var values = {
      email: emailInput.value,
      password: passwordInput.value,
    };

    var errors = {};
    var emailError = Auth.validators.email(values.email);
    if (emailError) errors.email = emailError;
    var passwordError = Auth.validators.loginPassword(values.password);
    if (passwordError) errors.password = passwordError;

    if (Object.keys(errors).length) {
      UI.showErrors(form, errors);
      return;
    }

    UI.setBusy(submitBtn, true, 'Signing in…');
    UI.formStatus(form, 'Signing in, please wait…', 'info');

    try {
      await Auth.login(values.email, values.password);
      UI.formStatus(form, 'Signed in. Opening your dashboard…', 'success');
      window.location.href = nextTarget();
    } catch (err) {
      UI.setBusy(submitBtn, false);
      /* Credential failure belongs to both fields at once -- putting it only
         under the password implies the email was recognised. */
      UI.showErrors(form, {
        email: err.message,
        password: err.message,
      });
      UI.formStatus(form, err.message, 'error');
    }
  });

  /* -- reset this device --------------------------------------------------
     A real action, not a placeholder: it clears the local demo data so a
     fresh account and the demo account are created again on next visit. It
     is the one place a user can recover from forgotten demo details. */

  if (resetLink) {
    resetLink.addEventListener('click', async function (event) {
      event.preventDefault();
      var yes = await UI.confirm({
        title: 'Reset this device?',
        message: 'This deletes the accounts, medicines and history stored in this browser and puts the demo data back.',
        details: 'Nothing is sent anywhere. Anything you added will be lost.',
        confirmLabel: 'Yes, reset everything',
        danger: true,
      });
      if (!yes) return;
      await API.resetEverything();
      window.location.href = 'login.html';
    });
  }
})();

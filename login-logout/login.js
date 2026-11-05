// ©HomeHub LLC 2026
(() => {
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const $ = id => document.getElementById(id);
  const form = $('loginForm'), msg = $('msg'), btn = $('emailBtn');

  function showMsg(text, isError = true) {
    msg.textContent = text;
    msg.hidden = !text;
    msg.style.borderColor = isError ? 'var(--danger)' : 'var(--done)';
  }
  function authMessage(code) {
    return ({
      'auth/invalid-credential': 'Wrong email or password.',
      'auth/user-not-found': 'Wrong email or password.',
      'auth/wrong-password': 'Wrong email or password.',
      'auth/missing-password': 'Enter your password.',
      'auth/operation-not-allowed': 'Email/password sign-in isn\u2019t turned on yet. In the Firebase console, open Authentication > Sign-in method and enable Email/Password.',
      'auth/unauthorized-domain': 'This website isn\u2019t on the authorized domains list. Add it in Firebase console > Authentication > Settings > Authorized domains.',
      'auth/invalid-api-key': 'The Firebase API key in firebase-config.js isn\u2019t valid.',
      'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase API key in firebase-config.js isn\u2019t valid.',
      'auth/configuration-not-found': 'Firebase Authentication isn\u2019t set up for this project yet. In the Firebase console, open Authentication and click Get started.',
      'auth/invalid-email': 'That email address doesn\u2019t look right.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/too-many-requests': 'Too many attempts. Try again in a bit.',
      'auth/network-request-failed': 'Network problem. Check your connection.'
    })[code] || 'Could not log you in. Try again.';
  }

  $('pwToggle').addEventListener('click', () => {
    const i = $('loginPassword'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('pwToggle').textContent = show ? 'Hide' : 'Show';
    $('pwToggle').setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    showMsg('');
    const email = $('loginEmail').value.trim(), pw = $('loginPassword').value;
    if (!email || !pw) return showMsg('Enter your email and password.');
    btn.disabled = true;
    try {
      await auth.signInWithEmailAndPassword(email, pw);
      location.href = 'index.html';
    } catch (ex) {
      console.error('Login failed:', ex.code, ex.message);
      showMsg(authMessage(ex.code));
      btn.disabled = false;
    }
  });

  $('forgotBtn').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim();
    if (!email) return showMsg('Type your email above first, then tap Forgot password.');
    try {
      await auth.sendPasswordResetEmail(email);
      showMsg('Password reset email sent. Check your inbox.', false);
    } catch (ex) {
      console.error('Password reset failed:', ex.code, ex.message);
      showMsg(authMessage(ex.code));
    }
  });
})();
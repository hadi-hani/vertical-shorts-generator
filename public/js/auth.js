'use strict';

/* Auth page: tab switching, login/register submit, client-side validation,
 * loading state, redirect on success. */

(function () {
  const MODES = {
    login: { endpoint: '/api/auth/login', title: 'دخول' },
    register: { endpoint: '/api/auth/register', title: 'إنشاء حساب' },
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let mode = 'login';

  const $ = (id) => document.getElementById(id);

  function setMode(next) {
    mode = next;
    $('auth-tabs').querySelectorAll('.seg').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    $('auth-submit').textContent = MODES[mode].title;
    $('auth-error').textContent = '';
    $('auth-emailError').textContent = '';
    $('auth-passError').textContent = '';
    $('auth-email').classList.remove('invalid');
    $('auth-password').classList.remove('invalid');
    $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  }

  function clearError(el, input) {
    el.textContent = '';
    input.classList.remove('invalid');
  }

  function setError(el, input, msg) {
    el.textContent = msg;
    input.classList.add('invalid');
  }

  function validate() {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    let ok = true;
    clearError($('auth-emailError'), $('auth-email'));
    clearError($('auth-passError'), $('auth-password'));

    if (!EMAIL_RE.test(email)) {
      setError($('auth-emailError'), $('auth-email'), 'أدخل بريداً إلكترونياً صالحاً.');
      ok = false;
    }
    if (!password) {
      setError($('auth-passError'), $('auth-password'), 'أدخل كلمة المرور.');
      ok = false;
    } else if (mode === 'register' && password.length < 8) {
      setError($('auth-passError'), $('auth-password'), 'كلمة المرور 8 أحرف على الأقل.');
      ok = false;
    }
    return ok;
  }

  async function submit() {
    const btn = $('auth-submit');
    const error = $('auth-error');
    error.textContent = '';
    if (!validate()) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>' + MODES[mode].title;
    try {
      const res = await fetch(MODES[mode].endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: $('auth-email').value.trim().toLowerCase(),
          password: $('auth-password').value,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.message) || 'حدث خطأ غير متوقع');
      }
      window.location.href = '/';
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
      btn.textContent = MODES[mode].title;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('auth-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (btn) setMode(btn.dataset.mode);
    });
    $('auth-submit').addEventListener('click', submit);
    $('auth-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    $('auth-email').addEventListener('input', () =>
      clearError($('auth-emailError'), $('auth-email'))
    );
    $('auth-password').addEventListener('input', () =>
      clearError($('auth-passError'), $('auth-password'))
    );
  });
})();
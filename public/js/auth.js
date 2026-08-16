'use strict';

/* Auth page: tab switching, login/register submit, redirect on success. */

(function () {
  const MODES = {
    login: { endpoint: '/api/auth/login', title: 'دخول' },
    register: { endpoint: '/api/auth/register', title: 'إنشاء حساب' },
  };

  let mode = 'login';

  const $ = (id) => document.getElementById(id);

  function setMode(next) {
    mode = next;
    $('auth-tabs').querySelectorAll('.seg').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    $('auth-submit').textContent = MODES[mode].title;
    $('auth-error').textContent = '';
  }

  async function submit() {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const btn = $('auth-submit');
    const error = $('auth-error');
    error.textContent = '';

    if (!email || !password) {
      error.textContent = 'أدخل البريد الإلكتروني وكلمة المرور.';
      return;
    }

    btn.disabled = true;
    try {
      const res = await fetch(MODES[mode].endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.message) || 'حدث خطأ غير متوقع');
      }
      window.location.href = '/';
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
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
  });
})();
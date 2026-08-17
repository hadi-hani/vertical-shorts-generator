'use strict';

/* Frontend UI helpers: theme toggle, toasts, global error boundary.
 * Loaded on every page (auth / projects / index). */

window.UI = {
  initTheme() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    const set = (theme) => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('theme', theme);
      toggle.textContent = theme === 'light' ? '☀' : '☾';
      toggle.setAttribute('aria-label', theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح');
    };
    set(localStorage.getItem('theme') || 'dark');
    toggle.addEventListener('click', () =>
      set(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
    );
  },

  toast(message, type = 'info', ms = 4000) {
    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      document.body.appendChild(stack);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    t.textContent = message;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(() => t.remove(), 300);
    }, ms);
  },

  /* Lightweight global "error boundary": surface uncaught errors as toasts
   * instead of dying silently. */
  initErrorBoundary() {
    window.addEventListener('error', (e) => {
      UI.toast('خطأ غير متوقع: ' + (e.message || 'غير معروف'), 'error');
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = (e.reason && (e.reason.message || e.reason)) || 'خطأ غير معروف';
      UI.toast('خطأ غير متوقع: ' + msg, 'error');
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  UI.initTheme();
  UI.initErrorBoundary();
});
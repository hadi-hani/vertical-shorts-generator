'use strict';

/* Project dashboard: list, status, downloads and deletion. */

window.Projects = {
  STATUS_LABELS: {
    queued: 'قيد الانتظار',
    processing: 'جارٍ التوليد',
    completed: 'مكتمل',
    failed: 'فشل',
    interrupted: 'متقطع',
  },

  el(id) {
    return document.getElementById(id);
  },

  snippet(text, max = 70) {
    if (!text) return '';
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  },

  formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('ar', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return iso || '';
    }
  },

  renderProject(p) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = p.id;

    const head = document.createElement('div');
    head.className = 'card-head';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = this.snippet(p.idea) || this.snippet(p.script) || 'مشروع بدون نص';

    const badge = document.createElement('span');
    badge.className = 'badge ' + (p.status || 'queued');
    badge.textContent = this.STATUS_LABELS[p.status] || p.status;
    head.append(title, badge);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = this.formatDate(p.createdAt);
    card.appendChild(meta);

    if (p.status === 'failed' && p.error) {
      const err = document.createElement('div');
      err.className = 'error-line';
      err.textContent = (p.errorCode ? '[' + p.errorCode + '] ' : '') + p.error;
      card.appendChild(err);
    }

    if (p.status === 'completed') {
      const dlRow = document.createElement('div');
      dlRow.className = 'dl-row';
      for (const [label, url] of [
        ['فيديو MP4', p.outputUrl],
        ['SRT', p.subtitleSrtUrl],
        ['ASS', p.subtitleAssUrl],
      ]) {
        if (!url) continue;
        const a = document.createElement('a');
        a.className = 'dl';
        a.href = url;
        a.setAttribute('download', '');
        a.textContent = 'تنزيل ' + label;
        dlRow.appendChild(a);
      }
      card.appendChild(dlRow);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = 'حذف';
    del.addEventListener('click', () => this.removeProject(card, p.id, del));
    card.appendChild(del);

    return card;
  },

  async removeProject(card, id, btn) {
    if (!window.confirm('هل تريد حذف هذا المشروع نهائياً؟')) return;
    btn.disabled = true;
    try {
      await App.fetchJson('/api/jobs/' + id, { method: 'DELETE' });
      card.remove();
      if (this.el('projects').children.length === 0) this.showEmpty();
    } catch (err) {
      alert(err.message || 'تعذّر حذف المشروع');
      btn.disabled = false;
    }
  },

  showEmpty() {
    const box = this.el('projects');
    box.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML =
      'لا توجد مشاريع بعد.<br>أنشئ أول مقطع لك من ' +
      '<a href="/">الأداة</a> وستظهر نواتجك هنا.';
    box.appendChild(empty);
  },

  async load() {
    const box = this.el('projects');
    try {
      const data = await App.fetchJson('/api/jobs');
      const jobs = data.jobs || [];
      if (jobs.length === 0) {
        this.showEmpty();
        return;
      }
      box.replaceChildren(...jobs.map((p) => this.renderProject(p)));
      const busy = jobs.some((p) => p.status === 'queued' || p.status === 'processing');
      clearTimeout(this._timer);
      if (busy) this._timer = setTimeout(() => this.load(), 5000);
    } catch (err) {
      const e = document.createElement('div');
      e.className = 'error';
      e.textContent = 'تعذّر تحميل المشاريع: ' + (err.message || '');
      box.replaceChildren(e);
    }
  },

  async init() {
    try {
      const d = await App.fetchJson('/api/auth/me');
      App.renderAuthBar(d.user);
    } catch (_) {
      window.location.href = '/auth.html';
      return;
    }
    await this.load();
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Projects.init();
});
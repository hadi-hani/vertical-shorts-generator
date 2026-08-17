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

  renderQuota(u) {
    const card = this.el('quotaCard');
    if (!card) return;
    card.classList.remove('hidden');
    card.replaceChildren();
    const pct = u.limit ? Math.min(100, Math.round((u.consumed / u.limit) * 100)) : 0;
    const resets = new Date(u.resetsAt).toLocaleDateString('ar', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const isPremium = u.plan === 'premium';

    const info = document.createElement('div');
    info.className = 'q-info';
    const consumed = document.createElement('div');
    if (isPremium) {
      consumed.innerHTML =
        'الخطة المدفوعة: <b>' + u.consumed + ' / ' + u.limit + '</b> فيديو شهرياً · المتبقي <b>' + u.remaining + '</b>';
    } else {
      consumed.innerHTML =
        'الخطة المجانية: <b>' + u.consumed + ' / ' + u.limit + '</b> فيديو شهرياً · المتبقي <b>' + u.remaining + '</b>';
    }
    const resetsEl = document.createElement('div');
    resetsEl.className = 'q-resets';
    resetsEl.textContent = 'يتجدد رصيدك في: ' + resets;
    info.append(consumed, resetsEl);

    const barWrap = document.createElement('div');
    barWrap.className = 'q-bar';
    const bar = document.createElement('div');
    bar.className = 'bar' + (u.remaining === 0 ? ' danger' : pct >= 80 ? ' warn' : '');
    const fill = document.createElement('div');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    barWrap.appendChild(bar);

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    if (isPremium) {
      btn.textContent = 'إلغاء الاشتراك';
      btn.className = 'cancel';
      btn.addEventListener('click', () => this.cancelSubscription(btn));
    } else {
      btn.textContent = 'ترقية إلى المدفوعة';
      btn.className = 'upgrade';
      btn.addEventListener('click', () => this.upgrade(btn));
    }
    actions.appendChild(btn);

    card.append(info, barWrap, actions);
  },

  async upgrade(btn) {
    btn.disabled = true;
    btn.textContent = 'جاري تجهيز الدفع…';
    try {
      const res = await App.fetchJson('/api/billing/checkout', { method: 'POST' });
      if (res.approvalUrl) {
        window.location.href = res.approvalUrl;
        return;
      }
      throw new Error('لم يصل رابط الدفع');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'ترقية إلى المدفوعة';
      alert(err.message || 'تعذّر بدء الدفع');
    }
  },

  async cancelSubscription(btn) {
    if (!window.confirm('هل تريد إلغاء اشتراكك المدفوع والعودة للخطة المجانية؟')) return;
    btn.disabled = true;
    try {
      await App.fetchJson('/api/billing/cancel', { method: 'POST' });
      await this.load();
    } catch (err) {
      btn.disabled = false;
      alert(err.message || 'تعذّر إلغاء الاشتراك');
    }
  },

  async load() {
    const box = this.el('projects');
    try {
      const [data, usage] = await Promise.all([
        App.fetchJson('/api/jobs'),
        App.fetchJson('/api/usage').catch(() => null),
      ]);
      if (usage && usage.usage) this.renderQuota(usage.usage);
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
'use strict';

/* Shared app helpers: element refs, fetch, job polling, tab wiring. */

window.App = {
  tools: {},

  $: (id) => document.getElementById(id),

  show(el, visible = true) {
    el.classList.toggle('hidden', !visible);
  },

  async fetchJson(url, opts = {}) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error)) || `HTTP ${res.status}`
      );
      err.code = (data && data.error) || 'http_error';
      throw err;
    }
    return data;
  },

  registerTool(name, tool) {
    if (tool) this.tools[name] = tool;
  },

  mountTools() {
    for (const [name, tool] of Object.entries(this.tools)) {
      const panel = this.$('tool-' + name);
      if (panel && typeof tool.mount === 'function') tool.mount(panel);
    }
  },

  /**
   * Poll a job until a terminal state, calling back on each tick.
   *   onStatus(job)  — every poll tick
   *   onDone(job)    — status completed
   *   onError(job)   — status failed (or null when the server became
   *                    unreachable for too long)
   *   onTimeout()    — polling budget exhausted
   */
  pollJob(id, { onStatus, onDone, onError, onTimeout } = {}) {
    let ticks = 0;
    const tick = async () => {
      ticks++;
      try {
        const data = await this.fetchJson('/api/jobs/' + id);
        const job = data.job;
        if (onStatus) onStatus(job);
        if (job.status === 'completed') {
          if (onDone) onDone(job);
          return;
        }
        if (job.status === 'failed') {
          if (onError) onError(job);
          return;
        }
      } catch (e) {
        if (ticks > 40) {
          if (onError) onError(null);
          return;
        }
      }
      if (ticks >= 600) {
        if (onTimeout) onTimeout();
        return;
      }
      setTimeout(tick, 1500);
    };
    tick();
  },

  renderAuthBar(user) {
    const bar = this.$('authBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    const email = document.createElement('span');
    email.className = 'email';
    email.textContent = user.email;
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.textContent = 'خروج';
    logout.addEventListener('click', async () => {
      try {
        await this.fetchJson('/api/auth/logout', { method: 'POST' });
      } catch (_) {}
      window.location.href = '/auth.html';
    });
    const link = document.createElement('a');
    link.href = '/projects.html';
    link.textContent = 'مشاريعي';
    bar.replaceChildren(email, link, logout);
  },

  init() {
    this.mountTools();
    this.fetchJson('/api/auth/me')
      .then((d) => {
        this.renderAuthBar(d.user);
        this.fetchJson('/api/health')
          .then((h) => {
            const el = this.$('jobCount');
            if (el) {
              el.textContent = h.ok
                ? 'Server healthy · ' +
                  h.jobCount +
                  ' jobs · Gemini ' +
                  (h.geminiConfigured ? 'configured' : 'NOT configured')
                : '';
            }
          })
          .catch(() => {});
      })
      .catch(() => {
        window.location.href = '/auth.html';
      });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.SubtitlesTool) App.registerTool('subtitles', window.SubtitlesTool);
  App.init();
});

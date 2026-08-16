'use strict';

/* Subtitles & Captions Generator tool (active). */

window.SubtitlesTool = (function () {
  const DEFAULTS = {
    idea: '',
    script: '',
    language: 'ar',
    captionStyle: 'word',
    timingMode: 'auto',
    wordsPerSegment: 4,
  };
  const STORE_KEY = 'shortgen.subtitles.state';

  const STYLE_INFO = {
    word: 'Each word appears alone with a quick pop, timed to the voice-over. Timing is automatic.',
    progressive: 'Words accumulate line by line until the sentence is complete, then roll over.',
  };
  const TIMING_INFO = {
    auto: 'Automatic word-level timestamps from the TTS engine.',
    words: 'Fixed number of words per caption (falls back to even timing if word timestamps are missing).',
  };
  const STYLE_LABEL = {
    word: 'Word by Word',
    progressive: 'Progressive',
  };

  let state = loadState();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      const merged = Object.assign({}, DEFAULTS, saved);
      merged.language = 'ar';
      return merged;
    } catch (_) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function mount(container) {
    container.innerHTML = buildHtml();
    wire(container);
    restore(container);
  }

  function buildHtml() {
    return [
      '<div class="card">',
      '  <label for="sub-idea">One-line idea</label>',
      '  <input id="sub-idea" type="text" placeholder="e.g. How to boil an egg in 30 seconds" />',
      '  <label>Script <span class="hint">(optional — auto-generated from idea via Gemini)</span></label>',
      '  <div class="script-row">',
      '    <textarea id="sub-script" placeholder="Paste a full script, or let Gemini write one…"></textarea>',
      '    <button class="secondary" id="sub-genScript" type="button">Generate script</button>',
      '  </div>',
      '  <label>Caption style</label>',
      '  <div class="segmented" id="sub-style">',
      '    <button class="seg" data-style="word" type="button">Word by Word</button>',
      '    <button class="seg" data-style="progressive" type="button">Progressive</button>',
      '  </div>',
      '  <p class="hint" id="sub-styleInfo"></p>',
      '  <div id="sub-timingBlock">',
      '    <label>Timing</label>',
      '    <div class="segmented" id="sub-timing">',
      '      <button class="seg" data-timing="auto" type="button">Word-level timings</button>',
      '      <button class="seg" data-timing="words" type="button">Fixed words per line</button>',
      '    </div>',
      '    <p class="hint" id="sub-timingInfo"></p>',
      '    <div id="sub-wpsRow" class="hidden">',
      '      <label for="sub-wps">Words per caption</label>',
      '      <input id="sub-wps" type="number" min="2" max="10" step="1" value="4" />',
      '      <p class="hint">2–10 words per caption line (default 4).</p>',
      '    </div>',
      '  </div>',
      '  <div class="btns">',
      '    <button class="primary" id="sub-generate" type="button">Generate video</button>',
      '  </div>',
      '  <p class="hint">Arabic voice-over + animated subtitles render into a 1080x1920 MP4 with downloadable .srt and .ass files. Scripts must stay under 60 seconds of speech.</p>',
      '</div>',
      '<div class="card status hidden" id="sub-status">',
      '  <div class="stage" id="sub-statusStage">Queued</div>',
      '  <div class="progress"><div id="sub-progress"></div></div>',
      '  <div id="sub-statusText"></div>',
      '  <div class="error" id="sub-error"></div>',
      '</div>',
      '<div class="card result hidden" id="sub-result">',
      '  <video id="sub-video" controls playsinline></video>',
      '  <div class="dl-row">',
      '    <a class="dl" id="sub-dl-mp4" href="#" download>Download MP4</a>',
      '    <a class="dl" id="sub-dl-srt" href="#" download>Download .srt</a>',
      '    <a class="dl" id="sub-dl-ass" href="#" download>Download .ass</a>',
      '  </div>',
      '  <p class="hint meta" id="sub-meta"></p>',
      '</div>',
    ].join('\n');
  }

  function wire(container) {
    const $ = App.$;
    container.querySelector('#sub-idea').addEventListener('input', (e) => {
      state.idea = e.target.value;
      saveState();
    });
    container.querySelector('#sub-script').addEventListener('input', (e) => {
      state.script = e.target.value;
      saveState();
    });

    container.querySelector('#sub-style').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      state.captionStyle = btn.dataset.style;
      saveState();
      refreshSegmented(container, '#sub-style', '.seg', btn.dataset.style);
      updateTimingVisibility(container);
      updateInfo(container);
    });

    container.querySelector('#sub-timing').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      state.timingMode = btn.dataset.timing;
      saveState();
      refreshSegmented(container, '#sub-timing', '.seg', btn.dataset.timing);
      updateTimingVisibility(container);
      updateInfo(container);
    });

    container.querySelector('#sub-wps').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) {
        state.wordsPerSegment = Math.max(2, Math.min(10, v));
      }
      saveState();
    });

    container.querySelector('#sub-genScript').addEventListener('click', async () => {
      const idea = state.idea.trim();
      if (!idea) {
        setError(container, 'Type a one-line idea first.');
        return;
      }
      const btn = container.querySelector('#sub-genScript');
      btn.disabled = true;
      setStatus(container, 'Generating script…', 0.3, 'Asking Gemini…');
      try {
        const data = await App.fetchJson('/api/generate-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idea, language: state.language }),
        });
        state.script = data.script;
        saveState();
        container.querySelector('#sub-script').value = state.script;
        setStatus(container, 'Script ready', 1, 'Review the script, then click "Generate video".');
      } catch (err) {
        setError(container, err.message);
      } finally {
        btn.disabled = false;
      }
    });

    container.querySelector('#sub-generate').addEventListener('click', async () => {
      const idea = state.idea.trim();
      const script = state.script.trim();
      if (!idea && !script) {
        setError(container, 'Provide an idea and/or a script.');
        return;
      }
      const result = $('sub-result');
      App.show(result, false);
      setStatus(container, 'Queued', 0.05, 'Submitting job…');
      try {
        const data = await App.fetchJson('/api/generate/subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idea: idea || undefined,
            script: script || undefined,
            language: state.language,
            captionStyle: state.captionStyle,
            timingMode: state.timingMode,
            wordsPerSegment: state.wordsPerSegment,
          }),
        });
        const id = data.job.id;
        setStatus(container, 'Queued', 0.1, 'Job ' + id + ' submitted.');
        App.pollJob(id, {
          onStatus: (job) => {
            if (job.status === 'processing') {
              setStatus(container, 'Rendering…', 0.6, 'Running TTS and building captions…');
            }
          },
          onDone: (job) => renderResult(container, job),
          onError: (job) => {
            setStatus(container, 'Failed', 1, '');
            const msg = job
              ? (job.errorCode ? '[' + job.errorCode + '] ' : '') + (job.error || 'Render failed')
              : 'Could not reach the server.';
            setError(container, msg);
          },
          onTimeout: () => setError(container, 'Timed out waiting for the job.'),
        });
      } catch (err) {
        setError(container, err.message);
      }
    });
  }

  function restore(container) {
    const $ = App.$;
    container.querySelector('#sub-idea').value = state.idea;
    container.querySelector('#sub-script').value = state.script;
    container.querySelector('#sub-wps').value = state.wordsPerSegment;
    refreshSegmented(container, '#sub-style', '.seg', state.captionStyle);
    refreshSegmented(container, '#sub-timing', '.seg', state.timingMode);
    updateTimingVisibility(container);
    updateInfo(container);
  }

  function updateTimingVisibility(container) {
    const $ = App.$;
    const isWord = state.captionStyle === 'word';
    if (isWord) state.timingMode = 'auto';
    refreshSegmented(container, '#sub-timing', '.seg', state.timingMode);
    // Word by Word always shows one word per caption, so the timing options
    // (word-level timestamps / fixed words per line) only apply to the other
    // two styles.
    App.show($('sub-timingBlock'), !isWord);
    App.show($('sub-wpsRow'), !isWord && state.timingMode === 'words');
  }

  function refreshSegmented(container, groupId, sel, value) {
    container.querySelector(groupId).querySelectorAll(sel).forEach((b) => {
      b.classList.toggle('active', b.dataset.style === value || b.dataset.timing === value);
    });
  }

  function updateInfo(container) {
    container.querySelector('#sub-styleInfo').textContent =
      STYLE_INFO[state.captionStyle] || '';
    container.querySelector('#sub-timingInfo').textContent =
      TIMING_INFO[state.timingMode] || '';
  }

  function setStatus(container, stage, progress, text) {
    const $ = App.$;
    const card = $('sub-status');
    App.show(card, true);
    $('sub-statusStage').textContent = stage;
    $('sub-progress').style.width = Math.round(progress * 100) + '%';
    $('sub-statusText').textContent = text || '';
    $('sub-error').textContent = '';
  }

  function setError(container, msg) {
    App.$('sub-error').textContent = msg;
  }

  function renderResult(container, job) {
    const $ = App.$;
    setStatus(container, 'Done', 1, 'Your video is ready.');
    const m = job.meta || {};
    $('sub-video').src = job.outputUrl;
    $('sub-dl-mp4').href = job.outputUrl;
    $('sub-dl-srt').href = job.subtitleSrtUrl || '';
    $('sub-dl-ass').href = job.subtitleAssUrl || '';
    App.show($('sub-dl-srt'), Boolean(job.subtitleSrtUrl));
    App.show($('sub-dl-ass'), Boolean(job.subtitleAssUrl));
    const bits = [
      'Style: ' + (STYLE_LABEL[m.captionStyle] || m.captionStyle || 'Word by Word'),
    ];
    if (m.captionStyle !== 'word') {
      bits.push('Timing: ' + (m.timingMode === 'words' ? m.wordsPerSegment + ' words per line' : 'Word-level'));
    }
    if (m.wordCount != null) bits.push(m.wordCount + ' words');
    if (m.audioDuration != null) bits.push(m.audioDuration + 's audio');
    $('sub-meta').textContent = bits.join(' · ');
    App.show($('sub-result'), true);
  }

  return { name: 'subtitles', mount };
})();

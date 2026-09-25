'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);
  const state = { token: sessionStorage.getItem('ps_token'), user: null };

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = res.status === 204 ? {} : await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function show(loggedIn) {
    $('#auth').classList.toggle('hidden', loggedIn);
    $('#dash').classList.toggle('hidden', !loggedIn);
    $('#who').innerHTML = loggedIn ? `${esc(state.user.email)} <button id="logout" class="link">Log out</button>` : '';
    if (loggedIn) {
      $('#logout').onclick = () => { sessionStorage.removeItem('ps_token'); location.reload(); };
      loadSprints();
    }
  }

  async function loadSprints() {
    const { sprints } = await api('/api/sprints');
    $('#sprintList').innerHTML = sprints.length
      ? sprints.map((s) => `<li><a href="#" data-id="${s.id}">${esc(s.title)}</a> <span class="pill">${s.status}</span></li>`).join('')
      : '<li class="muted">No sprints yet.</li>';
    $('#sprintList').querySelectorAll('a').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openSprint(a.dataset.id); }; });
  }

  function renderQuestions(sprint) {
    const byId = new Map(sprint.bias.results.map((r) => [r.id, r]));
    return sprint.questions.map((q) => {
      const r = byId.get(q.id) || { ok: true, flags: [] };
      const flag = r.ok ? '<span class="ok">✓ unbiased</span>' : `<span class="warn">⚠ ${r.flags.map((f) => f.type).join(', ')}</span>`;
      return `<li>${esc(q.text)} ${flag}</li>`;
    }).join('');
  }

  async function openSprint(id) {
    const { sprint } = await api(`/api/sprints/${id}`);
    const invite = `${location.origin}/i/${sprint.inviteToken}`;
    $('#detail').classList.remove('hidden');
    $('#detail').innerHTML = `
      <h2>${esc(sprint.title)} <span class="pill">${sprint.status}</span></h2>
      <h3>Riskiest assumptions</h3>
      <ol class="small">${sprint.assumptions.map((a) => `<li><b>Risk ${a.risk}/5</b> · ${esc(a.statement)}</li>`).join('')}</ol>
      <h3>Interview script <span class="muted">(bias score ${sprint.bias.score}/100)</span></h3>
      <ol class="small">${renderQuestions(sprint)}</ol>
      <div class="row">
        ${sprint.status === 'draft' ? '<button id="launch">Launch interviews</button>' : `<input readonly value="${invite}"> <a href="${invite}" target="_blank">Open</a>`}
        <button id="insights" class="secondary">Insights</button>
      </div>
      <div id="insightOut" class="small"></div>`;
    const launch = $('#launch');
    if (launch) launch.onclick = async () => { await api(`/api/sprints/${id}/launch`, { method: 'POST' }); openSprint(id); loadSprints(); };
    $('#insights').onclick = async () => {
      const { insights } = await api(`/api/sprints/${id}/insights`);
      $('#insightOut').innerHTML = `<p><b>Evidence score ${insights.evidenceScore}/100</b> · ${insights.interviews.completed} completed interviews ·
        Recommendation: <b>${insights.decision}</b> (${esc(insights.reason)})</p>
        <p class="muted">${esc(insights.note)}</p>
        <ul>${insights.assumptions.map((a) => `<li>${esc(a.statement)}: <b>${a.evidence.level}</b> ${a.evidence.quotes.map((q) => `<q>${esc(q.text)}</q>`).join(' ')}</li>`).join('')}</ul>`;
    };
  }

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = e.submitter ? e.submitter.dataset.mode : 'login';
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body });
      state.token = data.token;
      state.user = data.user;
      sessionStorage.setItem('ps_token', data.token);
      show(true);
    } catch (err) {
      $('#authMsg').textContent = err.message;
    }
  });

  $('#sprintForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { sprint } = await api('/api/sprints', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      await loadSprints();
      openSprint(sprint.id);
    } catch (err) {
      alert(err.message);
    }
  });

  $('#biasForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/tools/bias-check', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    $('#biasOut').innerHTML = r.ok
      ? '<span class="ok">✓ No bias detected. Good question.</span>'
      : `<span class="warn">⚠ ${r.flags.map((f) => esc(f.message)).join(' ')}</span><br>Try: <i>${esc(r.suggestion)}</i>`;
  });

  fetch('/version').then((r) => r.json()).then((v) => { $('#build').textContent = `v${v.version} · ${v.environment} · ${v.gitSha}`; });

  if (state.token) {
    api('/api/auth/me').then(({ user }) => { state.user = user; show(true); }).catch(() => sessionStorage.removeItem('ps_token'));
  }
})();

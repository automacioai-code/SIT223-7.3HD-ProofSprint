'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);
  const state = { token: sessionStorage.getItem('ps_token'), user: null };

  /**
   * Builds DOM nodes with textContent only (never innerHTML), so user-supplied text can never
   * be interpreted as HTML. This fixes the DOM-XSS finding reported by SonarCloud (rule S5696).
   */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) {
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  const render = (target, ...nodes) => $(target).replaceChildren(...nodes);

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = res.status === 204 ? {} : await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function show(loggedIn) {
    $('#auth').classList.toggle('hidden', loggedIn);
    $('#dash').classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return render('#who');
    const logout = () => {
      sessionStorage.removeItem('ps_token');
      location.reload();
    };
    render('#who', state.user.email, ' ', h('button', { class: 'link', onclick: logout }, 'Log out'));
    return loadSprints();
  }

  async function loadSprints() {
    const { sprints } = await api('/api/sprints');
    const items = sprints.map((s) =>
      h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSprint(s.id); } }, s.title), ' ', h('span', { class: 'pill' }, s.status)),
    );
    render('#sprintList', ...(items.length ? items : [h('li', { class: 'muted' }, 'No sprints yet.')]));
  }

  function questionItems(sprint) {
    const byId = new Map(sprint.bias.results.map((r) => [r.id, r]));
    return sprint.questions.map((q) => {
      const result = byId.get(q.id) || { ok: true, flags: [] };
      const flag = result.ok
        ? h('span', { class: 'ok' }, ' ✓ unbiased')
        : h('span', { class: 'warn' }, ` ⚠ ${result.flags.map((f) => f.type).join(', ')}`);
      return h('li', {}, q.text, flag);
    });
  }

  function insightNodes(insights) {
    return [
      h('p', {}, h('b', {}, `Evidence score ${insights.evidenceScore}/100`), ` · ${insights.interviews.completed} completed interviews · Recommendation: `, h('b', {}, insights.decision), ` (${insights.reason})`),
      h('p', { class: 'muted' }, insights.note),
      h('ul', {}, insights.assumptions.map((a) => h('li', {}, `${a.statement}: `, h('b', {}, a.evidence.level), a.evidence.quotes.map((q) => h('q', {}, q.text))))),
    ];
  }

  async function openSprint(id) {
    const { sprint } = await api(`/api/sprints/${id}`);
    const invite = `${location.origin}/i/${sprint.inviteToken}`;
    const launch = async () => {
      await api(`/api/sprints/${id}/launch`, { method: 'POST' });
      await loadSprints();
      openSprint(id);
    };
    const showInsights = async () => render('#insightOut', ...insightNodes((await api(`/api/sprints/${id}/insights`)).insights));
    const share =
      sprint.status === 'draft'
        ? h('button', { onclick: launch }, 'Launch interviews')
        : [h('input', { readonly: 'readonly', value: invite, 'aria-label': 'Interview link' }), h('a', { href: invite, target: '_blank', rel: 'noopener' }, 'Open')];
    $('#detail').classList.remove('hidden');
    render(
      '#detail',
      h('h2', {}, sprint.title, ' ', h('span', { class: 'pill' }, sprint.status)),
      h('h3', {}, 'Riskiest assumptions'),
      h('ol', { class: 'small' }, sprint.assumptions.map((a) => h('li', {}, h('b', {}, `Risk ${a.risk}/5`), ` · ${a.statement}`))),
      h('h3', {}, 'Interview script ', h('span', { class: 'muted' }, `(bias score ${sprint.bias.score}/100)`)),
      h('ol', { class: 'small' }, questionItems(sprint)),
      h('div', { class: 'row' }, share, h('button', { class: 'secondary', onclick: showInsights }, 'Insights')),
      h('div', { id: 'insightOut', class: 'small' }),
    );
  }

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = e.submitter ? e.submitter.dataset.mode : 'login';
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      state.token = data.token;
      state.user = data.user;
      sessionStorage.setItem('ps_token', data.token);
      await show(true);
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
      $('#sprintMsg').textContent = err.message;
    }
  });

  $('#biasForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/tools/bias-check', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    if (r.ok) return render('#biasOut', h('span', { class: 'ok' }, '✓ No bias detected. Good question.'));
    return render('#biasOut', h('span', { class: 'warn' }, `⚠ ${r.flags.map((f) => f.message).join(' ')}`), h('br'), 'Try: ', h('i', {}, r.suggestion));
  });

  fetch('/version')
    .then((r) => r.json())
    .then((v) => {
      $('#build').textContent = `v${v.version} · ${v.environment} · ${v.gitSha}`;
    });

  if (state.token) {
    api('/api/auth/me')
      .then(({ user }) => {
        state.user = user;
        return show(true);
      })
      .catch(() => sessionStorage.removeItem('ps_token'));
  }
})();

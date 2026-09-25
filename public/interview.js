'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);
  const token = location.pathname.split('/').pop();
  let interviewId = null;

  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  function say(who, text) {
    const div = document.createElement('div');
    div.className = `bubble ${who}`;
    div.textContent = text;
    $('#log').appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  fetch(`/api/interviews/${token}`)
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      $('#title').textContent = ok ? d.title : 'Interview link not found';
      $('#consent').textContent = ok ? d.consent : '';
      if (!ok || !d.open) $('#startForm').classList.add('hidden');
      if (ok && !d.open) $('#msg').textContent = 'This interview is not open yet.';
    });

  $('#startForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const data = await post(`/api/interviews/${token}/start`, { alias: form.get('alias'), consent: form.get('consent') === 'on' });
      interviewId = data.interviewId;
      $('#intro').classList.add('hidden');
      $('#chat').classList.remove('hidden');
      say('bot', data.question.text);
    } catch (err) {
      $('#msg').textContent = err.message;
    }
  });

  $('#answerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value;
    input.value = '';
    say('me', text);
    const data = await post(`/api/interviews/${token}/${interviewId}/answer`, { text });
    if (data.done) {
      say('bot', 'Thank you! That is everything. Your answers will help a student founder build something people need.');
      e.target.classList.add('hidden');
    } else {
      say('bot', data.question.text);
    }
  });
})();

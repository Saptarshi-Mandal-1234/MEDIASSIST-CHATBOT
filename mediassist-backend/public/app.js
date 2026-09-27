'use strict';
const $ = id => document.getElementById(id);
const MODE_CONFIG = {
  symptoms: { name: 'Symptom Advisor', sub: 'Educational symptom information' },
  medications: { name: 'Medication Manager', sub: 'Questions about your medications and appointments' },
  mental: { name: 'Mental Health Companion', sub: 'Support, grounding and mood check-ins' },
  reports: { name: 'Report Analyzer', sub: 'Upload a PDF, image or text report (up to 5 MB)' }
};
let currentMode = 'symptoms', ready = false, sending = false, reading = false;
let token = '', attachment = null, fileVersion = 0;
let conversations = { symptoms: [], medications: [], mental: [], reports: [] };
const sessionStart = Date.now();
let notifTimer;
function showNotif(message, type = '') {
  $('notif').textContent = message; $('notif').className = 'notification show ' + type;
  clearTimeout(notifTimer); notifTimer = setTimeout(() => $('notif').classList.remove('show'), 6000);
}
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-mediassist-token': token }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(70000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function safeFormat(text) {
  const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const markup = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^#{1,3} (.+)$/gm, '<h3>$1</h3>').replace(/^[-•] (.+)$/gm, '• $1').replace(/\n/g, '<br>');
  return DOMPurify.sanitize(markup, { ALLOWED_TAGS: ['strong','h3','br'], ALLOWED_ATTR: [] });
}
function appendMessage(role, text) {
  const msg = document.createElement('div'); msg.className = 'message ' + (role === 'user' ? 'user' : 'ai');
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar'; avatar.textContent = role === 'user' ? '👤' : '⚕';
  const body = document.createElement('div'); body.className = 'msg-body';
  const meta = document.createElement('div'); meta.className = 'msg-meta'; meta.textContent = role === 'user' ? 'You' : 'MediAssist · ' + MODE_CONFIG[currentMode].name;
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  if (role === 'user') { bubble.textContent = text; bubble.style.whiteSpace = 'pre-wrap'; } else bubble.innerHTML = safeFormat(text);
  body.append(meta, bubble); msg.append(avatar, body); $('chatArea').append(msg); $('chatArea').scrollTop = $('chatArea').scrollHeight;
  return msg;
}
function renderConversation() {
  $('chatArea').replaceChildren();
  const rows = conversations[currentMode];
  if (!rows.length) {
    const intro = document.createElement('div'); intro.className = 'welcome';
    const h = document.createElement('h2'); h.textContent = MODE_CONFIG[currentMode].name;
    const p = document.createElement('p'); p.textContent = 'Ask a question below. Save health records using the tracker buttons. AI messages and attached reports are sent to Google Gemini.';
    intro.append(h, p); $('chatArea').append(intro);
  } else rows.forEach(m => appendMessage(m.role, m.content));
  $('consult-count').textContent = Object.values(conversations).flat().filter(m => m.role === 'user').length;
}
function setMode(mode) {
  if (sending || reading || !MODE_CONFIG[mode]) return;
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.id === 'mode-' + mode));
  $('current-mode-name').textContent = MODE_CONFIG[mode].name;
  $('current-mode-sub').textContent = MODE_CONFIG[mode].sub;
  $('uploadZone').classList.toggle('visible', mode === 'reports');
  if (mode !== 'reports') clearReport();
  renderConversation();
}
function clearReport() { attachment = null; fileVersion++; $('fileInput').value = ''; $('reportPreview').style.display = 'none'; }
async function handleFile(input) {
  if (sending) return;
  const file = input.files[0]; if (!file) return;
  clearReport();
  const ext = file.name.split('.').pop().toLowerCase();
  const mimeType = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' })[ext];
  if (!mimeType || file.size === 0 || file.size > 5 * 1024 * 1024 || (ext === 'txt' && file.size > 100000)) return showNotif('Choose a PDF, PNG or JPG up to 5 MB, or TXT up to 100 KB.');
  setMode('reports'); const version = fileVersion; reading = true; $('sendBtn').disabled = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file); });
    if (version !== fileVersion) return;
    attachment = { name: file.name, mimeType, data: dataUrl.split(',')[1] };
    $('reportFileName').textContent = file.name; $('reportPreview').style.display = 'flex';
    showNotif('Report attached. It will be sent to Gemini when you press Send.');
  } catch (err) { showNotif(err.message); } finally { reading = false; $('sendBtn').disabled = !ready || sending; }
}
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
function insertHint(text) { $('msgInput').value = text; $('msgInput').focus(); }
function sendQuick(text) { if (!sending) { $('msgInput').value = text; sendMessage(); } }
async function sendMessage() {
  if (!ready || sending || reading) return;
  const message = $('msgInput').value.trim();
  if (!message && !attachment) return;
  if (message.length > 20000) return showNotif('Please keep messages under 20,000 characters.');
  sending = true; $('sendBtn').disabled = true; $('msgInput').disabled = true;
  const mode = currentMode;
  const display = (message || 'Please explain this report.') + (attachment ? '\n[Attached report: ' + attachment.name + ']' : '');
  renderConversation(); appendMessage('user', display); const pending = appendMessage('assistant', 'Thinking…');
  try {
    const data = await api('/chat', 'POST', { mode, message, attachment });
    conversations[mode].push({ role: 'user', content: display }, { role: 'assistant', content: data.reply });
    $('msgInput').value = ''; autoResize($('msgInput')); clearReport(); renderConversation();
  } catch (err) { pending.remove(); showNotif(err.message); appendMessage('assistant', 'Message was not saved. ' + err.message); }
  finally { sending = false; $('sendBtn').disabled = false; $('msgInput').disabled = false; }
}
function element(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function action(label, handler) { const b = element('button', label); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; try { await handler(); } catch (err) { showNotif(err.message); } finally { b.disabled = false; } }); return b; }
function dateLabel(value) { if (!value) return ''; const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'); return Number.isNaN(d.valueOf()) ? value : d.toLocaleString(); }
async function loadTrackers() {
  const [moods, meds, appts, vitals, logs] = await Promise.all(['/mood','/medications','/appointments','/vitals','/health-log'].map(p => api(p)));
  const last = moods.at(-1);
  $('moodScore').textContent = last ? last.score + '/10' : '—'; $('mood-display').textContent = last ? last.score + '/10' : '—';
  $('moodLabelText').textContent = last?.label || (last ? 'Logged' : 'Not tracked yet');
  $('moodDate').textContent = last ? dateLabel(last.created_at) : '';
  [...$('moodHistoryBars').children].forEach((bar, i) => { bar.style.height = moods[i] ? moods[i].score * 10 + '%' : '4%'; bar.title = moods[i] ? moods[i].score + '/10 · ' + dateLabel(moods[i].created_at) : ''; });
  $('medList').replaceChildren();
  if (!meds.length) $('medList').append(element('p', 'No medications added yet.'));
  meds.forEach(m => {
    const item = element('div', null, 'med-item'); const info = element('div', null, 'med-info');
    info.append(element('div', m.name, 'med-name'), element('div', [m.dosage,m.frequency,m.time_of_day].filter(Boolean).join(' · '), 'med-time'));
    const actions = element('div', null, 'record-actions');
    actions.append(action(m.status === 'done' ? 'Taken ✓ · reset' : 'Mark taken', async () => { await api('/medications/' + m.id, 'PATCH', { status: m.status === 'done' ? 'due' : 'done' }); await loadTrackers(); }), action('Remove', async () => { if (confirm('Remove ' + m.name + '?')) { await api('/medications/' + m.id, 'DELETE'); await loadTrackers(); } }));
    item.append(info, actions); $('medList').append(item);
  });
  $('apptList').replaceChildren();
  if (!appts.length) $('apptList').append(element('p', 'No appointments scheduled.'));
  appts.forEach(a => { const item = element('div', null, 'appt-item'); item.append(element('div', a.title, 'appt-title'), element('div', [a.doctor,dateLabel(a.appointment_time),a.notes].filter(Boolean).join(' · '), 'appt-time'), action('Remove', async () => { if (confirm('Remove this appointment?')) { await api('/appointments/' + a.id, 'DELETE'); await loadTrackers(); } })); $('apptList').append(item); });
  for (const [field, id] of Object.entries({ blood_pressure:'bpVal', heart_rate:'hrVal', blood_sugar:'bsVal', temperature:'tempVal' })) { $(id).textContent = vitals[field] ?? '—'; $(id).title = vitals[field + '_at'] ? 'Recorded ' + dateLabel(vitals[field + '_at']) : ''; }
  $('healthLog').replaceChildren();
  if (!logs.length) $('healthLog').textContent = 'No entries yet.';
  logs.slice(0,20).forEach(l => $('healthLog').append(element('div', dateLabel(l.created_at) + ' · ' + l.entry)));
}
function openForm(title, fields, endpoint) {
  if (!ready) return showNotif('Wait for the app to connect.');
  const dialog = document.createElement('dialog'); const form = document.createElement('form');
  form.append(element('h2', title));
  fields.forEach(f => { const label = element('label', f.label); const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input'); if (f.type !== 'textarea') input.type = f.type || 'text'; input.name = f.name; input.required = !!f.required; input.maxLength = f.max || 500; if (f.min !== undefined) input.min = f.min; if (f.maxNumber !== undefined) input.max = f.maxNumber; if (f.step) input.step = f.step; label.append(input); form.append(label); });
  const error = element('p', '', 'form-error'); error.setAttribute('role', 'alert'); form.append(error);
  const footer = element('footer'); const cancel = action('Cancel', () => dialog.close()); const save = element('button', 'Save'); save.type = 'submit'; footer.append(cancel, save); form.append(footer);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; error.textContent = '';
    try {
      const body = {};
      fields.forEach(f => { const value = form.elements[f.name].value.trim(); if (value) body[f.name] = f.type === 'number' ? Number(value) : f.type === 'datetime-local' ? new Date(value).toISOString() : value; });
      await api(endpoint, 'POST', body); dialog.close(); showNotif('Saved successfully.', 'success');
      try { await loadTrackers(); } catch { showNotif('Saved, but the display could not refresh. Reload the page.'); }
    } catch (err) { error.textContent = err.message; } finally { save.disabled = false; }
  });
  dialog.addEventListener('close', () => dialog.remove()); dialog.append(form); document.body.append(dialog); dialog.showModal();
}
function addMedicationPrompt() { openForm('Add medication', [{name:'name',label:'Medication name',required:true,max:200},{name:'dosage',label:'Prescribed dosage'},{name:'frequency',label:'Frequency'},{name:'time_of_day',label:'Time of day'}], '/medications'); }
function addAppointmentPrompt() { openForm('Add appointment', [{name:'title',label:'Appointment title',required:true,max:200},{name:'doctor',label:'Doctor'},{name:'appointment_time',label:'Local date and time',type:'datetime-local',required:true},{name:'notes',label:'Notes',type:'textarea',max:2000}], '/appointments'); }
function updateVitalsPrompt() { openForm('Record vitals', [{name:'blood_pressure',label:'Blood pressure (e.g. 120/80)'},{name:'heart_rate',label:'Heart rate (bpm)',type:'number',min:1,maxNumber:350},{name:'blood_sugar',label:'Blood sugar (mg/dL)',type:'number',min:1,maxNumber:2000,step:'any'},{name:'temperature',label:'Temperature (°F)',type:'number',min:50,maxNumber:120,step:'any'}], '/vitals'); }
$('addMood').addEventListener('click', () => openForm('Log mood', [{name:'score',label:'Mood (1 = very low, 10 = excellent)',type:'number',required:true,min:1,maxNumber:10},{name:'label',label:'How are you feeling?'},{name:'note',label:'Notes',type:'textarea',max:2000}], '/mood'));
$('addLog').addEventListener('click', () => openForm('Journal entry', [{name:'entry',label:'Entry',required:true,type:'textarea',max:4000}], '/health-log'));
setInterval(() => $('session-time').textContent = Math.floor((Date.now() - sessionStart) / 60000) + 'm', 30000);
async function initialize() {
  $('sendBtn').disabled = true;
  try {
    const response = await fetch('/api/session'); if (!response.ok) throw new Error('Could not connect'); const session = await response.json(); token = session.token;
    const notices = [];
    if (!session.aiConfigured) notices.push(session.hosted ? 'AI setup needed: set GEMINI_API_KEY in Render Environment and redeploy. Trackers are available.' : 'AI setup needed: add GEMINI_API_KEY to mediassist-backend/.env and restart. Trackers are available.');
    if (session.ephemeralStorage) notices.push('Temporary demo storage: records may disappear when the service sleeps, restarts or redeploys. Do not store important health records here.');
    $('connectionStatus').textContent = notices.join(' ');
    await Promise.all([loadTrackers(), ...Object.keys(conversations).map(async mode => { conversations[mode] = await api('/chat/history?mode=' + mode); })]);
    ready = true; renderConversation(); $('sendBtn').disabled = false;
  } catch (err) { $('connectionStatus').textContent = 'Could not load the app: ' + err.message + '. Start the server and reload this page.'; }
}
initialize();

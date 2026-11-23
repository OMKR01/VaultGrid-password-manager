// ---------- tiny fetch helper ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- view switching ----------
const authView = document.getElementById('authView');
const dashboardView = document.getElementById('dashboardView');
const setupForm = document.getElementById('setupForm');
const loginForm = document.getElementById('loginForm');

async function boot() {
  const status = await api('/api/status');
  if (status.authenticated) {
    showDashboard();
  } else if (status.isSetup) {
    authView.classList.remove('hidden');
    loginForm.classList.remove('hidden');
  } else {
    authView.classList.remove('hidden');
    setupForm.classList.remove('hidden');
  }
}

function showDashboard() {
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  refreshEntries();
}

// ---------- setup ----------
document.getElementById('setupBtn').addEventListener('click', async () => {
  const pw = document.getElementById('setupPw').value;
  const pw2 = document.getElementById('setupPw2').value;
  const errEl = document.getElementById('setupError');
  errEl.textContent = '';
  if (pw.length < 8) return (errEl.textContent = 'Use at least 8 characters.');
  if (pw !== pw2) return (errEl.textContent = 'Passwords do not match.');
  try {
    await api('/api/setup', { method: 'POST', body: { masterPassword: pw } });
    await api('/api/login', { method: 'POST', body: { masterPassword: pw } });
    showDashboard();
  } catch (e) { errEl.textContent = e.message; }
});

// ---------- login ----------
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { masterPassword: pw } });
    showDashboard();
  } catch (e) { errEl.textContent = e.message; }
}

// ---------- logout ----------
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// ---------- entries state ----------
let entries = [];

async function refreshEntries() {
  entries = await api('/api/passwords');
  renderStats();
  renderCategoryFilter();
  renderList();
}

function renderStats() {
  document.getElementById('statTotal').textContent = entries.length;
  const cats = new Set(entries.map(e => e.category || 'Other'));
  document.getElementById('statCategories').textContent = cats.size;
}

function renderCategoryFilter() {
  const sel = document.getElementById('categoryFilter');
  const current = sel.value;
  const cats = ['All categories', ...new Set(entries.map(e => e.category || 'Other'))];
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  if (cats.includes(current)) sel.value = current;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderList() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const cat = document.getElementById('categoryFilter').value;
  const filtered = entries.filter(e => {
    const matchesQ = !q || e.site.toLowerCase().includes(q) || (e.username || '').toLowerCase().includes(q);
    const matchesCat = !cat || cat === 'All categories' || (e.category || 'Other') === cat;
    return matchesQ && matchesCat;
  });

  const list = document.getElementById('entriesList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';
  empty.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach(e => {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `
      <span class="entry-site">${escapeHtml(e.site)}</span>
      <span class="entry-username">${escapeHtml(e.username || '—')}</span>
      <span><span class="entry-category">${escapeHtml(e.category || 'Other')}</span></span>
      <span class="entry-updated">${fmtDate(e.updatedAt)}</span>
      <span class="entry-actions">
        <button class="icon-btn" title="Copy password" data-action="copy" data-id="${e.id}">⧉</button>
        <button class="icon-btn" title="Edit" data-action="edit" data-id="${e.id}">✎</button>
        <button class="icon-btn" title="Delete" data-action="delete" data-id="${e.id}">✕</button>
      </span>`;
    list.appendChild(row);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

document.getElementById('searchInput').addEventListener('input', renderList);
document.getElementById('categoryFilter').addEventListener('change', renderList);

// ---------- row actions ----------
document.getElementById('entriesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'copy') {
    try {
      const { password } = await api(`/api/passwords/${id}/reveal`);
      await navigator.clipboard.writeText(password);
      toast('Password copied to clipboard.');
    } catch (err) { toast(err.message); }
  }

  if (action === 'delete') {
    if (!confirm('Delete this entry permanently?')) return;
    await api(`/api/passwords/${id}`, { method: 'DELETE' });
    toast('Entry deleted.');
    refreshEntries();
  }

  if (action === 'edit') {
    const entry = entries.find(x => x.id === id);
    openModal(entry);
  }
});

// ---------- modal ----------
const overlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');

function openModal(entry) {
  document.getElementById('modalError').textContent = '';
  document.getElementById('entryId').value = entry ? entry.id : '';
  document.getElementById('entrySite').value = entry ? entry.site : '';
  document.getElementById('entryUsername').value = entry ? entry.username : '';
  document.getElementById('entryPassword').value = '';
  document.getElementById('entryPassword').placeholder = entry ? 'Leave blank to keep existing' : 'Enter a password';
  document.getElementById('entryCategory').value = entry ? entry.category : '';
  document.getElementById('entryNotes').value = entry ? entry.notes : '';
  modalTitle.textContent = entry ? 'Edit saved account' : 'Add a saved account';
  updateStrength('');
  overlay.classList.remove('hidden');
}

document.getElementById('addBtn').addEventListener('click', () => openModal(null));
document.getElementById('cancelModalBtn').addEventListener('click', () => overlay.classList.add('hidden'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

document.getElementById('saveEntryBtn').addEventListener('click', async () => {
  const id = document.getElementById('entryId').value;
  const site = document.getElementById('entrySite').value.trim();
  const username = document.getElementById('entryUsername').value.trim();
  const password = document.getElementById('entryPassword').value;
  const category = document.getElementById('entryCategory').value.trim() || 'Other';
  const notes = document.getElementById('entryNotes').value.trim();
  const errEl = document.getElementById('modalError');
  errEl.textContent = '';

  if (!site) return (errEl.textContent = 'Site / service name is required.');
  if (!id && !password) return (errEl.textContent = 'Password is required for a new entry.');

  try {
    if (id) {
      await api(`/api/passwords/${id}`, { method: 'PUT', body: { site, username, password, category, notes } });
      toast('Entry updated.');
    } else {
      await api('/api/passwords', { method: 'POST', body: { site, username, password, category, notes } });
      toast('Entry saved.');
    }
    overlay.classList.add('hidden');
    refreshEntries();
  } catch (e) { errEl.textContent = e.message; }
});

// ---------- password generator + strength meter ----------
function generatePassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

document.getElementById('genBtn').addEventListener('click', () => {
  const pw = generatePassword(16);
  const input = document.getElementById('entryPassword');
  input.type = 'text';
  input.value = pw;
  updateStrength(pw);
});

document.getElementById('entryPassword').addEventListener('input', (e) => updateStrength(e.target.value));

function updateStrength(pw) {
  const bar = document.querySelector('#strengthBar span');
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct = (score / 5) * 100;
  const colors = ['#e2473a', '#e2473a', '#e59a1f', '#e59a1f', '#1fa35c', '#1fa35c'];
  bar.style.width = pw ? `${Math.max(pct, 12)}%` : '0%';
  bar.style.background = colors[score];
}

boot();

// ©HomeHub LLC 2026
// ADDED: a project's clients (project-clients.html?project={id}). Opened from "Add client" on a project's page.
//
// Clients are the people a home is for (the buyer, and anyone they want following along). They can only VIEW project
// updates: this page shows the job details read-only, and every client permission is a view-only switch.
//
// Firestore data:
//   projects/{id}/clients/{clientId}  firstName, lastName, displayName, street, city, state, zip, phone, email,
//                                     lender, buyerAttorney, realtor, broker, archived, archivedAt,
//                                     createdAt, createdBy, updatedAt, updatedBy
//   projects/{id}.clientAccess        { portal, details, timeline, progress, punchItems, dailyLogs, files, notify }: true/false
//
// Nothing is written until Save. "Add client contact" opens a pop-up; its Save adds the contact to this page, and the
// page's Save writes everything at once. Cancel leaves without saving. Removing a client archives it (data safety:
// nothing is deleted outside Settings > Archive). Adding or changing clients needs "Edit, archive and delete projects".
(() => {
  'use strict';
  if (!window.firebase) return;
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const $ = id => document.getElementById(id);

  const pid = new URLSearchParams(location.search).get('project') || '';
  const projUrl = 'index.html#projects/' + encodeURIComponent(pid);

  // What clients may see. View-only, every one of them: there is no switch that lets a client edit anything.
  // The Firestore rules accept only these keys in clientAccess.
  const PERMS = [
    ['details',    'Job details',               'Address, lot, community and dates.'],
    ['timeline',   'Schedule and phases',       'Start, target completion and each phase.'],
    ['progress',   'Punch list progress',       'How close the job is to done.'],
    ['punchItems', 'Punch list items',          'Each item and whether it’s signed off.'],
    ['dailyLogs',  'Daily logs',                'Notes and photos from the job site.', true],
    ['files',      'Files and photos',          'Documents and pictures shared with them.', true],
    ['notify',     'Email updates',             'Send clients an email when there’s an update.']
  ];
  const DEFAULT_ACCESS = { portal: true, details: true, timeline: true, progress: true, punchItems: false, dailyLogs: true, files: true, notify: false };

  const FIELDS = [ // [input id, saved field, max length]
    ['cFirst', 'firstName', 40], ['cLast', 'lastName', 40], ['cDisplay', 'displayName', 80],
    ['cStreet', 'street', 120], ['cCity', 'city', 60], ['cState', 'state', 2], ['cZip', 'zip', 10],
    ['cPhone', 'phone', 30], ['cEmail', 'email', 120],
    ['cLender', 'lender', 80], ['cAttorney', 'buyerAttorney', 80], ['cRealtor', 'realtor', 80], ['cBroker', 'broker', 80]
  ];
  const CUSTOM = [['lender', 'Lender'], ['buyerAttorney', 'Buyer attorney'], ['realtor', 'Realtor'], ['broker', 'Broker']];
  const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN',
    'MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  const st = {
    uid: '', wid: '', canEdit: false, ready: false, saving: false,
    project: null,
    clients: [],     // { id, data, isNew, changed, removed }
    access: Object.assign({}, DEFAULT_ACCESS),
    savedAccess: '',
    editing: null    // the client open in the pop-up, or null for a new one
  };

  // ---------- Small helpers ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const parseDay = s => { const d = s ? new Date(s + (s.length === 10 ? 'T12:00' : '')) : null; return d && !isNaN(d) ? d : null; };
  const fmtDay = s => { const d = parseDay(s); return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
  const projName = p => p.name || [p.lot && 'Lot ' + p.lot, p.community].filter(Boolean).join(' · ') || 'Untitled project';
  const STAGE = { open: 'Open', warranty: 'Warranty', closed: 'Closed' };
  function showMsg(text) {
    const m = $('pcMsg');
    m.textContent = text || '';
    m.hidden = !text;
    if (text) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  let toastT;
  function toast(text) {
    const t = $('pcToast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3000);
  }
  function setErr(id, text, input) {
    $(id).textContent = text || '';
    if (input) text ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
  }
  const isDirty = () => st.clients.some(c => c.isNew || c.changed || c.removed) || JSON.stringify(st.access) !== st.savedAccess;
  function markDirty() { $('pcDirty').hidden = !isDirty(); }

  $('pcBack').href = $('pcCancel').href = projUrl;
  // Leaving with unsaved changes asks first (Cancel, Back, closing the tab)
  window.addEventListener('beforeunload', e => { if (!st.saving && isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  [$('pcBack'), $('pcCancel')].forEach(a => a.addEventListener('click', e => {
    if (isDirty() && !confirm('Leave without saving? The clients and permissions you changed won’t be saved.')) { e.preventDefault(); return; }
    st.saving = true; // already confirmed, so don't ask again on unload
  }));

  // ---------- Job details (read-only) ----------
  function renderJob(p) {
    const dl = $('pcJob');
    dl.textContent = '';
    const rows = [
      ['Project', projName(p)], ['Address', p.address], ['Community', p.community], ['Lot', p.lot],
      ['Stage', STAGE[p.status] || 'Open'], ['Project date', fmtDay(p.date)],
      ['Start', fmtDay(p.startDate)], ['Target completion', fmtDay(p.endDate)], ['Notes', p.description, true]
    ];
    rows.forEach(([k, v, wide]) => {
      const d = el('div', wide ? 'pc-wide' : null);
      const dd = el('dd', v ? null : 'is-empty', v || '—');
      d.append(el('dt', null, k), dd);
      dl.appendChild(d);
    });
  }

  // ---------- Clients ----------
  function initials(d) {
    const a = clean(d.firstName).charAt(0), b = clean(d.lastName).charAt(0);
    return ((a + b) || clean(d.displayName).charAt(0) || '?').toUpperCase();
  }
  function renderClients() {
    const ul = $('pcClients');
    ul.textContent = '';
    const shown = st.clients.filter(c => !c.removed);
    $('pcEmpty').hidden = shown.length > 0;
    shown.forEach(c => {
      const d = c.data;
      const li = el('li', 'pc-client' + (c.isNew ? ' is-new' : ''));
      li.appendChild(el('span', 'pc-avatar', initials(d)));
      const main = el('div', 'pc-client-main');
      const name = el('b', null, d.displayName);
      if (c.isNew) name.appendChild(el('span', 'pc-tag', 'Not saved yet'));
      main.appendChild(name);
      const full = [d.firstName, d.lastName].filter(Boolean).join(' ');
      if (full && full !== d.displayName) main.appendChild(el('span', 'pc-line', full));
      const contact = [d.email, d.phone].filter(Boolean).join(' · ');
      if (contact) main.appendChild(el('span', 'pc-line', contact));
      const addr = [d.street, [d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
      if (addr) main.appendChild(el('span', 'pc-line', addr));
      const chips = el('ul', 'pc-chips');
      CUSTOM.forEach(([k, label]) => { if (d[k]) { const x = el('li'); x.append(el('span', null, label + ': '), document.createTextNode(d[k])); chips.appendChild(x); } });
      if (chips.children.length) main.appendChild(chips);
      li.appendChild(main);
      if (st.canEdit) {
        const acts = el('div', 'pc-client-acts');
        const edit = el('button', 'btn', 'Edit');
        edit.type = 'button';
        edit.setAttribute('aria-label', 'Edit ' + d.displayName);
        edit.addEventListener('click', () => openDlg(c));
        const rm = el('button', 'btn btn--danger', 'Remove');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + d.displayName);
        rm.addEventListener('click', () => removeClient(c));
        acts.append(edit, rm);
        li.appendChild(acts);
      }
      ul.appendChild(li);
    });
  }
  function removeClient(c) {
    if (!confirm('Remove ' + c.data.displayName + ' from this project? They’ll no longer see its updates. This takes effect when you tap Save.')) return;
    if (c.isNew) st.clients.splice(st.clients.indexOf(c), 1); // never saved, so just drop it
    else c.removed = true;                                     // saved: archived on Save (kept in Firestore)
    renderClients();
    markDirty();
    $('pcAdd').focus();
  }

  // ---------- Pop-up: add or edit a client contact ----------
  const sel = $('cState');
  sel.appendChild(new Option('—', ''));
  STATES.forEach(s => sel.appendChild(new Option(s, s)));
  let displayTouched = false;
  const autoDisplay = () => [clean($('cFirst').value), clean($('cLast').value)].filter(Boolean).join(' ');
  ['cFirst', 'cLast'].forEach(id => $(id).addEventListener('input', () => { if (!displayTouched) $('cDisplay').value = autoDisplay(); }));
  $('cDisplay').addEventListener('input', () => { displayTouched = $('cDisplay').value.trim() !== '' && $('cDisplay').value !== autoDisplay(); });

  let lastFocus = null;
  function openDlg(c) {
    if (!st.canEdit) return;
    st.editing = c || null;
    lastFocus = document.activeElement;
    $('pcDlgH').textContent = c ? 'Edit client contact' : 'Add client contact';
    const d = c ? c.data : {};
    FIELDS.forEach(([id, k]) => { $(id).value = d[k] || ''; $(id).removeAttribute('aria-invalid'); });
    ['cDisplayErr', 'cZipErr', 'cPhoneErr', 'cEmailErr'].forEach(id => setErr(id, ''));
    displayTouched = !!(c && d.displayName && d.displayName !== [d.firstName, d.lastName].filter(Boolean).join(' '));
    $('pcDlgBack').hidden = false;
    document.documentElement.style.overflow = 'hidden';
    $('cFirst').focus();
  }
  function closeDlg() {
    $('pcDlgBack').hidden = true;
    document.documentElement.style.overflow = '';
    st.editing = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('pcAdd').addEventListener('click', () => openDlg(null));
  $('pcDlgCancel').addEventListener('click', closeDlg);
  $('pcDlgBack').addEventListener('click', e => { if (e.target === $('pcDlgBack')) closeDlg(); });
  document.addEventListener('keydown', e => {
    if ($('pcDlgBack').hidden) return;
    if (e.key === 'Escape') closeDlg();
    if (e.key === 'Tab') { // keep keyboard focus inside the pop-up
      const f = Array.from($('pcForm').querySelectorAll('input, select, button')).filter(x => !x.disabled);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  $('pcForm').addEventListener('submit', e => {
    e.preventDefault();
    const d = {};
    FIELDS.forEach(([id, k, max]) => { d[k] = clean($(id).value).slice(0, max); });
    if (!d.displayName) d.displayName = [d.firstName, d.lastName].filter(Boolean).join(' ');
    d.email = d.email.toLowerCase();
    let bad = null;
    const check = (errId, input, msg) => { setErr(errId, msg, input); if (msg && !bad) bad = input; };
    check('cDisplayErr', $('cDisplay'), d.displayName ? '' : 'Enter a first name, last name or display name.');
    check('cZipErr', $('cZip'), !d.zip || /^\d{5}(-\d{4})?$/.test(d.zip) ? '' : 'Use 5 digits, like 60440.');
    const digits = d.phone.replace(/\D/g, '');
    check('cPhoneErr', $('cPhone'), !d.phone || (digits.length >= 7 && digits.length <= 15 && /^[\d\s()+.\-x]+$/i.test(d.phone)) ? '' : 'Check the phone number.');
    check('cEmailErr', $('cEmail'), !d.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? '' : 'Check the email address.');
    if (!bad && d.email) {
      const dup = st.clients.find(c => !c.removed && c !== st.editing && c.data.email === d.email);
      if (dup) check('cEmailErr', $('cEmail'), dup.data.displayName + ' already uses this email.');
    }
    if (bad) { bad.focus(); return; }
    if (st.editing) {
      Object.assign(st.editing.data, d);
      if (!st.editing.isNew) st.editing.changed = true;
    } else {
      st.clients.push({ id: db.collection('projects/' + pid + '/clients').doc().id, data: d, isNew: true });
    }
    const wasEdit = !!st.editing;
    closeDlg();
    renderClients();
    markDirty();
    toast((wasEdit ? 'Updated ' : 'Added ') + d.displayName + '. Tap Save to keep it.');
  });

  // ---------- Client permissions ----------
  function permRow(key, label, hint, soon, master) {
    const li = el('li');
    const row = el('div', 'pc-perm' + (master ? ' pc-perm--master' : ''));
    const text = el('div', 'pc-perm-text');
    const b = el('b', null, label);
    if (soon) b.appendChild(el('span', 'soon', 'Soon'));
    const id = 'perm-' + key;
    text.append(b, el('span', null, hint));
    const sw = el('label', 'pc-switch');
    const input = el('input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.checked = !!st.access[key];
    input.dataset.key = key;
    sw.append(input, el('i'));
    row.append(text, sw);
    li.appendChild(row);
    return li;
  }
  function renderPerms() {
    const ul = $('pcPerms');
    ul.textContent = '';
    ul.appendChild(permRow('portal', 'Clients can view this project', 'Turn off to hide the whole project from clients.', false, true));
    PERMS.forEach(([k, label, hint, soon]) => ul.appendChild(permRow(k, label, hint, soon)));
    syncPerms();
  }
  function syncPerms() {
    $('pcPerms').querySelectorAll('input[data-key]').forEach(i => {
      i.checked = !!st.access[i.dataset.key];
      const off = i.dataset.key !== 'portal' && !st.access.portal;
      i.disabled = !st.canEdit || off;
      i.closest('.pc-perm').classList.toggle('is-off', off);
    });
  }
  $('pcPerms').addEventListener('change', e => {
    const i = e.target.closest('input[data-key]');
    if (!i || !st.canEdit) return;
    st.access[i.dataset.key] = i.checked;
    syncPerms();
    markDirty();
  });

  // ---------- Save: every change in one batch ----------
  $('pcSave').addEventListener('click', async () => {
    showMsg('');
    if (!st.ready) return showMsg('Still loading. Try again in a moment.');
    if (!st.canEdit) return showMsg('You don’t have access to change this project’s clients. Ask a workspace admin for “Edit, archive and delete projects”.');
    if (!isDirty()) { location.href = projUrl; return; }
    if (navigator.onLine === false) return showMsg('You’re offline. Connect to the internet to save.');
    const btn = $('pcSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const now = new Date().toISOString();
    try {
      const b = db.batch();
      st.clients.forEach(c => {
        const ref = db.doc('projects/' + pid + '/clients/' + c.id);
        if (c.removed) b.set(ref, { archived: true, archivedAt: now, updatedAt: now, updatedBy: st.uid }, { merge: true });
        else if (c.isNew) b.set(ref, Object.assign({}, c.data, { archived: false, createdAt: now, createdBy: st.uid, updatedAt: now, updatedBy: st.uid }));
        else if (c.changed) b.set(ref, Object.assign({}, c.data, { updatedAt: now, updatedBy: st.uid }), { merge: true });
      });
      // Only the fields this page owns; the project's stage and details are never touched here
      if (JSON.stringify(st.access) !== st.savedAccess || !st.project.clientAccess) b.update(db.doc('projects/' + pid), { clientAccess: Object.assign({}, st.access), updatedAt: now });
      await b.commit();
      st.saving = true;
      location.href = projUrl;
    } catch (ex) {
      console.error(ex);
      btn.disabled = false;
      btn.textContent = 'Save';
      showMsg(ex && ex.code === 'permission-denied'
        ? 'Couldn’t save: permission denied. Ask an admin for “Edit, archive and delete projects”, and make sure the Firestore rules are published.'
        : 'Couldn’t save. Check your connection and try again.');
    }
  });

  // ---------- Load ----------
  async function load(user) {
    if (!pid) { $('pcTitle').textContent = 'Clients'; showMsg('No project was chosen. Open a project, then tap Add client.'); return; }
    const p = await db.doc('users/' + user.uid + '/profile/info').get();
    const prof = p.exists ? p.data() : {};
    if (!prof.workspaceId || !prof.username) { location.replace('signup.html'); return; }
    st.uid = user.uid;
    st.wid = prof.workspaceId;
    const [w, m, ps] = await Promise.all([
      db.doc('workspaces/' + st.wid).get(),
      db.doc('workspaces/' + st.wid + '/members/' + user.uid).get(),
      db.doc('projects/' + pid).get()
    ]);
    if (!ps.exists || ps.data().workspaceId !== st.wid || ps.data().archived) {
      $('pcTitle').textContent = 'Clients';
      showMsg('That project was not found. It may have been archived or deleted.');
      $('pcSave').disabled = $('pcAdd').disabled = true;
      return;
    }
    const me = m.exists ? m.data() : {};
    const isAdmin = (w.exists && w.data().ownerId === user.uid) || me.admin === true;
    const perm = window.HH_PERMS ? window.HH_PERMS.of(me, isAdmin) : {};
    st.canEdit = !!perm.manageProjects;
    st.project = ps.data();
    document.title = projName(st.project) + ' · Clients · HomeHub';
    $('pcTitle').textContent = projName(st.project);
    renderJob(st.project);

    const saved = st.project.clientAccess || {};
    st.access = Object.assign({}, DEFAULT_ACCESS);
    Object.keys(DEFAULT_ACCESS).forEach(k => { if (typeof saved[k] === 'boolean') st.access[k] = saved[k]; });
    st.savedAccess = JSON.stringify(st.access); // a project with no saved permissions shows the defaults (written on the first Save)

    const cs = await db.collection('projects/' + pid + '/clients').get();
    st.clients = cs.docs.map(d => ({ id: d.id, data: d.data() })).filter(c => !c.data.archived)
      .sort((a, b) => String(a.data.displayName).localeCompare(String(b.data.displayName)));
    renderClients();
    renderPerms();
    st.ready = true;
    markDirty();
    if (!st.canEdit) {
      $('pcAdd').hidden = true;
      $('pcSave').disabled = true;
      showMsg('You can see this project’s clients, but changing them needs “Edit, archive and delete projects”. Ask a workspace admin.');
    }
  }

  auth.onAuthStateChanged(user => {
    if (!user) { location.replace('login.html'); return; }
    load(user).catch(ex => {
      console.error(ex);
      showMsg(ex && ex.code === 'permission-denied'
        ? 'This page couldn’t load: permission denied. Make sure the Firestore rules are published, then refresh.'
        : 'Couldn’t load the project. Check your connection and refresh.');
    });
  });
})();

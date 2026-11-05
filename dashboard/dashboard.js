// ©HomeHub LLC 2026
(() => {
  'use strict';
  if (!window.firebase) return;
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  // A panel missing from index.html gives a harmless stand-in instead of crashing the page (so Projects always loads)
  const $ = id => document.getElementById(id) || (console.warn('index.html has no #' + id), document.createElement('div'));
  const root = document.getElementById('db');
  if (!root) return;

  const DAY = 864e5;
  const QUIET_DAYS = 14;       // ADDED: no activity on a project for this many days = it needs a look
  const LONG_LIST = 25;        // ADDED: a punch list with this many open items is "long"
  const NEARLY_DONE = 3;       // this few left = "is N items from done" in the summary
  const MAX_DETAIL_JOBS = 60;  // read items for at most this many lists (most recent first)
  const TASKS_SHOWN = 8;       // open items shown in Up next before "Show all"

  const st = {
    user: null, profile: {}, wid: '', ws: {}, members: [], projects: [], jobs: [], loose: [], folders: {},
    canEdit: false, isAdmin: false, perm: {}, mine: false, focus: '', loaded: false, allTasks: false, projectsFailed: false,
    stage: 'open' // which stage the sidebar (and My projects) shows: Open, Warranty or Closed
  };

  // ---------- PROJECT STAGES (ADDED) ----------
  // Every project is in one stage: Open (being built) → Warranty (handed over, under warranty) → Closed (done).
  // Saved as projects/{id}.status. Projects made before stages existed have no status and count as Open.
  const STAGES = [['open', 'Open'], ['warranty', 'Warranty'], ['closed', 'Closed']];
  const stageOf = p => p.status === 'warranty' || p.status === 'closed' ? p.status : 'open';
  const stageName = k => (STAGES.find(x => x[0] === k) || STAGES[0])[1];
  try { const k = sessionStorage.getItem('hh-proj-stage'); if (STAGES.some(x => x[0] === k)) st.stage = k; } catch (e) {}

  // ---------- Small helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function link(href, cls, text) { const a = el('a', cls, text); a.href = href; return a; }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const toMs = v => !v ? 0 : typeof v === 'string' ? (Date.parse(v) || 0) : v.toMillis ? v.toMillis() : v.toDate ? +v.toDate() : +v || 0;
  function ago(ms) {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 6e4);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return plural(h, 'hour') + ' ago';
    const d = Math.round(h / 24);
    if (d < 7) return d === 1 ? 'yesterday' : d + ' days ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayLabel(ms) {
    const d = new Date(ms), t = new Date();
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(t) - start(d)) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  // "2026-10-20" -> a Date at local noon (so time zones don't shift the day)
  const parseDay = s => { const d = s ? new Date(s + (s.length === 10 ? 'T12:00' : '')) : null; return d && !isNaN(d) ? d : null; };
  const fmtDay = s => { const d = parseDay(s); return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; };
  const fmtShort = s => { const d = parseDay(s); return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };
  const cut = (s, n) => s.length > n ? s.slice(0, n - 2).trim() + '…' : s;
  // A punch list's title, the same one My Lists shows: "Lot 12 · Oakwood · Final walk"
  function listTitle(j) {
    if (j.name) return j.name;
    const desc = (j.description || '').replace(/\s+/g, ' ').trim();
    return [j.lot && 'Lot ' + j.lot, j.community, desc].filter(Boolean).join(' · ') || 'Untitled punch list';
  }
  function listShort(j) {
    if (j.name) return cut(j.name, 32);
    const desc = (j.description || '').replace(/\s+/g, ' ').trim();
    if (desc) return cut(desc, 32);
    if (j.lot) return 'Lot ' + j.lot;
    return cut(listTitle(j), 28);
  }
  const projName = p => p.name || [p.lot && 'Lot ' + p.lot, p.community].filter(Boolean).join(' · ') || 'Untitled project';
  const projShort = p => cut(projName(p), 32);
  const listUrl = id => 'allLists.html?job=' + encodeURIComponent(id);
  const projUrl = id => '#projects/' + encodeURIComponent(id);
  const projOf = j => j.projectId ? st.projects.find(p => p.id === j.projectId) || null : null;
  function memberName(uid) {
    const m = st.members.find(x => x.id === uid);
    return m ? (m.displayName || m.email || 'Someone') : 'Someone';
  }
  const trim = (s, n = 60) => cut(String(s || '').replace(/\s+/g, ' ').trim(), n);
  let toastTimer;
  // toast(text) = small message at the bottom. toast(text, 'warranty') (or 'open' / 'closed') = a colored banner at the TOP of the
  // screen that stays a bit longer, used when a project changes stage so people can't miss it.
  function toast(text, banner) {
    const t = $('dbToast');
    t.textContent = text;
    t.className = 'db-toast' + (banner ? ' db-toast--banner is-' + banner : '');
    void t.offsetWidth; // restart the slide-in if a message is already showing
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), banner ? 6000 : 3200);
  }
  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>'
  };

  // ---------- Load ----------
  async function load(user) {
    st.user = user;
    const p = await db.doc('users/' + user.uid + '/profile/info').get();
    st.profile = p.exists ? p.data() : {};
    st.wid = st.profile.workspaceId || '';
    if (!st.wid || !st.profile.username) { location.replace('signup.html'); return; } // setup not finished

    const [w, ms] = await Promise.all([
      db.doc('workspaces/' + st.wid).get(),
      db.collection('workspaces/' + st.wid + '/members').get()
    ]);
    st.ws = w.exists ? w.data() : {};
    st.members = ms.docs.map(d => ({ id: d.id, ...d.data() }));
    const me = st.members.find(m => m.id === user.uid) || {};
    st.isAdmin = st.ws.ownerId === user.uid || me.admin === true; // the owner plus anyone made an admin in Settings
    // CHANGED: what this person may do comes from the permissions an admin gave them (firebase-starter/perms.js)
    st.perm = window.HH_PERMS ? window.HH_PERMS.of(me, st.isAdmin) : {};
    st.canEdit = !!st.perm.manageLists;

    // ADDED (data safety): bring back this person's lists from before workspaces first, so they show up below
    // (firebase-starter/legacy-data.js; never deletes anything, and a failure is ignored)
    if (window.HH_LEGACY) {
      const back = await window.HH_LEGACY.adopt(db, user.uid, st.wid, !!st.perm.manageLists);
      if (back) setTimeout(() => toast((back === 1 ? '1 older list was' : back + ' older lists were') + ' brought back into your workspace.'), 600);
    }
    const [ps, js] = await Promise.all([
      db.collection('projects').where('workspaceId', '==', st.wid).get().catch(e => { console.error('Projects:', e); st.projectsFailed = true; return { docs: [] }; }),
      db.collection('jobs').where('workspaceId', '==', st.wid).get()
    ]);
    // ADDED: the workspace's folders (saved inside settings/app), so lists and folders can be added to or removed from a project
    try {
      const fsnap = await db.doc('workspaces/' + st.wid + '/settings/app').get();
      st.folders = (fsnap.exists && fsnap.data().folders && typeof fsnap.data().folders === 'object') ? fsnap.data().folders : {};
    } catch (e) { console.error('Folders:', e); st.folders = {}; }
    st.projects = ps.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !x.archived);
    st.jobs = js.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => !j.archived)
      .map(j => Object.assign(j, { _items: null, _last: Math.max(toMs(j.updatedAt), toMs(j.createdAt)) }))
      .sort((a, b) => b._last - a._last);
    link_();
    try { sessionStorage.removeItem('hh-focus'); } catch (e) {} // the sidebar project picker is gone; the dashboard always shows every project

    renderHello();
    renderBrand();
    renderAll(); // first pass from the saved counts, so the page fills in fast
    await loadItems(st.jobs.slice(0, MAX_DETAIL_JOBS));
    st.loaded = true;
    link_();
    renderAll();
  }

  // Attach each punch list to its project; lists without a (known) project are "loose"
  function link_() {
    st.projects.forEach(p => { p._lists = []; });
    st.loose = [];
    st.jobs.forEach(j => { const p = projOf(j); p ? p._lists.push(j) : st.loose.push(j); });
    st.projects.forEach(p => { p._last = Math.max(toMs(p.updatedAt), toMs(p.createdAt), ...p._lists.map(j => j._last)); });
    st.projects.sort((a, b) => b._last - a._last);
  }

  // Read each punch list's items, statuses and rooms. One failing list doesn't stop the others.
  async function loadItems(jobs) {
    await Promise.all(jobs.map(async j => {
      try {
        const get = c => db.collection('jobs/' + j.id + '/' + c).get().then(s => Object.fromEntries(s.docs.map(d => [d.id, d.data()])));
        const [custom, items, rooms, hidden] = await Promise.all([get('custom'), get('items'), get('rooms'), get('hidden')]);
        j._items = Object.entries(custom)
          .filter(([, c]) => c && c.text && !(hidden[c.room] && hidden[c.room].hidden))
          .map(([id, c]) => {
            const r = items[id] || {};
            return {
              id, text: c.text, roomName: (rooms[c.room] && rooms[c.room].name) || 'Other',
              trade: r.trade || c.trade || '', done: !!r.done, doneAt: toMs(r.doneAt), signedBy: r.signedBy || '',
              assignedTo: r.assignedTo || '', assignedName: r.assignedName || '', // ADDED: who it's assigned to
              createdAt: toMs(c.createdAt)
            };
          });
        j._items.forEach(it => { j._last = Math.max(j._last, it.doneAt, it.createdAt); });
      } catch (e) { console.error('Could not read punch list ' + j.id, e); }
    }));
  }

  // Open and total items on one punch list: worked out from its items when we have them, otherwise its saved counts
  function listCounts(j) {
    if (j._items) return { open: j._items.filter(i => !i.done).length, total: j._items.length };
    return { open: typeof j.openCount === 'number' ? j.openCount : 0, total: j.totalCount || 0 };
  }
  // A project's progress is every punch list in it added together
  function projCounts(p) {
    const c = (p._lists || []).reduce((s, j) => { const x = listCounts(j); s.open += x.open; s.total += x.total; return s; }, { open: 0, total: 0 });
    c.pct = c.total ? Math.round((c.total - c.open) / c.total * 100) : 0;
    c.lists = (p._lists || []).length;
    return c;
  }

  function analyze() {
    const projects = st.projects.map(p => ({ p, ...projCounts(p) }));
    // With a project picked in the sidebar, everything on the dashboard is about that project only
    const focus = st.focus ? st.projects.find(p => p.id === st.focus) || null : null;
    if (st.focus && !focus && st.loaded) st.focus = ''; // it was deleted
    const jobs = focus ? focus._lists : st.jobs;
    const shown = focus ? projects.filter(x => x.p === focus) : projects;
    const openTotal = jobs.reduce((s, j) => s + listCounts(j).open, 0);
    const weekAgo = Date.now() - 7 * DAY;
    const signedWeek = jobs.reduce((s, j) => s + (j._items || []).filter(i => i.done && i.doneAt >= weekAgo).length, 0);

    // Up next: every open punch item, oldest first (the longest-waiting work comes first)
    const tasks = [];
    jobs.forEach(j => (j._items || []).forEach(i => { if (!i.done) tasks.push({ ...i, job: j }); }));
    tasks.sort((a, b) => (a.createdAt || Infinity) - (b.createdAt || Infinity));
    const mineCount = tasks.filter(t => t.assignedTo === st.user.uid).length; // ADDED
    if (st.mine) tasks.splice(0, tasks.length, ...tasks.filter(t => t.assignedTo === st.user.uid)); // ADDED: "Assigned to me"

    // Recent activity, newest first
    const events = [];
    jobs.forEach(j => {
      (j._items || []).forEach(i => {
        if (i.done && i.doneAt) events.push({ t: i.doneAt, kind: 'signed', who: i.signedBy || 'Someone', what: i.text, job: j });
        if (i.createdAt) events.push({ t: i.createdAt, kind: 'added', what: i.text, job: j });
      });
      const c = toMs(j.createdAt);
      if (c) events.push({ t: c, kind: 'list', who: memberName(j.ownerId), job: j });
    });
    (focus ? [focus] : st.projects).forEach(p => { const c = toMs(p.createdAt); if (c) events.push({ t: c, kind: 'project', who: memberName(p.ownerId), proj: p }); });
    events.sort((a, b) => b.t - a.t);

    return { projects, shown, focus, jobs, openTotal, signedWeek, tasks, mineCount, events: events.slice(0, 10) };
  }

  // ---------- Render ----------
  function renderHello() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const first = ((st.profile.name || st.user.displayName || '').trim().split(/\s+/)[0]) || 'there';
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const p = $('dbHello');
    p.textContent = part + ', ';
    p.appendChild(el('b', null, first));
    p.appendChild(document.createTextNode('. ' + date + (st.ws.name ? ' at ' + st.ws.name : '') + '.'));
  }

  // Workspace logo and name at the top of the sidebar (the dashboard has no top bar)
  function renderBrand() {
    const name = st.ws.name || 'Workspace';
    $('dbWsName').textContent = name;
    const box = $('dbWsLogo');
    box.textContent = '';
    if (st.ws.logo) { const img = new Image(); img.alt = ''; img.src = st.ws.logo; box.appendChild(img); }
    else box.textContent = name.trim().charAt(0).toUpperCase();
  }

  function renderAll() {
    const a = analyze();
    // One section failing (say, a panel missing from index.html) must not stop the others, Projects included
    [renderSide, renderBrief, renderFacts, renderFeed, renderLoose].forEach(fn => {
      try { fn(a); } catch (ex) { console.error(fn.name + ' failed:', ex); }
    });
    route();
  }

  // Sidebar: the projects in the stage picked with Open / Warranty / Closed. Each links to that project's page.
  function renderSide(a) {
    $('dbAddProject').hidden = !st.perm.createProjects;
    // Search by name, lot, community, address or the name of one of its lists. The counts on Open / Warranty / Closed follow the search.
    const q = ($('projSearch').value || '').trim().toLowerCase();
    const found = !q ? a.projects : a.projects.filter(x => [projName(x.p), x.p.address, x.p.community, x.p.lot, ...(x.p._lists || []).map(listTitle)].join(' ').toLowerCase().includes(q));
    renderStageBar(found);
    const ul = $('dbSideProjects');
    ul.textContent = '';
    const list = found.filter(x => stageOf(x.p) === st.stage);
    if (!list.length) {
      ul.appendChild(el('li', 'db-empty', st.projectsFailed ? 'Projects couldn’t load. Republish the Firestore rules, then refresh.'
        : !a.projects.length ? (st.perm.createProjects ? 'No projects yet. Use + to create one.' : 'No projects yet.')
        : q ? 'No ' + stageName(st.stage).toLowerCase() + ' projects match “' + q + '”.' + (found.length ? ' Try another tab.' : '')
        : 'No ' + stageName(st.stage).toLowerCase() + ' projects.'));
      return;
    }
    list.forEach(x => {
      const li = el('li');
      const aEl = link(projUrl(x.p.id));
      aEl.dataset.pid = x.p.id;
      aEl.append(el('b', null, projName(x.p)), el('span', 'addr', x.p.address || [x.p.lot && 'Lot ' + x.p.lot, x.p.community].filter(Boolean).join(', ') || 'No address yet'),
        tape(x.pct, x.total > 0 && x.open === 0, projName(x.p) + ' progress'));
      li.appendChild(aEl);
      ul.appendChild(li);
    });
    markSide();
  }
  // Highlight the project whose page is open
  function markSide() {
    const [view, sub] = decodeURIComponent(location.hash.slice(1)).split('/');
    document.querySelectorAll('#dbSideProjects a').forEach(a => view === 'projects' && sub === a.dataset.pid ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  }

  // The + menu under the workspace name: new project, new list, new daily log (moved here from the bottom dock)
  const addBtn = $('dbAdd'), addMenu = $('dbAddMenu');
  function toggleAdd(open) {
    const on = open ?? !addMenu.classList.contains('is-open');
    addMenu.classList.toggle('is-open', on);
    addBtn.setAttribute('aria-expanded', String(on));
  }
  addBtn.addEventListener('click', e => { e.stopPropagation(); toggleAdd(); });
  document.addEventListener('click', e => { if (!addMenu.contains(e.target)) toggleAdd(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleAdd(false); });
  addMenu.addEventListener('click', () => toggleAdd(false));

  // ADDED: a second sentence for the briefing: what was signed off this week, and what is assigned to you.
  // Empty until the items have loaded, so the numbers are never a guess.
  function briefDetail(a) {
    if (!st.loaded) return '';
    const bits = [];
    if (a.signedWeek) bits.push(plural(a.signedWeek, 'item') + (a.signedWeek === 1 ? ' was' : ' were') + ' signed off in the last 7 days');
    else if (a.openTotal) bits.push('nothing has been signed off in the last 7 days');
    if (a.mineCount) bits.push(plural(a.mineCount, 'open item') + (a.mineCount === 1 ? ' is' : ' are') + ' assigned to you');
    if (!bits.length) return '';
    const text = bits.join(', and ');
    return ' ' + text.charAt(0).toUpperCase() + text.slice(1) + '.';
  }

  // The briefing: how much is open, and which project is closest to done (plus the second sentence from briefDetail): how much is open, and which project is closest to done. Parts that point somewhere are links.
  function renderBrief(a) {
    const b = $('dbBrief');
    b.textContent = '';
    b.classList.remove('is-loading');
    const parts = [];
    const add = (text, href) => parts.push({ text, href });
    if (a.focus) {
      const c = a.shown[0];
      if (!c.lists) add(projName(a.focus) + ' has no lists yet.');
      else if (!st.loaded) add('Checking ' + projName(a.focus) + '…');
      else {
        if (a.openTotal) add(plural(a.openTotal, 'item') + (a.openTotal === 1 ? ' is' : ' are') + ' still open on ');
        else add('Every list item on ');
        add(projName(a.focus), projUrl(a.focus.id));
        // ADDED: say how many lists the open items are spread across
        const openLists = a.jobs.filter(j => listCounts(j).open > 0).length;
        const across = a.openTotal && openLists > 1 ? ', across ' + plural(openLists, 'list') : '';
        add(a.openTotal ? across + (a.openTotal <= NEARLY_DONE ? ', so it is almost done.' : '.') : ' is signed off.');
        add(briefDetail(a));
      }
    } else if (!a.projects.length && !st.jobs.length) {
      add('Your workspace is ready. ');
      add(st.perm.createProjects ? 'Create your first project.' : 'Projects will show up here once someone creates one.', st.perm.createProjects ? 'new-project.html' : null);
    } else {
      if (a.openTotal) {
        // ADDED: also say how many lists the open items are spread across
        const openLists = a.jobs.filter(j => listCounts(j).open > 0).length;
        add(plural(a.openTotal, 'item'));
        add((a.openTotal === 1 ? ' is' : ' are') + ' still open' + (openLists ? ' across ' + plural(openLists, 'list') : ''));
      }
      else add('Every list item is signed off');
      const close = a.projects.filter(x => x.open > 0 && x.open <= NEARLY_DONE).sort((x, y) => x.open - y.open)[0];
      if (close) { add(', and '); add(projShort(close.p), projUrl(close.p.id)); add(' is ' + plural(close.open, 'item') + ' from done.'); }
      else add('.');
      add(briefDetail(a));
    }
    parts.forEach(p => b.appendChild(p.href ? link(p.href, null, p.text) : document.createTextNode(p.text)));
    if (st.loaded) { b.classList.remove('is-ready'); void b.offsetWidth; b.classList.add('is-ready'); }
  }

  function renderFacts(a) {
    $('fProjects').textContent = a.shown.length;
    $('fOpen').textContent = a.openTotal;
    $('fOpenBox').classList.toggle('is-hot', a.openTotal > 0);
    $('fSigned').textContent = st.loaded ? a.signedWeek : '–';
    $('fTeam').textContent = st.members.length;
  }

  // Where an item lives: room · punch list · project
  function whereOf(t) {
    const p = projOf(t.job);
    return [t.roomName, listShort(t.job), p && projShort(p), t.trade].filter(Boolean).join(' · ');
  }

  // ---------- SIGN OFF (kept for later) ----------
  // Up next is gone from the dashboard, so nothing opens this box right now. It is kept so it can be reused on a project's page.
  // Same rule as on the punch list page: an item is only marked done once someone types their name and signs.
  // Saves the same fields the punch list page saves (done, doneAt, signedBy, signature), so the Firestore rules accept it
  // from anyone in the workspace, and updates the list's open count.
  const SIGNER_KEY = 'punch-app-v1-signer'; // the name last typed on this device (shared with the punch list page)
  const sg = { task: null, drawn: false, drawing: false, last: null };
  const sgBack = $('dbSignBack'), sgPad = $('dbSignPad'), sgName = $('dbSignName'), sgErr = $('dbSignErr');
  function openSign(t) {
    if (!sgBack) { toast('Reload the page to sign items off.'); return; }
    sg.task = t;
    $('dbSignItem').textContent = t.text + ' · ' + whereOf(t);
    let last = '';
    try { last = localStorage.getItem(SIGNER_KEY) || ''; } catch (e) {}
    sgName.value = st.profile.name || last;
    sgErr.hidden = true;
    sgBack.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    sizeSignPad();
    (sgName.value ? sgPad : sgName).focus({ preventScroll: true });
  }
  function closeSign() {
    sgBack.hidden = true;
    sg.task = null;
    document.documentElement.style.overflow = '';
  }
  function sizeSignPad() {
    const r = sgPad.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    sgPad.width = Math.round(r.width * dpr); sgPad.height = Math.round(r.height * dpr);
    const ctx = sgPad.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d2422'; ctx.fillStyle = '#1d2422';
    sg.drawn = false;
  }
  if (sgBack) {
    const pt = e => { const r = sgPad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    sgPad.addEventListener('pointerdown', e => {
      e.preventDefault(); sgPad.setPointerCapture(e.pointerId);
      sg.drawing = true; sg.last = pt(e);
      const ctx = sgPad.getContext('2d'); ctx.beginPath(); ctx.arc(sg.last.x, sg.last.y, 1.2, 0, Math.PI * 2); ctx.fill(); // a tap leaves a dot
      sg.drawn = true; sgErr.hidden = true;
    });
    sgPad.addEventListener('pointermove', e => {
      if (!sg.drawing) return;
      const p = pt(e), ctx = sgPad.getContext('2d');
      ctx.beginPath(); ctx.moveTo(sg.last.x, sg.last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      sg.last = p;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => sgPad.addEventListener(t, () => { sg.drawing = false; }));
    $('dbSignClear').addEventListener('click', sizeSignPad);
    $('dbSignCancel').addEventListener('click', closeSign);
    sgBack.addEventListener('click', e => { if (e.target === sgBack) closeSign(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sgBack.hidden) closeSign(); });
    window.addEventListener('resize', () => { if (!sgBack.hidden && !sg.drawn) sizeSignPad(); });
    $('dbSignOk').addEventListener('click', saveSign);
  }
  // Shrink the signature to at most 400px wide, the same as the punch list page (keeps it well under the 100 KB limit)
  function signImage() {
    const w = Math.min(400, sgPad.width), h = Math.round(sgPad.height * w / sgPad.width);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(sgPad, 0, 0, w, h);
    return out.toDataURL('image/png');
  }
  async function saveSign() {
    const t = sg.task;
    if (!t) return;
    const name = sgName.value.replace(/\s+/g, ' ').trim();
    const err = !name ? 'Type your name.' : name.length > 60 ? 'Keep the name under 60 characters.' : !sg.drawn ? 'Sign in the box.' : '';
    if (err) { sgErr.textContent = err; sgErr.hidden = false; (name ? sgPad : sgName).focus({ preventScroll: true }); return; }
    const signature = signImage();
    if (signature.length >= 100000) { sgErr.textContent = 'That signature is too detailed. Tap Clear and sign again.'; sgErr.hidden = false; return; }
    try { localStorage.setItem(SIGNER_KEY, name); } catch (e) {}
    const ok = $('dbSignOk');
    ok.disabled = true;
    const now = new Date().toISOString();
    try {
      await db.doc('jobs/' + t.job.id + '/items/' + t.id).set({ done: true, doneAt: now, signedBy: name, signature, updatedAt: now }, { merge: true });
    } catch (ex) {
      console.error(ex);
      ok.disabled = false;
      sgErr.textContent = ex && ex.code === 'permission-denied' ? 'This item couldn’t be signed off. Check that you’re still in this workspace.' : 'Couldn’t save. Check your connection and try again.';
      sgErr.hidden = false;
      return;
    }
    ok.disabled = false;
    // Update the page right away: the item leaves Up next, and progress and activity count it
    const item = (t.job._items || []).find(i => i.id === t.id);
    if (item) { item.done = true; item.doneAt = Date.now(); item.signedBy = name; }
    t.job._last = Date.now();
    const c = listCounts(t.job);
    db.doc('jobs/' + t.job.id).set({ openCount: c.open, totalCount: c.total, updatedAt: now }, { merge: true }).catch(e => console.error('Couldn’t update the list’s count:', e));
    t.job.openCount = c.open; t.job.totalCount = c.total;
    closeSign();
    link_();
    renderAll();
    toast('Signed off: ' + t.text);
  }

  // A link to where a punch list lives: its project's page, or the list itself when it isn't in a project
  function listLink(j) {
    const p = projOf(j);
    return p ? link(projUrl(p.id), null, projShort(p)) : link(listUrl(j.id), null, listShort(j));
  }

  function renderFeed(a) { fillFeed($('dbFeed'), a); }
  function fillFeed(ul, a) { // CHANGED: split out so the project dashboard can reuse it
    ul.textContent = '';
    if (!st.loaded && !a.events.length) { ul.appendChild(el('li', 'db-empty', 'Loading activity…')); return; }
    if (!a.events.length) { ul.appendChild(el('li', 'db-empty', a.focus ? 'Sign-offs, new items and lists for this project show up here as your team works.' : 'Sign-offs, new items, lists and projects show up here as your team works.')); return; }
    let day = '';
    a.events.forEach((e, idx) => {
      const d = dayLabel(e.t);
      if (d !== day) { day = d; ul.appendChild(el('li', 'db-day', d)); }
      const li = el('li', 'db-ev ev-' + e.kind);
      const nextE = a.events[idx + 1];
      if (!nextE || dayLabel(nextE.t) !== d) li.classList.add('is-last');
      const dot = el('span', 'dot');
      dot.innerHTML = { signed: ICON.check, added: ICON.plus, list: ICON.list, project: ICON.folder }[e.kind];
      const body = el('div');
      const p = el('p');
      const T = t => document.createTextNode(t);
      if (e.kind === 'signed') p.append(T(e.who + ' signed off “' + trim(e.what) + '” on '), listLink(e.job));
      else if (e.kind === 'added') p.append(T('“' + trim(e.what) + '” added to '), listLink(e.job));
      else if (e.kind === 'list') {
        const pr = projOf(e.job);
        if (pr) p.append(T(e.who + ' added the punch list ' + listShort(e.job) + ' to '), link(projUrl(pr.id), null, projShort(pr)));
        else p.append(T(e.who + ' started the punch list '), link(listUrl(e.job.id), null, listShort(e.job)));
      } else p.append(T(e.who + ' created the project '), link(projUrl(e.proj.id), null, projShort(e.proj)));
      const time = el('time', null, ago(e.t));
      time.dateTime = new Date(e.t).toISOString();
      body.append(p, time);
      li.append(dot, body);
      ul.appendChild(li);
    });
  }

  function tape(pct, done, label) {
    const t = el('div', 'db-tape' + (done ? ' is-done' : ''));
    t.setAttribute('role', 'progressbar');
    t.setAttribute('aria-valuemin', '0');
    t.setAttribute('aria-valuemax', '100');
    t.setAttribute('aria-valuenow', String(pct));
    if (label) t.setAttribute('aria-label', label);
    const i = el('i');
    i.style.setProperty('--p', pct);
    t.appendChild(i);
    return t;
  }
  const progressText = c => !c.lists ? 'No lists yet'
    : !c.total ? plural(c.lists, 'list') + ', no items yet'
    : (c.open ? plural(c.open, 'open item') + ' of ' + c.total : 'All ' + c.total + ' items signed off') + ' across ' + plural(c.lists, 'list');

  // ---------- Lists not in a project (on the dashboard) ----------
  function renderLoose(a) {
    // Lists made before projects existed (or whose project was removed): list them so they can be moved into one
    const box = $('dbLoose');
    box.textContent = '';
    const loose = st.loose;
    box.hidden = !loose.length;
    if (!loose.length) return;
    const h = el('div', 'db-panel-h');
    h.append(el('h3', null, 'Lists not in a project'));
    box.append(h, el('p', 'db-sub', st.perm.moveLists && a.projects.length ? 'Move each one into its project so its progress counts there.' : 'These lists aren’t part of a project yet.'));
    const ul = el('ul', 'db-loose');
    loose.forEach(j => {
      const c = listCounts(j);
      const li = el('li');
      const a1 = link(listUrl(j.id), 'db-loose-name');
      a1.append(el('b', null, listTitle(j)), el('span', null, c.total ? plural(c.open, 'open item') + ' of ' + c.total : 'No items yet'));
      li.appendChild(a1);
      if (st.perm.moveLists && a.projects.length) li.appendChild(moveSelect(j, a.projects));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
  $('projSearch').addEventListener('input', () => renderSide(analyze()));

  // The Open / Warranty / Closed buttons in the sidebar, each with how many projects it holds
  function renderStageBar(found) {
    document.querySelectorAll('#projStage [data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stage === st.stage)));
    const n = k => found.filter(x => stageOf(x.p) === k).length;
    $('stageOpenN').textContent = n('open');
    $('stageWarrantyN').textContent = n('warranty');
    $('stageClosedN').textContent = n('closed');
  }
  $('projStage').addEventListener('click', e => {
    const b = e.target.closest('[data-stage]');
    if (!b) return;
    st.stage = b.dataset.stage;
    try { sessionStorage.setItem('hh-proj-stage', st.stage); } catch (ex) {}
    renderAll();
  });

  // ADDED: move a project to another stage (editors). Opening the project's stage keeps My projects on that stage
  async function setStage(p, k, btn) {
    if (!st.perm.manageProjects || stageOf(p) === k) return;
    const from = stageOf(p);
    btn.disabled = true;
    try {
      await db.doc('projects/' + p.id).update({ status: k, updatedAt: new Date().toISOString() });
      p.status = k;
      st.stage = k;
      try { sessionStorage.setItem('hh-proj-stage', k); } catch (ex) {}
      renderAll();
      toast(projName(p) + ' moved from ' + stageName(from) + ' to ' + stageName(k) + '.', k);
    } catch (ex) {
      console.error(ex);
      btn.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to change projects. Ask an admin.' : 'Couldn’t change the stage. Check your connection.');
    }
  }

  // ADDED: archive a project (editors). The project and its lists are hidden everywhere and filed under
  // Settings > Archive, where they can be unarchived or deleted. Nothing is deleted. Each list is stamped
  // archivedWithProject = the project, so Settings restores (or deletes) them together with it.
  async function archiveProject(p, btn) {
    if (!st.perm.manageProjects) { toast('You don’t have access to archive projects. Ask an admin.'); return; }
    const lists = (p._lists || []).slice();
    const n = lists.length;
    if (!confirm('Archive “' + projName(p) + '”' + (n ? ' and its ' + plural(n, 'list') : '') + '?\n\n'
      + 'It moves to Settings, under Archive, where you can unarchive it or delete it for good.')) return;
    if (navigator.onLine === false) { toast('You’re offline. Connect to the internet to archive.'); return; }
    btn.disabled = true;
    const now = new Date().toISOString();
    try {
      for (let i = 0; i < lists.length; i += 400) { // Firestore allows 500 writes per batch; stay under it
        const b = db.batch();
        lists.slice(i, i + 400).forEach(j => b.set(db.doc('jobs/' + j.id), { archived: true, archivedAt: now, archivedWith: '', archivedWithProject: p.id }, { merge: true }));
        await b.commit();
      }
      await db.doc('projects/' + p.id).update({ archived: true, archivedAt: now, updatedAt: now });
    } catch (ex) {
      console.error(ex);
      btn.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to archive projects. Ask an admin.' : 'Couldn’t archive the project. Check your connection.');
      return;
    }
    const ids = new Set(lists.map(j => j.id));
    st.jobs = st.jobs.filter(j => !ids.has(j.id));
    st.projects = st.projects.filter(x => x.id !== p.id);
    if (st.focus === p.id) { st.focus = ''; try { sessionStorage.removeItem('hh-focus'); } catch (e) {} }
    link_();
    location.hash = '#dashboard';
    renderAll();
    toast('Archived “' + projName(p) + '”. Find it in Settings, under Archive.');
  }

  // ================= ADDED: ADD / REMOVE LISTS AND FOLDERS FROM A PROJECT =================
  // A list is in a project when jobs/{id}.projectId is set. A folder is in a project when its entry in settings/app > folders
  // has projectId (the same thing the All Lists page does): every list in that folder, and in the folders inside it, joins too.
  // Removing only clears projectId. Nothing is deleted, and lists stay in their folders.
  const liveFolders = () => Object.entries(st.folders || {}).filter(([, f]) => f && !f.archived);
  const parentOfF = fid => { const f = st.folders[fid], q = f && f.parentId; return q && st.folders[q] && !st.folders[q].archived && q !== fid ? q : ''; };
  const folderName = fid => (st.folders[fid] && st.folders[fid].name) || 'Untitled folder';
  function folderPathD(fid) {
    const names = [];
    for (let f = fid, n = 0; f && st.folders[f] && n < 100; f = parentOfF(f), n++) names.unshift(folderName(f));
    return names.join(' / ');
  }
  function projectOfFolderD(fid) { // the project a folder is in: its own, or else the nearest folder above it that has one
    for (let f = fid, n = 0; f && st.folders[f] && n < 100; f = parentOfF(f), n++) {
      const pid = st.folders[f].projectId;
      if (pid && st.projects.some(x => x.id === pid)) return pid;
    }
    return '';
  }
  function folderTree(fid) { // this folder and every folder inside it
    const out = [fid];
    for (let i = 0; i < out.length && out.length < 500; i++) liveFolders().forEach(([id, f]) => { if (f.parentId === out[i] && !out.includes(id)) out.push(id); });
    return out;
  }
  const canMoveLists = () => !!st.perm.moveLists;
  const canMoveFolders = () => !!st.perm.moveLists && !!st.perm.manageLists; // folders are saved with the shared settings, which editors can change
  const settingsRef = () => db.doc('workspaces/' + st.wid + '/settings/app');
  const folderField = (fid, key) => new firebase.firestore.FieldPath('folders', fid, key);
  const noAccess = () => toast('You don’t have access to do that. Ask an admin.');
  async function commitAll(ops) { // batches hold up to 500 writes; stay well under
    for (let i = 0; i < ops.length; i += 400) {
      const b = db.batch();
      ops.slice(i, i + 400).forEach(f => f(b));
      await b.commit();
    }
  }
  const jobWrite = (id, pid, now) => b => b.set(db.doc('jobs/' + id), { projectId: pid, updatedAt: now }, { merge: true });

  async function addListToProject(j, p, ctl) {
    if (!canMoveLists()) return noAccess();
    ctl.disabled = true;
    try {
      await db.doc('jobs/' + j.id).set({ projectId: p.id, updatedAt: new Date().toISOString() }, { merge: true });
      j.projectId = p.id;
      link_(); renderAll();
      toast(listTitle(j) + ' added to ' + projName(p) + '.');
    } catch (ex) {
      console.error(ex); ctl.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to move lists into projects. Ask an admin.' : 'Couldn’t add it. Check your connection.');
    }
  }
  async function removeListFromProject(j, p, ctl) {
    if (!canMoveLists()) return noAccess();
    if (j.folderId && projectOfFolderD(j.folderId) === p.id) {
      toast('“' + listTitle(j) + '” is in the folder “' + folderPathD(j.folderId) + '”, which is part of this project. Remove that folder from the project, or move the list out of the folder first.');
      return;
    }
    ctl.disabled = true;
    try {
      await db.doc('jobs/' + j.id).set({ projectId: '', updatedAt: new Date().toISOString() }, { merge: true });
      j.projectId = '';
      link_(); renderAll();
      toast(listTitle(j) + ' removed from ' + projName(p) + '. It’s still in All Lists.');
    } catch (ex) {
      console.error(ex); ctl.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to move lists out of projects. Ask an admin.' : 'Couldn’t remove it. Check your connection.');
    }
  }
  async function addFolderToProject(fid, p, ctl) {
    if (!canMoveFolders()) return noAccess();
    ctl.disabled = true;
    const now = new Date().toISOString();
    const tree = folderTree(fid);
    const joining = st.jobs.filter(j => tree.includes(j.folderId) && !projOf(j)); // lists already in another project keep it
    try {
      await commitAll([b => b.update(settingsRef(), folderField(fid, 'projectId'), p.id), ...joining.map(j => jobWrite(j.id, p.id, now))]);
      st.folders[fid] = Object.assign({}, st.folders[fid], { projectId: p.id });
      joining.forEach(j => { j.projectId = p.id; });
      link_(); renderAll();
      toast('“' + folderName(fid) + '” added to ' + projName(p) + (joining.length ? ', with ' + plural(joining.length, 'list') + '.' : '.'));
    } catch (ex) {
      console.error(ex); ctl.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to add folders to projects. Ask an admin.' : 'Couldn’t add the folder. Check your connection.');
    }
  }
  async function removeFolderFromProject(fid, p, ctl) {
    if (!canMoveFolders()) return noAccess();
    ctl.disabled = true;
    const now = new Date().toISOString();
    const tree = folderTree(fid);
    const ownFolders = tree.filter(id => st.folders[id] && st.folders[id].projectId === p.id);
    const leaving = st.jobs.filter(j => tree.includes(j.folderId) && j.projectId === p.id);
    try {
      await commitAll([
        ...ownFolders.map(id => b => b.update(settingsRef(), folderField(id, 'projectId'), firebase.firestore.FieldValue.delete())),
        ...leaving.map(j => jobWrite(j.id, '', now))
      ]);
      ownFolders.forEach(id => { const f = Object.assign({}, st.folders[id]); delete f.projectId; st.folders[id] = f; });
      leaving.forEach(j => { j.projectId = ''; });
      link_(); renderAll();
      toast('“' + folderName(fid) + '” removed from ' + projName(p) + '. Its lists are still in All Lists.');
    } catch (ex) {
      console.error(ex); ctl.disabled = false;
      toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to remove folders from projects. Ask an admin.' : 'Couldn’t remove the folder. Check your connection.');
    }
  }

  // The "Folders and lists in this project" box on a project's lists tab
  function manageBox(p) {
    const mvL = canMoveLists(), mvF = canMoveFolders();
    if (!mvL && !mvF) return null;
    const box = el('section', 'db-manage db-glass');
    box.setAttribute('aria-label', 'Add or remove lists and folders');
    box.appendChild(el('h3', null, 'Lists and folders'));
    // Folders in this project (top ones only; a folder inside one of them goes with it)
    const mine = liveFolders().filter(([id, f]) => f.projectId === p.id && !(parentOfF(id) && projectOfFolderD(parentOfF(id)) === p.id))
      .sort((a, b) => folderPathD(a[0]).localeCompare(folderPathD(b[0])));
    if (mine.length) {
      const ul = el('ul', 'db-manage-list');
      mine.forEach(([id]) => {
        const li = el('li');
        const n = st.jobs.filter(j => folderTree(id).includes(j.folderId) && j.projectId === p.id).length;
        li.append(el('span', null, folderPathD(id) + ' · ' + plural(n, 'list')));
        if (mvF) {
          const b = el('button', 'db-btn', 'Remove from project');
          b.type = 'button';
          b.setAttribute('aria-label', 'Remove the folder ' + folderName(id) + ' from this project');
          b.addEventListener('click', () => removeFolderFromProject(id, p, b));
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    const row = el('div', 'db-manage-add');
    const pick = (label, items, onPick) => {
      const wrap = el('div', 'db-select db-move');
      const sel = el('select');
      sel.setAttribute('aria-label', label);
      sel.appendChild(new Option(label, ''));
      items.forEach(([v, t]) => sel.appendChild(new Option(t, v)));
      sel.addEventListener('change', () => { if (sel.value) onPick(sel.value, sel); });
      wrap.appendChild(sel);
      return wrap;
    };
    if (mvL) {
      const loose = st.loose.slice().sort((a, b) => listTitle(a).localeCompare(listTitle(b)));
      row.appendChild(loose.length ? pick('Add a punch list…', loose.map(j => [j.id, listTitle(j)]), (id, sel) => addListToProject(loose.find(j => j.id === id), p, sel))
        : el('p', 'db-sub', 'Every punch list is already in a project.'));
    }
    if (mvF) {
      const free = liveFolders().filter(([id]) => !projectOfFolderD(id)).sort((a, b) => folderPathD(a[0]).localeCompare(folderPathD(b[0])));
      if (free.length) row.appendChild(pick('Add a folder…', free.map(([id]) => [id, folderPathD(id)]), (id, sel) => addFolderToProject(id, p, sel)));
    }
    box.appendChild(row);
    return box;
  }

  function moveSelect(j, projects) {
    const wrap = el('div', 'db-select db-move');
    const sel = el('select');
    sel.setAttribute('aria-label', 'Move ' + listTitle(j) + ' to a project');
    sel.appendChild(new Option('Move to project…', ''));
    projects.forEach(x => sel.appendChild(new Option(projName(x.p), x.p.id)));
    sel.addEventListener('change', async () => {
      const pid = sel.value;
      if (!pid) return;
      sel.disabled = true;
      try {
        await db.doc('jobs/' + j.id).set({ projectId: pid, updatedAt: new Date().toISOString() }, { merge: true });
        j.projectId = pid;
        link_();
        renderAll();
        toast(listTitle(j) + ' moved to ' + projName(projOf(j)) + '.');
      } catch (ex) {
        console.error(ex);
        sel.value = '';
        sel.disabled = false;
        toast(ex && ex.code === 'permission-denied' ? 'You don’t have access to move lists into projects. Ask an admin.' : 'Couldn’t move it. Check your connection.');
      }
    });
    wrap.appendChild(sel);
    return wrap;
  }

  // Timeline: start and target dates, and each phase marked done / in progress / upcoming
  function timelineBox(p) {
    const phases = Array.isArray(p.phases) ? p.phases.filter(x => x && x.name) : [];
    if (!p.startDate && !p.endDate && !phases.length) return null;
    const box = el('section', 'db-timeline db-glass');
    box.appendChild(el('h3', null, 'Timeline'));
    const dl = el('dl', 'db-dl');
    dl.style.margin = '0 0 ' + (phases.length ? '14px' : '0');
    let remain = '';
    const end = parseDay(p.endDate);
    if (end) {
      const days = Math.ceil((end - new Date()) / DAY);
      remain = days > 0 ? plural(days, 'day') + ' left' : days === 0 ? 'Due today' : plural(-days, 'day') + ' past target';
    }
    [['Start', fmtDay(p.startDate)], ['Target completion', fmtDay(p.endDate)], ['Time left', remain || '—']]
      .forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); dl.appendChild(d); });
    box.appendChild(dl);
    if (phases.length) {
      const ol = el('ol', 'db-phases');
      const today = new Date();
      phases.forEach(ph => {
        const s = parseDay(ph.start), e = parseDay(ph.end);
        const li = el('li');
        let state = '';
        if (e && e < today) li.classList.add('is-past');
        else if (s && s <= today && (!e || e >= today)) { li.classList.add('is-now'); state = 'In progress'; }
        const dates = [fmtShort(ph.start), fmtShort(ph.end)].filter(Boolean).join(' – ');
        li.append(el('b', null, ph.name), el('span', null, dates || 'No dates'));
        if (state) li.appendChild(el('em', null, state));
        ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    return box;
  }

  // One project's page: details and overall progress, timeline, then tabs for Lists and Daily logs
  // ---------- the Add menu on a project's page ----------
  // List works now; the rest are listed so people can see what is coming, and are marked Soon.
  function projectAddMenu(newListUrl) {
    const wrap = el('div', 'db-add db-add--proj');
    const btn = el('button', 'db-add-btn db-add-btn--label');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    btn.appendChild(el('span', null, 'Add'));
    const menu = el('div', 'db-add-menu db-add-menu--end');
    menu.setAttribute('role', 'menu');
    const first = link(newListUrl, null, 'List');
    first.setAttribute('role', 'menuitem');
    menu.appendChild(first);
    ['Daily log', 'Schedule event', 'Selection', 'File', 'Message'].forEach(label => {
      const item = el('span', 'db-add-soon');
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-disabled', 'true');
      item.append(document.createTextNode(label + ' '), el('span', 'soon', 'Soon'));
      menu.appendChild(item);
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const on = !menu.classList.contains('is-open');
      closeAddMenus();
      menu.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', String(on));
    });
    menu.addEventListener('click', closeAddMenus);
    wrap.append(btn, menu);
    return wrap;
  }
  function closeAddMenus() {
    document.querySelectorAll('.db-add--proj .db-add-menu.is-open').forEach(m => {
      m.classList.remove('is-open');
      m.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }
  // Listeners are added once here (the project page is redrawn often, so they must not be added per draw)
  document.addEventListener('click', closeAddMenus);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddMenus(); });

  // ---------- ADDED: a project's own dashboard (index.html#projects/<id>) ----------
  // Same three questions as the main dashboard, but for one project: what needs attention, what happened lately,
  // what is on this week. "Show project details" goes to the full project page (#projects/<id>/details).
  function renderProjectDash(id) {
    const box = $('projDash');
    box.textContent = '';
    box.appendChild(link('#dashboard', 'db-back', '‹ Dashboard'));
    const p = st.projects.find(x => x.id === id);
    if (!p) { box.appendChild(el('p', 'db-empty', st.loaded ? 'That project was not found. It may have been deleted.' : 'Loading…')); return; }

    // Reuse analyze() for this one project: it already works out recent activity and the numbers
    const prev = st.focus; st.focus = p.id;
    let a; try { a = analyze(); } finally { st.focus = prev; }
    const c = projCounts(p);
    const detailsUrl = projUrl(p.id) + '/details';

    // Headline + the details button
    const h = el('h1', 'db-brief');
    const nm = projName(p);
    if (!c.lists) h.textContent = nm + ' has no lists yet.';
    else if (!st.loaded) h.textContent = 'Checking ' + nm + '…';
    else if (!c.open) h.textContent = 'Every list item on ' + nm + ' is signed off.';
    else h.textContent = plural(c.open, 'item') + (c.open === 1 ? ' is' : ' are') + ' still open on ' + nm + (c.open <= NEARLY_DONE ? ', so it is almost done.' : '.');
    const head = el('div', 'db-pd-head');
    head.append(h, link(detailsUrl, 'db-btn db-btn--main', 'Show project details'));
    box.appendChild(head);
    box.appendChild(el('p', 'db-sub', p.address || [p.lot && 'Lot ' + p.lot, p.community].filter(Boolean).join(', ') || 'No address yet'));
    const prog = el('div', 'db-pd-prog db-glass');
    prog.append(tape(c.pct, c.total > 0 && c.open === 0, nm + ' progress'), el('span', null, progressText(c)));
    box.appendChild(prog);

    // Needs your attention: worked out from this project's own data
    const att = el('section', 'db-panel db-glass db-attn');
    att.setAttribute('aria-label', 'Needs your attention');
    att.appendChild(el('div', 'db-panel-h')).appendChild(el('h2', null, 'Needs your attention'));
    const rows = [];
    if (st.loaded) {
      const open = [];
      (p._lists || []).forEach(j => (j._items || []).forEach(i => { if (!i.done) open.push({ ...i, job: j }); }));
      const mine = open.filter(t => t.assignedTo === st.user.uid);
      if (mine.length) rows.push([listUrl(mine[0].job.id), plural(mine.length, 'open item') + (mine.length === 1 ? ' is' : ' are') + ' assigned to you', mine.length === 1 ? '“' + trim(mine[0].text) + '”' : 'Starting with “' + trim(mine[0].text) + '”']);
      const oldest = open.filter(t => t.createdAt).sort((x, y) => x.createdAt - y.createdAt)[0];
      const days = oldest ? Math.floor((Date.now() - oldest.createdAt) / DAY) : 0;
      if (days >= 7) rows.push([listUrl(oldest.job.id), 'The longest-waiting item has been open ' + plural(days, 'day'), '“' + trim(oldest.text) + '” on ' + listShort(oldest.job)]);
      (p._lists || []).filter(j => listCounts(j).open >= LONG_LIST).forEach(j => rows.push([listUrl(j.id), listShort(j) + ' is a long list', plural(listCounts(j).open, 'item') + ' still open']));
      const quiet = p._last ? Math.floor((Date.now() - p._last) / DAY) : 0;
      if (c.open && quiet >= QUIET_DAYS) rows.push([null, 'This project has gone quiet', 'No activity for ' + plural(quiet, 'day')]);
    }
    if (rows.length) {
      const ul = el('ul', 'db-att-list');
      rows.forEach(([href, title, sub]) => {
        const li = el('li');
        const row = href ? link(href, 'db-att-row') : el('div', 'db-att-row');
        row.append(el('b', null, title), el('span', null, sub));
        li.appendChild(row);
        ul.appendChild(li);
      });
      att.appendChild(ul);
    } else att.appendChild(el('p', 'db-empty', st.loaded ? 'Nothing needs your attention on this project right now.' : 'Checking…'));
    box.appendChild(att);

    // Recent activity + this week
    const cols = el('div', 'db-cols');
    const act = el('section', 'db-panel db-glass');
    act.setAttribute('aria-label', 'Recent activity');
    act.appendChild(el('div', 'db-panel-h')).appendChild(el('h2', null, 'Recent activity'));
    const feed = el('ul', 'db-feed');
    fillFeed(feed, a);
    act.appendChild(feed);
    const wk = el('section', 'db-panel db-glass');
    wk.setAttribute('aria-label', 'This week');
    const wkH = el('div', 'db-panel-h');
    wkH.append(el('h2', null, 'This week'), el('span', 'db-pill', 'Coming soon'));
    wk.appendChild(wkH);
    wk.appendChild(weekStrip());
    wk.appendChild(el('p', 'db-empty', 'Scheduling is coming soon. Trade visits and milestones for this project will show here.'));
    cols.append(act, wk);
    box.appendChild(cols);
  }

  // Monday to Sunday of the current week, today marked. Ready for schedule entries once scheduling exists.
  function weekStrip() {
    const wrap = el('div', 'db-week');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const cell = el('div', 'db-wd' + (d.getTime() === today.getTime() ? ' is-today' : ''));
      if (d.getTime() === today.getTime()) cell.setAttribute('aria-current', 'date');
      cell.append(el('span', null, d.toLocaleDateString(undefined, { weekday: 'short' })), el('b', null, String(d.getDate())));
      wrap.appendChild(cell);
    }
    return wrap;
  }

  function renderDetail(id) {
    const box = $('projDetail');
    box.textContent = '';
    const p = st.projects.find(x => x.id === id);
    box.appendChild(link(p ? projUrl(p.id) : '#dashboard', 'db-back', p ? '‹ Project dashboard' : '‹ Dashboard')); // CHANGED: back goes to the project's own dashboard
    if (!p) { box.appendChild(el('p', 'db-empty', st.loaded ? 'That project was not found. It may have been deleted.' : 'Loading…')); return; }
    const c = projCounts(p);
    const newList = 'allLists.html?new=1&project=' + encodeURIComponent(p.id);

    const top = el('div', 'db-detail-top db-glass');
    const head = el('div');
    head.append(el('h2', null, projName(p)), el('p', 'db-sub', p.address || 'No address yet'));
    top.appendChild(head);
    const actions = el('div', 'db-detail-actions');
    // CHANGED: the "New punch list" button is now an Add menu (punch list, daily log, schedule event, selection, file, message)
    if (st.perm.manageLists) actions.appendChild(projectAddMenu(newList));
    // FIXED: the Client information button is back. It opens project-clients.html for this project (view-only unless you can edit projects)
    actions.appendChild(link('project-clients.html?project=' + encodeURIComponent(p.id), 'db-btn', 'Client information'));
    if (st.perm.manageProjects) actions.appendChild(link('new-project.html?edit=' + encodeURIComponent(p.id), 'db-btn', 'Edit project'));
    // MOVED: "Delete project" is now at the bottom of the page, next to "Archive project"
    if (actions.children.length) top.appendChild(actions);
    const dl = el('dl', 'db-dl');
    [['Lot', p.lot || '—'], ['Community', p.community || '—'], ['Project date', fmtDay(p.date)],
     ['Progress', c.total ? (c.total - c.open) + ' of ' + c.total + ' items (' + c.pct + '%)' : '—'],
     ['Lists', String(c.lists)], ['Created by', memberName(p.ownerId)]]
      .forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); dl.appendChild(d); });
    top.append(tape(c.pct, c.total > 0 && c.open === 0, 'Project progress across all lists'), dl);
    // ADDED: the project's stage. People who can edit projects move it along (Open → Warranty → Closed, or back); everyone else just sees it
    const stageRow = el('div', 'db-stage-row');
    stageRow.appendChild(el('span', null, 'Stage'));
    if (st.perm.manageProjects) {
      const seg = el('div', 'db-tabs db-stage db-stage--inline');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Project stage');
      STAGES.forEach(([k, label]) => {
        const b = el('button', null, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(stageOf(p) === k));
        b.addEventListener('click', () => setStage(p, k, b));
        seg.appendChild(b);
      });
      stageRow.appendChild(seg);
    } else stageRow.appendChild(el('b', 'db-tag is-' + stageOf(p), stageName(stageOf(p))));
    top.appendChild(stageRow);
    if (p.description) { const n = el('p', 'db-sub', p.description); n.style.gridColumn = '1 / -1'; top.appendChild(n); }
    box.appendChild(top);
    const tl = timelineBox(p);
    if (tl) box.appendChild(tl);

    // Tabs
    const tabs = el('div', 'db-tabs db-glass');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Project sections');
    const panels = el('div');
    const mk = (key, label) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.id = 'tab-' + key;
      b.setAttribute('aria-controls', 'panel-' + key);
      tabs.appendChild(b);
      const pn = el('div');
      pn.id = 'panel-' + key;
      pn.setAttribute('role', 'tabpanel');
      pn.setAttribute('aria-labelledby', b.id);
      panels.appendChild(pn);
      return [b, pn];
    };
    // The project's features. Only lists are built so far; the others are placeholders.
    const [tLists, pLists] = mk('lists', 'Lists (' + c.lists + ')');
    const FEATURES = [
      ['logs', 'Daily logs', 'M8.5 8h7M8.5 12h7M8.5 16h4', 'Record weather, crew on site, deliveries and progress photos for this project each day.', '<rect x="5" y="3.5" width="14" height="17" rx="2"/>'],
      ['schedule', 'Schedule', 'M3.5 10h17M8 3v4M16 3v4', 'Plan this project’s phases and trade visits on one calendar, so everyone knows who’s on site and when.', '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/>'],
      ['selections', 'Selections', 'M13 6.5h7.5M3.5 17.5H11', 'Track the finishes, fixtures and colors the buyer picks for this project, and get approvals before work starts.', '<circle cx="8" cy="8" r="3.5"/><circle cx="16" cy="16" r="3.5"/>'],
      ['files', 'Files', '', 'Documents, images and uploads for this project.', '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'],
      ['messages', 'Messages', '', 'Talk with your crew, trades and buyers about this project in one place.', '<path d="M4 5.5h16v10H9l-5 4z"/>']
    ];
    const pairs = [[tLists, pLists, 'lists']];
    FEATURES.forEach(([key, label, extra, text, shapes]) => {
      const [b, pn] = mk(key, label);
      pairs.push([b, pn, key]);
      if (key === 'files') { pn.appendChild(filesDrop()); return; }
      const soon = el('div', 'db-soon db-glass');
      soon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + shapes + (extra ? '<path d="' + extra + '"/>' : '') + '</svg>';
      soon.append(el('span', 'db-pill', 'Coming soon'), el('h3', null, label), el('p', null, text));
      pn.appendChild(soon);
    });
    const select = which => {
      pairs.forEach(([b, pn, key]) => {
        const on = b === which;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        pn.hidden = !on;
        if (on) { st.tab = key; st.tabFor = p.id; } // stay on this tab when the page redraws
      });
    };
    pairs.forEach(([b]) => b.addEventListener('click', () => select(b)));
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = pairs.findIndex(x => x[0] === document.activeElement);
      if (i < 0) return;
      const to = pairs[(i + (e.key === 'ArrowRight' ? 1 : pairs.length - 1)) % pairs.length][0];
      select(to); to.focus();
    });

    // Lists tab: the project's folders (with the lists inside them), then lists that aren't in a folder.
    const inProjFolder = j => !!j.folderId && st.folders[j.folderId] && !st.folders[j.folderId].archived && projectOfFolderD(j.folderId) === p.id;
    const isTopProjFolder = id => st.folders[id].projectId === p.id && !(parentOfF(id) && projectOfFolderD(parentOfF(id)) === p.id);
    const projFolders = liveFolders().filter(([id]) => projectOfFolderD(id) === p.id)
      .sort((x, y) => folderName(x[0]).localeCompare(folderName(y[0])));
    const listRow = j => {
      const x = Object.assign({ j }, listCounts(j));
      const pct = x.total ? Math.round((x.total - x.open) / x.total * 100) : 0;
      const li = el('li');
      const aEl = link(listUrl(j.id), 'db-glass');
      aEl.append(el('b', null, listTitle(j)), el('span', 'num', x.total ? pct + '%' : '—'),
        tape(pct, x.total > 0 && x.open === 0, listTitle(j) + ' progress'),
        el('small', null, (x.total ? (x.open ? plural(x.open, 'open item') + ' of ' + x.total : 'All ' + x.total + ' signed off') : 'No items yet')
          + (j._last ? '. Last activity ' + ago(j._last) + '.' : '.')));
      li.appendChild(aEl);
      if (canMoveLists() && !inProjFolder(j)) { // a list in a project folder leaves with its folder
        const rm = el('button', 'db-btn db-rm', 'Remove from project');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + listTitle(j) + ' from this project');
        rm.addEventListener('click', () => removeListFromProject(j, p, rm));
        li.appendChild(rm);
      }
      return li;
    };
    const byOpen = (x, y) => (y.open > 0) - (x.open > 0) || y.j._last - x.j._last;
    const sortedLists = arr => arr.map(j => ({ j, ...listCounts(j) })).sort(byOpen).map(x => x.j);
    const folderBlock = fid => {
      const li = el('li', 'db-folder');
      const head = el('div', 'db-folder-h db-glass');
      const total = st.jobs.filter(j => folderTree(fid).includes(j.folderId) && j.projectId === p.id).length;
      head.append(el('b', null, folderName(fid)), el('small', null, plural(total, 'list')));
      if (isTopProjFolder(fid) && canMoveFolders()) {
        const rm = el('button', 'db-btn db-rm', 'Remove folder from project');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove the folder ' + folderName(fid) + ' from this project');
        rm.addEventListener('click', () => removeFolderFromProject(fid, p, rm));
        head.appendChild(rm);
      }
      li.appendChild(head);
      const inner = el('ul', 'db-lists db-folder-in');
      projFolders.filter(([id]) => parentOfF(id) === fid).forEach(([id]) => inner.appendChild(folderBlock(id)));
      sortedLists(p._lists.filter(j => j.folderId === fid)).forEach(j => inner.appendChild(listRow(j)));
      if (!inner.children.length) inner.appendChild(el('li', 'db-sub', 'No lists in this folder yet.'));
      li.appendChild(inner);
      return li;
    };
    const looseLists = p._lists.filter(j => !inProjFolder(j));
    if (!p._lists.length && !projFolders.length) {
      const empty = el('div', 'db-soon db-glass');
      empty.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.list.replace(/^<svg[^>]*>|<\/svg>$/g, '') + '</svg>';
      empty.append(el('h3', null, 'No lists yet'),
        el('p', null, st.perm.manageLists ? 'Add a list for each walk: pre-drywall, final, buyer orientation. Their progress adds up here.' : 'Lists for this project show up here once someone adds them.'));
      if (st.perm.manageLists) empty.appendChild(link(newList, 'db-btn db-btn--main', 'New list'));
      pLists.appendChild(empty);
    } else {
      const ul = el('ul', 'db-lists');
      projFolders.filter(([id]) => !parentOfF(id) || projectOfFolderD(parentOfF(id)) !== p.id)
        .forEach(([id]) => ul.appendChild(folderBlock(id)));
      sortedLists(looseLists).forEach(j => ul.appendChild(listRow(j)));
      pLists.appendChild(ul);
    }
    const mg = manageBox(p);
    if (mg) pLists.appendChild(mg);

    box.append(tabs, panels);
    const keep = st.tabFor === p.id ? pairs.find(x => x[2] === st.tab) : null;
    select(keep ? keep[0] : tLists);

    // ADDED: Archive and Delete, at the bottom of the project's page
    // CHANGED: shown to admins and members with "Edit, archive and delete projects"
    if (st.perm.manageProjects) {
      const foot = el('section', 'db-detail-foot db-glass');
      foot.setAttribute('aria-label', 'Archive this project');
      // CHANGED (data safety): no instant delete here any more. Archive first; delete for good from Settings > Archive.
      foot.appendChild(el('p', null, 'Archive hides this project and its lists. You can bring them back, or delete them for good, from Settings, under Archive.'));
      const acts = el('div', 'acts');
      {
        const arc = el('button', 'db-btn', 'Archive project');
        arc.type = 'button';
        arc.addEventListener('click', () => archiveProject(p, arc));
        acts.appendChild(arc);
      }
      foot.appendChild(acts);
      box.appendChild(foot);
    }
  }

  // ---------- Sections (from the address) ----------
  const VIEWS = ['dashboard', 'projects'];
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    let [view, sub, page] = h.split('/');
    if (!VIEWS.includes(view) || (view === 'projects' && !sub)) { sub = ''; page = ''; view = 'dashboard'; } // old links (#projects, #files...) land on the dashboard
    // CHANGED: #projects/<id> is the project's own dashboard; #projects/<id>/details is the full project page
    const showing = view === 'projects' ? (page === 'details' ? 'projects' : 'project') : view;
    ['dashboard', 'project', 'projects'].forEach(v => { const panel = document.getElementById('v-' + v); if (panel) { panel.hidden = v !== showing; panel.style.display = v === showing ? 'block' : 'none'; } });
    root.querySelectorAll('.db-nav a').forEach(a => a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    const dockHome = $('dbDockHome'); // ADDED: the bottom Home button is "current" while the dashboard is showing
    if (dockHome) view === 'dashboard' ? dockHome.setAttribute('aria-current', 'page') : dockHome.removeAttribute('aria-current');
    markSide();
    if (view === 'projects') page === 'details' ? renderDetail(sub) : renderProjectDash(sub);
  }
  let lastView = '';
  window.addEventListener('hashchange', () => {
    route();
    const h = location.hash.slice(1);
    const view = h.split('/')[0];
    const target = document.getElementById(h);
    if (target && !VIEWS.includes(view)) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (view !== lastView || h.includes('/')) window.scrollTo(0, 0);
    lastView = view;
  });

  // ---------- Weather: today's forecast next to the greeting ----------
  // Uses the browser's location (asked once, with a button) and Open-Meteo. The last place is remembered on this device.
  const WX_LOC = 'hh-wx-loc', WX_CACHE = 'hh-wx';
  const useF = /^en-(US|LR|MM)|^(my|lr)/i.test(navigator.language || 'en-US'); // Fahrenheit for US English
  function wxDesc(code) {
    if (code === 0) return ['Clear', 'sun'];
    if (code === 1) return ['Mostly clear', 'sun'];
    if (code === 2) return ['Partly cloudy', 'partly'];
    if (code === 3) return ['Cloudy', 'cloud'];
    if (code === 45 || code === 48) return ['Foggy', 'cloud'];
    if (code >= 51 && code <= 57) return ['Drizzle', 'rain'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['Rain', 'rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['Snow', 'snow'];
    if (code >= 95) return ['Thunderstorms', 'storm'];
    return ['', 'cloud'];
  }
  const WX_ICON = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
    partly: '<path d="M8.5 4.5v1.4M3.4 9.6h1.4M4.9 6l1 1M12.1 6l-1 1"/><path d="M5.6 12.4a3.6 3.6 0 1 1 6.3-3.3"/><path d="M8 19.5h9.2a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-.5A3.6 3.6 0 0 0 8 19.5z"/>',
    cloud: '<path d="M7 18.5h10.5a3.8 3.8 0 0 0 .3-7.6 5.4 5.4 0 0 0-10.4-.6A4.1 4.1 0 0 0 7 18.5z"/>',
    rain: '<path d="M7 15.5h10.5a3.8 3.8 0 0 0 .3-7.6 5.4 5.4 0 0 0-10.4-.6A4.1 4.1 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>',
    snow: '<path d="M7 15.5h10.5a3.8 3.8 0 0 0 .3-7.6 5.4 5.4 0 0 0-10.4-.6A4.1 4.1 0 0 0 7 15.5z"/><path d="M8.5 19.5h.01M12 20.5h.01M15.5 19.5h.01"/>',
    storm: '<path d="M7 15h10.5a3.8 3.8 0 0 0 .3-7.6 5.4 5.4 0 0 0-10.4-.6A4.1 4.1 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'
  };
  function showWeather(w) {
    const box = $('dbWeather');
    box.textContent = '';
    const [desc, icon] = wxDesc(w.code);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = WX_ICON[icon];
    const deg = n => Math.round(n) + '°';
    const text = el('span', 'wx-text');
    text.append(el('span', null, (desc || 'Today') + (w.rain != null ? ', ' + w.rain + '% chance of rain' : '')),
      el('span', null, 'High ' + deg(w.hi) + ', low ' + deg(w.lo)));
    box.append(svg, el('b', null, deg(w.now)), text);
    box.setAttribute('aria-label', 'Weather today: ' + deg(w.now) + ' now, ' + (desc || '').toLowerCase() + '. High ' + deg(w.hi) + ', low ' + deg(w.lo) + (w.rain != null ? ', ' + w.rain + ' percent chance of rain' : '') + '.');
  }
  async function fetchWeather(lat, lon) {
    try { const c = JSON.parse(sessionStorage.getItem(WX_CACHE) || 'null'); if (c && Date.now() - c.at < 30 * 6e4 && Math.abs(c.lat - lat) < .05 && Math.abs(c.lon - lon) < .05) return showWeather(c.w); } catch (e) {}
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3)
      + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto&forecast_days=1' + (useF ? '&temperature_unit=fahrenheit' : '');
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('weather ' + r.status);
      const d = await r.json();
      const w = {
        now: d.current.temperature_2m, code: d.current.weather_code,
        hi: d.daily.temperature_2m_max[0], lo: d.daily.temperature_2m_min[0],
        rain: d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[0] : null
      };
      try { sessionStorage.setItem(WX_CACHE, JSON.stringify({ at: Date.now(), lat, lon, w })); } catch (e) {}
      showWeather(w);
    } catch (e) { console.warn('Weather unavailable', e); $('dbWeather').textContent = ''; }
  }
  function askLocation() {
    const box = $('dbWeather');
    if (!navigator.geolocation) { box.textContent = ''; return; }
    box.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try { localStorage.setItem(WX_LOC, JSON.stringify({ lat, lon })); } catch (e) {}
      fetchWeather(lat, lon);
    }, () => {
      box.textContent = '';
      box.appendChild(el('span', null, 'Allow location in your browser to see today’s weather.'));
    }, { maximumAge: 30 * 6e4, timeout: 10000 });
  }
  function weatherButton() {
    const box = $('dbWeather');
    box.textContent = '';
    const b = el('button', 'db-btn', 'Show today’s weather');
    b.type = 'button';
    b.addEventListener('click', askLocation);
    box.appendChild(b);
  }
  async function startWeather() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WX_LOC) || 'null'); } catch (e) {}
    let state = '';
    try { if (navigator.permissions) state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) {}
    if (state === 'granted') askLocation();                // refresh the location quietly
    else if (saved) fetchWeather(saved.lat, saved.lon);    // last place we knew
    else if (state !== 'denied') weatherButton();          // ask only when they choose to
  }

  // ---------- Files tab (on each project's page): a placeholder drop zone until storage is built ----------
  function filesDrop() {
    const lab = el('label', 'db-drop');
    lab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
    const input = el('input');
    input.type = 'file'; input.accept = 'image/*';
    lab.append(el('b', null, 'Upload an image'), el('span', null, 'Drag a photo here or choose one. File storage is coming soon.'), input);
    const soon = () => toast('Uploading files is coming soon.');
    input.addEventListener('change', () => { if (input.files.length) soon(); input.value = ''; });
    ['dragenter', 'dragover'].forEach(t => lab.addEventListener(t, e => { e.preventDefault(); lab.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => lab.addEventListener(t, e => { e.preventDefault(); lab.classList.remove('is-over'); }));
    lab.addEventListener('drop', soon);
    return lab;
  }

  // ---------- Start ----------
  route();
  auth.onAuthStateChanged(user => {
    try { user ? localStorage.setItem('hh-signed-in', '1') : localStorage.removeItem('hh-signed-in'); } catch (e) {}
    if (!user) return; // guests see the marketing page
    startWeather();
    load(user).catch(ex => {
      console.error(ex);
      const b = $('dbBrief');
      b.classList.remove('is-loading');
      b.textContent = ex && ex.code === 'permission-denied'
        ? 'Your projects couldn’t load: permission denied. Republish the Firestore rules, then refresh.'
        : 'Your projects couldn’t load. Check your connection and refresh.';
    });
  });
})();
// ©HomeHub LLC 2026 //
// ================= CONSTANTS AND DEFAULTS =================

// Starting list of trades (the subcontractor types an item can be assigned to)
const DEFAULT_TRADES = [
  "Paint",
  "Silt Fence",
  "Excavation",
  "Concrete",
  "Damp Proofing",
  "Sewer & Water",
  "Flatwork",
  "Structural Steel",
  "Rough Material",
  "Truss where applicable",
  "Framing Labor",
  "Roofing",
  "Windows",
  "Doors",
  "Plumbing",
  "Plumbing Material (Fixtures and valves)",
  "Heating & Cooling",
  "Electric",
  "Fireplace",
  "Insulation",
  "Drywall",
  "Paint",
  "Carpeting & Hard Surfaces",
  "Wood Stairs",
  "Millwork",
  "Cabinets",
  "Counter Tops",
  "Trim Labor",
  "Appliance's",
  "Masonry",
  "Siding Material",
  "Siding Labor",
  "Garage Doors",
  "Gutters",
  "Irrigation",
  "Landscaping",
  "Shower Doors",
  "Mirrors",
  "Lighting",
  "Closet Shelving",
  "A/V",  
  "Cleaning",
  "Dumpsters",
  "POL",
  "Engineering",
  "Architecture",
  "Energy Documents & Testing", 
  "Soil Test",
  "Management Fee",
  "P/O",
  "Internal Commission",
  "Permits",
  "Misc/Utilities",
  "Insurance",
  "Marketing",
  "Hauling"
];
let TRADES = DEFAULT_TRADES.slice(); // working copy that the user can edit (slice() makes a copy)

// CHANGED: this used to be a list of 18 default rooms (Hallway, Master Bedroom, Kitchen, etc.).
// Now it's empty, so every new punch list starts with no rooms and the user adds their own.
// Leave the empty array in place: other code (allRooms, the remove-room handler) still refers to ROOMS, and an empty list works fine.
const ROOMS = [];
// "Floors" are the groupings (levels) that rooms are sorted under
const DEFAULT_FLOORS = [
  "Second Floor", 
  "First Floor", 
  "Exterior",
  "Basement",
  "Third Floor",
  "Fourth Floor", 
];
let FLOORS = DEFAULT_FLOORS.slice();
// If a room points at a level that was deleted, fall back to the first level
const floorOf = f => FLOORS.includes(f) ? f : FLOORS[0];
// The four sub-collections stored under each job in Firestore:
//   items  = per-item status (done, note, trade)
//   custom = the punch items themselves (text, room)
//   rooms  = renamed default rooms and user-added rooms
//   hidden = default rooms the user removed
const COLLS = [
  "items", 
  "custom", 
  "rooms", 
  "hidden"
];

// ================= STORAGE: Firestore when configured, otherwise this phone only =================
const cfg = window.FIREBASE_CONFIG || {}; // set by firebase-config.js
let fs = null; // fs = the Firestore database, or null if we're running in local-only mode
// Only connect if the Firebase library loaded AND a real API key was provided (not the "PASTE..." placeholder)
if (window.firebase && cfg.apiKey && !/PASTE/.test(cfg.apiKey)) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    fs = firebase.firestore();
    fs.enablePersistence({ 
      synchronizeTabs: true 
    }).catch(() => {});  // keeps working with weak jobsite signal
  } catch (e) { 
    fs = null; 
  } // if anything fails, quietly fall back to local-only mode
}
// ADDED: who is signed in. uid stays null until Firebase tells us (see BOOT at the bottom), and stays null for guests opening a shared link.
const authSvc = (fs && firebase.auth) ? firebase.auth() : null;
let uid = null;
let wid = null; // ADDED: the signed-in user's workspace. Lists, trades, levels and folders are shared by everyone in it.
// ADDED: editing permission. Only workspace admins (the owner plus anyone made an admin), and members an admin has given "Can edit lists" in Settings,
// can change a list (add/edit/remove rooms and items, job details, folders, trades, delete lists).
// Everyone else, including people who open a shared link, can only check items off. The Firestore rules enforce the same thing.
// Local-only mode (no Firebase) has nobody to ask, so everything is editable there.
let canEdit = !fs;
// ADDED: the finer permissions an admin gives each member (see firebase-starter/perms.js). canEdit above is "Create, edit and
// delete lists"; perm.addTodos lets someone add items without changing anything else, and perm.assignTasks lets them assign items.
let perm = fs ? {} : { createProjects: true, manageProjects: true, manageLists: true, moveLists: true, addTodos: true, assignTasks: true };
const canAdd = () => canEdit || !!perm.addTodos;
// ADDED: the workspace's people, for assigning items (empty for guests opening a shared link)
let members = [];
const memberLabel = id => { const m = members.find(x => x.id === id); return m ? (m.displayName || m.email || "Someone") : ""; };
// Call before any editing action: returns true if allowed, otherwise shows a message and returns false
function needEdit() {
  if (canEdit) return true;
  toast("You can check items off, but you don't have access to change this list. Ask an admin.");
  return false;
}
// Show or hide everything that edits, based on canEdit
function applyPerms() {
  document.documentElement.classList.toggle("can-edit", canEdit);
  document.querySelectorAll("#jobinfo input, #jobinfo textarea, #jobinfo select").forEach(el => { 
    el.disabled = !canEdit; 
  });
  const vo = document.getElementById("viewOnly");
  if (vo) vo.hidden = canEdit;
}
const settingsPath = () => "workspaces/" + wid + "/settings/app"; // shared by the whole workspace
// Local-only mode stores everything in the browser's localStorage under this key
const LS = "punch-app-v1";
// Load previously saved local data (or start empty if none / if it's corrupted)
const local = (() => { 
  try { 
    return JSON.parse(localStorage.getItem(LS) || "{}"); 
  } 
  catch (e) { 
    return {}; 
} })();
local.jobs = local.jobs || {};
function lsSave() { 
  try { 
    localStorage.setItem(LS, JSON.stringify(local)); 
  } catch (e) 
  {} }

// ================= STATE =================
let jobId = null;      // id of the punch list currently open (null = on the home screen)
let state = blank();   // all data for the open punch list
function blank() { 
  return { 
    items: {}, 
    custom: {}, 
    rooms: {}, 
    hidden: {}, 
    meta: {} 
  }; } // meta = date/community/address/lot/description
// ui = temporary screen state that isn't saved to the database
//   show: status filter, trade: trade filter, open: which rooms are expanded,
//   edit: id of the item being edited, confirm: room awaiting remove-confirmation, editRoom: room being renamed
// ADDED to ui for folders: openFolders = which folders are expanded, renameFolder = folder being renamed, confirmFolder = folder awaiting delete-confirmation
const ui = { 
  show: "all", 
  trade: "", 
  open: {}, 
  edit: null, 
  confirm: null, 
  editRoom: null, 
  openFolders: {}, 
  renameFolder: null, 
  confirmFolder: null, 
  confirmJob: null, // ADDED: list waiting for "Delete this list?" confirmation on All Lists
  // REMOVED: archiveFolder (archiving moved from folders and lists to projects)
  who: "",     // ADDED: assignee filter: "" = anyone, "me", "none", or a member's uid
  assign: null, // ADDED: item whose "Assign to" picker is open
  due: null // ADDED: item whose "Due date" picker is open
};
let jobsList = {};     // all jobs, for the home screen
// ADDED: the sidebar's project list (same as the home page). projectData = every project's details, keyed by id.
// The Open / Warranty / Closed choice is shared with the home page through sessionStorage.
let projectData = {};
let sideJobs = {};      // the sidebar's own copy of the workspace's lists. jobsList can't be used: it stops updating (and may be empty) while a list is open.
let sideJobsStarted = false;
let sideSyncedFor = null; // the open list whose project's stage tab we already switched to
let sideCounts = {};   // jobId -> { key, open, total }: real item counts for lists in a project (the same way the home page counts them)
let sideBusy = false, sideAgain = false;
const SIDE_STAGES = ["open", "warranty", "closed"];
const stageOf = p => p.status === "warranty" || p.status === "closed" ? p.status : "open"; // projects made before stages existed count as Open
let sideStage = "open";
try { const k = sessionStorage.getItem("hh-proj-stage"); if (SIDE_STAGES.includes(k)) sideStage = k; } catch (e) {}
// ADDED: all folders, as { folderId: { name, createdAt } }. Folders are stored inside the same "settings/app" record as trades and levels
// (so no new Firebase permissions are needed). Each list remembers its folder with a folderId field on the list's own record.
let foldersList = {};
// ADDED: state of a list being dragged into a folder (declared here, not down in the drag section, because renderJobs() checks it during startup). See DRAG A LIST INTO A FOLDER below.
// drag = everything about the drag in progress: which list, the floating copy ("ghost"), where the pointer is, and what it is hovering over.
const drag = { 
  id: null, 
  el: null, 
  ghost: null, 
  timer: null, 
  active: false,
  type: "", 
  kind: "", // ADDED: "list" or "folder", whichever is being dragged
  startX: 0, startY: 0, lastX: 0, lastY: 0, offX: 0, offY: 0, 
  target: null, 
  rerender: false, 
  raf: 0 
};
let dragEndedAt = 0; // when the last drag ended, used to ignore the click that browsers fire after a drag
// ADDED: folders as [id, folder] pairs sorted A to Z by name
const sortedFolders = () => Object.entries(foldersList).filter(([, f]) => !f.archived).sort( // CHANGED: archived folders are hidden (they live in Settings > Archive)
  (a, b) => (a[1].name || "").localeCompare(b[1].name || "", undefined, { 
  sensitivity: "base" 
}));
// ADDED: folders inside folders. Each folder can have a parentId (the folder it sits in). No parentId, or a parent that was deleted, means it's at the top.
const parentOf = fid => { 
  const p = foldersList[fid] && foldersList[fid].parentId; 
  return p && foldersList[p] && !foldersList[p].archived && p !== fid ? p : ""; 
}; // CHANGED: a parent that is archived counts as missing
// The folders directly inside folder pid ("" = the top level), A to Z
const childFolders = pid => sortedFolders().filter(([id]) => parentOf(id) === pid);
// Is folder a the same as, or somewhere inside, folder b? Used so a folder can't be dropped into itself or into one of its own sub-folders.
function isInside(a, b) {
  for (let f = a, n = 0; 
    f && n < 100; 
    f = parentOf(f), n++) if (f === b) return true; // n stops a broken loop in old data
  return false;
}
// Full name of a folder, like "Oakwood / Phase 2", for the Folder dropdown
function folderPath(fid) {
  const names = [];
  for (let f = fid, n = 0; f && n < 100; f = parentOf(f), n++) names.unshift(foldersList[f].name);
  return names.join(" / ");
}

// ================= FOLDERS JOIN PROJECTS (ADDED) =================
// When a list that belongs to a project is in a folder, that folder joins the project: it remembers the project in
// foldersList[fid].projectId (saved with the other folder info in settings/app). From then on, every list in that folder
// (and in the folders inside it) that isn't in a project yet joins the same project, including new lists made with
// "New list here", so the whole folder shows on the project's page. A list that is already in a different project keeps it.
let projectNames = {};     // projectId -> project name, for the label on a folder
let projectsLoaded = false; // true once the workspace's projects have been read
let jobsLoaded = false;     // true once the home screen's lists have arrived from Firestore
// Read the workspace's projects (names only). Signed-in workspace members only; quietly skipped otherwise.
function loadProjects() {
  if (!fs || !uid || !wid) return;
  fs.collection("projects").where("workspaceId", "==", wid).get().then(snap => {
    projectNames = {};
    projectData = {};
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p.archived) projectData[d.id] = p;
      if (!p.archived) projectNames[d.id] = p.name || [p.lot && "Lot " + p.lot, p.community].filter(Boolean).join(" · ") || "Untitled project";
    });
    projectsLoaded = true;
    syncFolderProjects();
    renderJobs();
    refreshNewListChoices(); // ADDED: if the New punch list box is open, add the projects to it
    renderSide(); // ADDED: fill the sidebar's project picker
  }).catch(e => console.error("Couldn't load projects:", e));
}

console.info("HomeHub lists sidebar v22");
// ================= SIDEBAR (ADDED) =================
// The dashboard's left sidebar (markup in allLists.html). Shows the workspace, a project picker and the section links.
// Picking a project opens the dashboard focused on it, the same as picking it on the dashboard.
let wsInfo = null; // the workspace's name and logo
function loadWorkspace() {
  if (!fs || !uid || !wid) return;
  fs.doc("workspaces/" + wid).get().then(w => { wsInfo = w.exists ? w.data() : {}; renderSide(); })
    .catch(e => console.error("Couldn't load the workspace:", e));
}
function renderSide() {
  const nameEl = document.getElementById("dbWsName");
  if (!nameEl) return;
  if (wsInfo) {
    const name = wsInfo.name || "Workspace";
    nameEl.textContent = name;
    const box = document.getElementById("dbWsLogo");
    box.textContent = "";
    if (wsInfo.logo) { 
      const img = new Image(); 
      img.alt = ""; 
      img.src = wsInfo.logo; 
      box.appendChild(img); 
    }
    else box.textContent = name.trim().charAt(0).toUpperCase();
  }
  renderProjectSide();
  document.getElementById("dbNewProj").hidden = !perm.createProjects; // CHANGED: needs "Create projects"
}
// ADDED: the sidebar's project list, the same as the home page: Open / Warranty / Closed buttons (with counts), a search box,
// then each project with its address and a progress bar. Each project opens its own page on the home screen.
// Count each project's items from the items themselves, like the home page does. The numbers saved on a list can be missing or old,
// which left the bars empty. Only lists that changed since the last count are read again (at most 60, most recent first).
const sideKey = j => [j.updatedAt, j.openCount, j.totalCount].join("|");
// The sidebar's own live feed of the workspace's lists. It keeps running when a list is open (the main feed stops), and each change
// to a list (say an item ticked off) updates the project's bar.
function startSideJobs() {
  if (!fs || !uid || !wid || sideJobsStarted) return;
  sideJobsStarted = true;
  fs.collection("jobs").where("workspaceId", "==", wid).onSnapshot(snap => {
    sideJobs = {};
    snap.docs.forEach(d => { sideJobs[d.id] = d.data(); });
    try { renderProjectSide(); } catch (e) { console.error("Couldn't draw the sidebar projects:", e); }
    loadSideCounts().catch(e => console.error("Sidebar counts failed:", e));
  }, e => { sideJobsStarted = false; console.error("Couldn't load lists for the sidebar:", e); });
}
async function loadSideCounts() {
  if (!fs || !sideJobsStarted) return;
  if (sideBusy) { sideAgain = true; return; }
  sideBusy = true;
  try {
    const todo = Object.entries(sideJobs).filter(([, j]) => !j.archived && j.projectId)
      .sort((a, b) => sideMs(b[1].updatedAt || b[1].createdAt) - sideMs(a[1].updatedAt || a[1].createdAt)).slice(0, 60)
      .filter(([id, j]) => !sideCounts[id] || sideCounts[id].key !== sideKey(j));
    if (todo.length) {
      await Promise.all(todo.map(async ([id, j]) => {
        try {
          const get = c => fs.collection("jobs/" + id + "/" + c).get().then(sn => Object.fromEntries(sn.docs.map(d => [d.id, d.data()])));
          const [custom, items, hidden] = await Promise.all([get("custom"), get("items"), get("hidden")]);
          const live = Object.entries(custom).filter(([, c]) => c && c.text && !(hidden[c.room] && hidden[c.room].hidden));
          sideCounts[id] = { key: sideKey(j), total: live.length, open: live.filter(([cid]) => !(items[cid] && items[cid].done)).length };
        } catch (e) { console.error("Couldn't count the items on list " + id, e); }
      }));
      renderProjectSide();
    }
  } finally {
    sideBusy = false;
    if (sideAgain) { sideAgain = false; loadSideCounts(); }
  }
}
const sideMs = v => !v ? 0 : typeof v === "string" ? (Date.parse(v) || 0) : v.toMillis ? v.toMillis() : v.toDate ? +v.toDate() : +v || 0;
function renderProjectSide() {
  const ul = document.getElementById("dbSideProjects");
  if (!ul) return;
  const q = (document.getElementById("projSearch").value || "").trim().toLowerCase();
  // The project of the list that is open (if any). Its sidebar entry is highlighted, like the project page you are on at home.
  const curPid = jobId && sideJobs[jobId] && projectData[sideJobs[jobId].projectId] ? sideJobs[jobId].projectId : "";
  if (curPid && sideSyncedFor !== jobId) { // show the stage tab that holds it, once per list, so the highlight is visible
    sideSyncedFor = jobId;
    sideStage = stageOf(projectData[curPid]);
    try { sessionStorage.setItem("hh-proj-stage", sideStage); } catch (ex) {}
  }
  const rows = Object.keys(projectData).map(id => {
    const p = projectData[id];
    const lists = Object.entries(sideJobs).filter(([, j]) => !j.archived && j.projectId === id).map(([jid, j]) => Object.assign({}, j, { id: jid }));
    let open = 0, total = 0;
    lists.forEach(j => {
      const c = sideCounts[j.id] || {}; // the real count if we have it, else the counts saved on the list
      open += typeof c.open === "number" ? c.open : (j.openCount || 0);
      total += typeof c.total === "number" ? c.total : (j.totalCount || 0);
    });
    const listNames = lists.map(j => j.name || [j.lot && "Lot " + j.lot, j.community].filter(Boolean).join(" "));
    // most recently touched first, like the home page (the project itself or any of its lists)
    const last = Math.max(sideMs(p.updatedAt), sideMs(p.createdAt), ...lists.map(j => Math.max(sideMs(j.updatedAt), sideMs(j.createdAt))));
    return { id, p, open, total, last, pct: total ? Math.round((total - open) / total * 100) : 0, listNames };
  }).sort((a, b) => b.last - a.last);
  // Search by name, lot, community, address or the name of one of its lists. The counts follow the search.
  const found = !q ? rows : rows.filter(x => [projectNames[x.id], x.p.address, x.p.community, x.p.lot, ...x.listNames].join(" ").toLowerCase().includes(q));
  document.querySelectorAll("#projStage [data-stage]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.stage === sideStage)));
  const n = k => found.filter(x => stageOf(x.p) === k).length;
  document.getElementById("stageOpenN").textContent = n("open");
  document.getElementById("stageWarrantyN").textContent = n("warranty");
  document.getElementById("stageClosedN").textContent = n("closed");
  ul.textContent = "";
  const list = found.filter(x => stageOf(x.p) === sideStage);
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "db-empty";
    const label = sideStage;
    li.textContent = !projectsLoaded ? "Loading projects…"
      : !rows.length ? (perm.createProjects ? "No projects yet. Use + to create one." : "No projects yet.")
      : q ? "No " + label + " projects match “" + q + "”." + (found.length ? " Try another tab." : "")
      : "No " + label + " projects.";
    ul.appendChild(li);
    return;
  }
  list.forEach(x => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "index.html#projects/" + encodeURIComponent(x.id);
    if (x.id === curPid) a.setAttribute("aria-current", "page");
    const b = document.createElement("b");
    b.textContent = projectNames[x.id];
    const addr = document.createElement("span");
    addr.className = "addr";
    addr.textContent = x.p.address || [x.p.lot && "Lot " + x.p.lot, x.p.community].filter(Boolean).join(", ") || "No address yet";
    const tape = document.createElement("div");
    tape.className = "db-tape" + (x.total > 0 && x.open === 0 ? " is-done" : "");
    tape.setAttribute("role", "progressbar");
    tape.setAttribute("aria-valuemin", "0");
    tape.setAttribute("aria-valuemax", "100");
    tape.setAttribute("aria-valuenow", String(x.pct));
    tape.setAttribute("aria-label", projectNames[x.id] + " progress");
    const bar = document.createElement("i");
    bar.style.setProperty("--p", x.pct);
    tape.appendChild(bar);
    a.append(b, addr, tape);
    li.appendChild(a);
    ul.appendChild(li);
  });
}
document.getElementById("projSearch").addEventListener("input", renderProjectSide);
document.getElementById("projStage").addEventListener("click", e => {
  const b = e.target.closest("[data-stage]");
  if (!b) return;
  sideStage = b.dataset.stage;
  try { sessionStorage.setItem("hh-proj-stage", sideStage); } catch (ex) {}
  renderProjectSide();
});
// ADDED: the + menu in the sidebar (same as the dashboard): New project, New list (asks for project and folder), New daily log (soon)
const navAddBtn = document.getElementById("dbAdd"), navAddMenu = document.getElementById("dbAddMenu");
function toggleNavAdd(open) {
  const on = open === undefined ? !navAddMenu.classList.contains("is-open") : open;
  navAddMenu.classList.toggle("is-open", on);
  navAddBtn.setAttribute("aria-expanded", String(on));
}
navAddBtn.addEventListener("click", e => { e.stopPropagation(); toggleNavAdd(); });
document.addEventListener("click", e => { if (!navAddMenu.contains(e.target)) toggleNavAdd(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") toggleNavAdd(false); });
navAddMenu.addEventListener("click", () => toggleNavAdd(false));
document.getElementById("dbAddList").addEventListener("click", e => { e.preventDefault(); openNewListDialog(); }); // no page reload: open the box right here
// Does this project still exist? (Before the projects have loaded, assume yes.)
const projectExists = pid => !!pid && (!projectsLoaded || !!projectNames[pid]);
// The project a folder belongs to: its own, or else the nearest folder above it that has one. "" = none.
function projectOfFolder(fid) {
  for (let f = fid, n = 0; f && foldersList[f] && n < 100; f = parentOf(f), n++) {
    if (projectExists(foldersList[f].projectId)) 
    return foldersList[f].projectId;
  }
  return "";
}
// Put one list in a project and save it
function setJobProject(id, pid) {
  jobsList[id] = Object.assign({}, jobsList[id], { 
    projectId: pid 
  });
  if (fs) fs.doc("jobs/" + id).set({ 
    projectId: pid, updatedAt: new Date().toISOString() 
  }, 
  { 
    merge: true 
  })
    .catch(e => console.error("Couldn't add the list to its folder's project:", e));
}
// Apply the rule to everything on the home screen. Safe to call any time; it only writes when something needs to change.
// Returns short messages describing what changed, so a move can mention it.
function syncFolderProjects() {
  const notes = [];
  if (!fs || !canEdit || !jobsLoaded) return notes;
  const rows = Object.entries(jobsList).filter(([, j]) => !j.archived && j.folderId && foldersList[j.folderId] && !foldersList[j.folderId].archived)
    .sort((a, b) => (a[1].createdAt || "").localeCompare(b[1].createdAt || "")); // oldest first, so the result doesn't depend on load order
  // 1. A folder with no project joins the project of a list inside it
  let foldersChanged = false;
  rows.forEach(([, j]) => {
    if (!projectExists(j.projectId) || projectOfFolder(j.folderId)) return;
    foldersList = Object.assign({}, foldersList, { 
      [j.folderId]: Object.assign({}, foldersList[j.folderId], { 
        projectId: j.projectId 
      }) });
    foldersChanged = true;
    notes.push(foldersList[j.folderId].name + " joined " + (projectNames[j.projectId] || "the list's project"));
  });
  if (foldersChanged) saveSettings();
  // 2. Lists in a project's folder that aren't in a project yet join it
  let added = 0, addedTo = "";
  rows.forEach(([id, j]) => {
    if (projectExists(j.projectId)) return;
    const pid = projectOfFolder(j.folderId);
    if (!pid) return;
    setJobProject(id, pid);
    added++; addedTo = projectNames[pid] || "the folder's project";
  });
  if (added) notes.push((added === 1 ? "1 list" : added + " lists") + " added to " + addedTo);
  return notes;
}
let unsubs = [];       // functions that stop live Firestore listeners

// Read saved UI preferences (which rooms were open, whether the tip was hidden)
function uiPrefs() { 
  try 
  { 
    return JSON.parse(localStorage.getItem(LS + "-ui") || "{}"); 
  } catch (e) 
  { return {}; 
} }
// Save those preferences, remembering expanded rooms separately for each job
function uiSave() { 
  try { 
    const p = uiPrefs(); p.open = p.open || {}; 
    if (jobId) p.open[jobId] = ui.open; p.openFolders = ui.openFolders; /* ADDED: remember which folders were expanded */ 
    p.tipHidden = document.getElementById("tip").hidden; 
    localStorage.setItem(LS + "-ui", JSON.stringify(p)); 
  } catch (e) {
  } }

// Build the full list of rooms to show: default rooms (minus hidden ones, with any renames applied) followed by user-added rooms in creation order
function allRooms() {
  const base = ROOMS.filter(r => !(state.hidden[r.id] && state.hidden[r.id].hidden)).map(r => { 
    const o = state.rooms[r.id] || {}; 
    return { 
      id: r.id, name: o.name || r.name, floor: floorOf(o.floor || r.floor) 
    }; 
  });
  const extra = Object.entries(state.rooms).filter(([id, r]) => r && r.name && !ROOMS.some(b => b.id === id))
    .sort((a, b) => (a[1].createdAt || "").localeCompare(b[1].createdAt || ""))
    .map(([id, r]) => ({ 
      id, 
      name: r.name, 
      floor: floorOf(r.floor), 
      custom: true 
    }));
  return base.concat(extra);
}
// Get the saved status record (done, note, trade) for an item, or an empty object
const rec = id => state.items[id] || {};
// Get all punch items belonging to a room, oldest first. The trade comes from the status record if edited, otherwise the original, otherwise "General".
function itemsOf(room) {
  return Object.entries(state.custom).filter(([, c]) => c && c.room === room.id)
    .sort((a, b) => (a[1].createdAt || "").localeCompare(b[1].createdAt || ""))
    .map(([id, c]) => ({ 
      id, 
      text: c.text, 
      trade: rec(id).trade || c.trade || "General" 
    }));
}
// Count total and open (not done) items across every room
function counts() {
  let total = 0, open = 0;
  allRooms().forEach(r => itemsOf(r).forEach(i => { 
    total++; 
    if (!rec(i.id).done) open++; 
  }));
  return { 
    total, open 
  };
}

// ================= WRITES (saving data) =================
// Show a status message ("Saved", "Saving…") in the header
function flag(msg) { 
  document.getElementById("saved").textContent = msg; 
}
// Show a temporary popup message for about 2.4 seconds
let toastT;
function toast(msg) { 
  const t = document.getElementById("toast"); 
  t.textContent = msg; t.hidden = false; 
  clearTimeout(toastT); 
  toastT = setTimeout(() => t.hidden = true, 2400); 
}
// Local-only mode: save a copy of the current job into localStorage
function saveLocalJob() { 
  local.jobs[jobId] = JSON.parse(JSON.stringify(state)); 
  lsSave(); 
}
// Save (or delete, if data is null) one document in a sub-collection of the current job
async function put(coll, id, data) {
  if (!fs) { 
    saveLocalJob(); 
    flag("Saved on this phone"); 
    return; 
  }
  flag(navigator.onLine === false ? "Offline. Will sync when back online." : "Saving…");
  try {
    const ref = fs.doc("jobs/" + jobId + "/" + coll + "/" + id);
    if (data) await ref.set(data); 
    else await ref.delete();
    flag("Saved");
  } catch (e) { 
    console.error("Couldn't save " + coll + "/" + id + ":", e); // ADDED: so a refused save shows up in the browser console
    flag(e && e.code === "permission-denied" ? "Couldn't save: you don't have access to change that." : "Couldn't save. Check your connection."); 
  }
  saveSummary(); // refresh the open/total counts shown on the home screen
}
// Save an item's status (done, when, note, trade)
function saveItem(id) { 
  const r = rec(id); 
  const data = { 
    done: !!r.done, doneAt: r.doneAt || null,
    signedBy: r.signedBy || "", signature: r.signature || "", // ADDED: who signed it off, and their drawn signature (a small PNG)
    note: r.note || "", trade: r.trade || "",
    updatedAt: new Date().toISOString()
  };
  // FIXED: the assignment is only written back when the item already has one. Adding empty assignment fields to an item
  // that never had them counted as a change, so the Firestore rules refused check-offs from people without list access.
  // ADDED: dueDate rides along the same way. It is written back only if the item already has one, so a check-off or an edit never wipes it.
  ["assignedTo", "assignedName", "assignedAt", "assignedBy", "dueDate"].forEach(k => { if (k in r) data[k] = r[k] || ""; });
  put("items", id, data);
}
// ADDED: assign an item to someone in the workspace ("" = unassigned)
// FIXED: saves only the assignment fields (merged into the item's record) instead of rewriting the whole record. A full
// rewrite also touched fields like the note or trade on older items, which the rules don't let "Assign tasks" change,
// so the save was refused and the assignment quietly disappeared. A refused save now says why and puts things back.
function assignItem(id, who) {
  if (!perm.assignTasks) { toast("You don't have access to assign tasks. Ask an admin."); return; }
  const name = who ? memberLabel(who) : "";
  const before = state.items[id];
  const upd = { assignedTo: who, assignedName: name, assignedAt: who ? new Date().toISOString() : "", assignedBy: who ? (uid || "") : "" };
  state.items[id] = Object.assign({}, rec(id), upd);
  ui.assign = null;
  render();
  if (!fs) { saveLocalJob(); flag("Saved on this phone"); toast(who ? "Assigned to " + name : "Unassigned"); return; }
  flag(navigator.onLine === false ? "Offline. Will sync when back online." : "Saving…");
  fs.doc("jobs/" + jobId + "/items/" + id).set(Object.assign({}, upd, { updatedAt: new Date().toISOString() }), { merge: true })
    .then(() => { flag("Saved"); toast(who ? "Assigned to " + name : "Unassigned"); })
    .catch(e => {
      console.error("Couldn't assign:", e);
      if (before) state.items[id] = before; else delete state.items[id];
      render();
      flag("Couldn't save.");
      toast(e && e.code === "permission-denied"
        ? "Couldn't assign: permission denied. Make sure the latest Firestore rules are published."
        : "Couldn't assign. Check your connection.");
    });
}
// ADDED: due dates. An item's due date is "YYYY-MM-DD" (a plain calendar day, so time zones can't shift it), or "" for none.
// Setting one needs "Assign tasks" (or full list access); the Firestore rules check the same thing.
const canDue = () => canEdit || !!perm.assignTasks;
// Set or clear an item's due date. Like assignItem, this saves only its own field (merged into the item's record) and puts
// things back with a message if the save is refused.
function setDue(id, date) {
  if (!canDue()) { toast("You don't have access to set due dates. Ask an admin."); return; }
  date = (date || "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Pick a valid date."); return; }
  if (date === (rec(id).dueDate || "")) { ui.due = null; render(); return; } // nothing changed
  const before = state.items[id];
  const upd = { dueDate: date };
  state.items[id] = Object.assign({}, rec(id), upd);
  ui.due = null;
  render();
  const okMsg = date ? "Due " + fmtDue(date) : "Due date cleared";
  if (!fs) { saveLocalJob(); flag("Saved on this phone"); toast(okMsg); return; }
  flag(navigator.onLine === false ? "Offline. Will sync when back online." : "Saving…");
  fs.doc("jobs/" + jobId + "/items/" + id).set(Object.assign({}, upd, { updatedAt: new Date().toISOString() }), { merge: true })
    .then(() => { flag("Saved"); toast(okMsg); })
    .catch(e => {
      console.error("Couldn't set the due date:", e);
      if (before) state.items[id] = before; else delete state.items[id];
      render();
      flag("Couldn't save.");
      toast(e && e.code === "permission-denied"
        ? "Couldn't set the due date: permission denied. Make sure the latest Firestore rules are published."
        : "Couldn't set the due date. Check your connection.");
    });
}
let metaQ, sumQ; // timers used to debounce saves
// ADDED: job fields typed since the last save. The live listener must not overwrite these with older data from the database.
let dirtyMeta = {};
// Save the job details (date, community, address, lot). Debounced: waits 600ms after the last keystroke so it doesn't save on every letter.
function saveMeta() {
  if (!canEdit) return; // ADDED
  clearTimeout(metaQ);
  metaQ = setTimeout(() => {
    const m = state.meta, data = { 
      date: m.date || "", 
      community: m.community || "", 
      address: m.address || "", 
      lot: m.lot || "", 
      description: m.description || "" 
    }; // CHANGED: description added
    if (!fs) { 
      saveLocalJob(); 
      flag("Saved on this phone"); 
      return; 
    }
    fs.doc("jobs/" + jobId).set(data, { 
      merge: true 
    }).then(() => {
      flag("Saved");
      Object.keys(data).forEach(k => { 
        if ((state.meta[k] || "") === data[k]) delete dirtyMeta[k]; 
      }); // only forget fields that have not changed again
    }, () => flag("Couldn't save. Check your connection."));
  }, 600);
}
// Open/total counts on the job record so the jobs list can show them.
// Debounced by 1.2s so rapid check-offs only trigger one write.
function saveSummary() {
  clearTimeout(sumQ);
  sumQ = setTimeout(() => { 
    if (fs && jobId) { 
      const c = counts(); 
      fs.doc("jobs/" + jobId).set({ 
        openCount: c.open, 
        totalCount: c.total, 
        updatedAt: new Date().toISOString() 
      }, 
      { 
        merge: true 
      }).catch(() => {}); 
    } 
  }, 1200);
}

// ================= RENDER: one job =================
// Escape special characters so user-typed text can't break the HTML (or inject code)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ 
  "&": "&amp;", 
  "<": "&lt;", 
  ">": "&gt;", 
  '"': "&quot;" 
}
[c]));
// Format a timestamp as a short date like "Oct 12". NOTE: no longer used since the Done badge now uses fmtDateTime() below. Safe to delete.
const fmt = iso => { 
  try { 
    return new Date(iso).toLocaleDateString(undefined, 
    { 
      month: "short", day: "numeric" 
    }); } catch (e) 
    { 
      return ""; 
    } 
  };
// ADDED: formats a timestamp as date + time of day, like "Oct 12, 3:45 PM" (uses the phone's own time zone and 12/24-hour setting).
// doneAt already stores the full date AND time, so the checkbox handler didn't need to change. Only the display did.
const fmtDateTime = iso => { 
  try { 
    return new Date(iso).toLocaleString(undefined, 
    { 
      month: "short", 
      day: "numeric", 
      hour: "numeric", 
      minute: "2-digit" 
    }
  ); 
  } catch (e) { 
    return ""; 
  } };
// Format a "YYYY-MM-DD" date as "Oct 12, 2026" (parsed manually to avoid time zone shifts)
const fmtDay = d => { 
  if (!d) return ""; 
  const [y, m, dd] = d.split("-").map(Number); 
  try { 
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    }
  ); 
} catch (e) 
{ 
  return d; 
} };
// ADDED: due dates. Today as "YYYY-MM-DD" in this phone's own time zone, and a short label like "Nov 12" (the year only if it isn't this year).
const dayStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmtDue = d => {
  const [y, m, dd] = d.split("-").map(Number);
  try {
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, y === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  } catch (e) { return d; }
};
// What to show for an item's due date: { cls, text }, or null when it has none. Open items past their date say "Overdue" (words as well as color).
// A finished item just shows its date, with no warning color.
function dueInfo(due, done) {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const now = new Date(), today = dayStr(now), tomorrow = dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (done) return { cls: "is-done", text: "Due " + fmtDue(due) };
  if (due < today) return { cls: "is-over", text: "Overdue · " + fmtDue(due) };
  if (due === today) return { cls: "is-soon", text: "Due today" };
  if (due === tomorrow) return { cls: "is-soon", text: "Due tomorrow" };
  return { cls: "", text: "Due " + fmtDue(due) };
}
// Build <option> tags for the trade dropdowns, with the selected one marked. If an item uses a trade that was later deleted, it's still included so it doesn't vanish.
const tradeOpts = sel => (sel && !TRADES.includes(sel) ? TRADES.concat(sel) : TRADES).map(t => `<option${
t === sel ? " selected" : ""
}>${esc(t)}</option>`).join("");

// ADDED: sets the big heading on the job screen to "Community - Lot - Description" (e.g. "Oakwood - 12 - Final walk").
// Any of the three that are empty are skipped. If all are empty, it falls back to "New List".
// To show "Lot 12" instead of just "12", change m.lot below to (m.lot && "Lot " + m.lot).
// CHANGED: description added. Line breaks in the description are turned into spaces so the heading stays on one line.
function updateTitle() {
  const m = state.meta;
  const desc = (m.description || "").replace(/\s+/g, " ").trim();
  document.getElementById("backBtn").textContent = m.projectId ? "‹ Project" : "‹ All Lists"; // ADDED
  document.getElementById("jobTitle").textContent = m.name || [m.community, m.lot, desc].filter(Boolean).join(" - ") || "New List"; // name comes from New Project
}

// Redraws the whole punch list screen from the current state. Called after almost every change.
function render() {
  if (!jobId) return;
  const rooms = allRooms();
  let total = 0, done = 0;
  // Build the HTML for each room card
  const parts = rooms.map(room => {
    const all = itemsOf(room);
    const whoOk = i => { const a = rec(i.id).assignedTo || ""; return !ui.who || (ui.who === "me" ? a === uid : ui.who === "none" ? !a : a === ui.who); }; // ADDED
    const tradeAll = all.filter(i => (!ui.trade || i.trade === ui.trade) && whoOk(i)); // apply the trade filter (CHANGED: and the assignee filter)
    const openN = tradeAll.filter(i => !rec(i.id).done).length;
    total += tradeAll.length; done += tradeAll.length - openN;
    if ((ui.trade || ui.who) && !tradeAll.length) return ""; // hide rooms with no items for the chosen trade (or assignee)
    // apply the status filter (all / open / done)
    const vis = tradeAll.filter(i => ui.show === "all" || (ui.show === "done") === !!rec(i.id).done);
    const isOpen = !!ui.open[room.id]; // is this room expanded?
    // Build the list items for this room
    const lis = vis.map(it => {
      const r = rec(it.id), ed = ui.edit === it.id; // ed = is this item currently being edited?
      const di = dueInfo(r.dueDate, r.done); // ADDED: due date chip (or null)
      // CHANGED: the green "✓ Done" badge below now uses fmtDateTime() so it shows the time of day, not just the date
      return `<li class="item ${r.done ? "done" : ""}" data-id="${it.id}">
        <input type="checkbox" id="cb-${it.id}" ${r.done ? "checked" : ""} aria-label="${esc(it.text)}">
        <div class="it-main">
        <label for="cb-${it.id}"><span class="txt">${esc(it.text)}</span>
        </label>
          ${r.note && !ed ? `<div class="note">${esc(r.note)}</div>` : ""}
          <div class="meta">
          <span class="trade">${esc(it.trade)}</span>${r.done ? `<span class="badge-done">✓ Done${r.doneAt ? " " + fmtDateTime(r.doneAt) : ""}</span>` : ""}${r.done && r.signedBy ? `<span class="signed">Signed by ${
            esc(r.signedBy)}${
              r.signature ? `<img src="${
                esc(r.signature)
              }" alt="Signature of ${esc(r.signedBy)}">` : ""
            }</span>` : ""
          }
            ${r.assignedTo ? `<span class="assignee${r.assignedTo === uid ? " is-me" : ""}">${r.assignedTo === uid ? "Assigned to you" : "Assigned to " + esc(memberLabel(r.assignedTo) || r.assignedName || "someone")}</span>` : ""}
            ${ed || !perm.assignTasks || !members.length || ui.assign === it.id ? "" : `<button type="button" class="link" data-assign="${it.id}">${r.assignedTo ? "Reassign" : "Assign"}</button>`}
            ${di ? `<span class="due ${di.cls}">${esc(di.text)}</span>` : ""}
            ${ed || r.done || !canDue() || ui.due === it.id ? "" : `<button type="button" class="link" data-due="${it.id}">${r.dueDate ? "Change due date" : "Set due date"}</button>`}
            ${ed || !canEdit ? "" : `<button type="button" class="link" data-edit="${
              it.id}">Edit</button>`
            }
            ${
              ed || !canEdit ? "" : `<button type="button" class="link muted" data-delitem="${
                it.id
              }">Remove</button>`
            }</div>
        ${ui.assign === it.id && perm.assignTasks ? `<div class="assign-pick"><select id="assign-${it.id}" data-assignsel="${it.id}" aria-label="Assign ${esc(it.text)} to">
            <option value="">Unassigned</option>${members.map(m => `<option value="${esc(m.id)}"${m.id === (r.assignedTo || "") ? " selected" : ""}>${esc((m.displayName || m.email || "Someone") + (m.id === uid ? " (you)" : ""))}</option>`).join("")}
          </select><button type="button" class="btn" data-assigncancel>Cancel</button></div>` : ""}
        ${ui.due === it.id && canDue() ? `<div class="due-pick"><input type="date" id="due-${it.id}" value="${esc(r.dueDate || "")}" aria-label="Due date for ${esc(it.text)}"><button type="button" class="btn primary" data-duesave="${it.id}">Save</button>${r.dueDate ? `<button type="button" class="btn" data-dueclear="${it.id}">Clear</button>` : ""}<button type="button" class="btn" data-duecancel>Cancel</button></div>` : ""}
        ${ed && canEdit ? `<div class="edit"><input type="text" id="text-${
          it.id
        }" maxlength="160" value="${
          esc(it.text)
        }" aria-label="Item text"><textarea id="note-${
          it.id
        }" placeholder="What's wrong, where exactly, who's fixing it…" aria-label="Note">${
          esc(r.note || "")
        }
        </textarea>
          <select id="trade-${it.id}" aria-label="Trade">${tradeOpts(it.trade)}</select>
          <div class="acts">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="button" class="btn primary" data-saveedit="${it.id}">Save</button>
          </div>
          </div>` : ""}
      </li>`;
    }).join("");
    const conf = ui.confirm === room.id; // is this room showing its "Remove?" confirmation?
    // The room card: header (name + status pill + arrow), and if expanded, the body (rename form, items, add form, footer links)
    return `<section class="room ${isOpen ? "open" : ""}" id="room-${room.id}">
      <button type="button" class="room-head" data-toggle="${room.id}" aria-expanded="${isOpen}">
        <span class="room-name">${esc(room.name)}</span>
        <span class="pill ${openN ? "" : tradeAll.length ? "clear" : "none"}">${openN ? openN + " open" : tradeAll.length ? "Clear" : "No items"}</span>
        <svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      </button>
      ${isOpen ? `<div class="room-body">
        ${ui.editRoom === room.id && canEdit ? `<div class="edit" style="padding:12px 14px"><input type="text" id="rname-${room.id}" maxlength="40" value="${esc(room.name)}" aria-label="Room name"><select id="rfloor-${room.id}" aria-label="Floor">${FLOORS.map(f => `<option${f === room.floor ? " selected" : ""}>${f}</option>`).join("")}</select><div class="acts"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-saveroom="${room.id}">Save</button></div></div>` : ""}
        <ul>${lis}</ul>
        ${!vis.length ? `<div class="empty">${!tradeAll.length ? (ui.who ? "No items here match that person." : canAdd() ? "No items yet. Add the first one below." : "No items yet.") : ui.show === "open" ? "Nothing open in this room." : "Nothing completed here yet."}</div>` : ""}
        ${canAdd() ? `<form class="add" data-add="${room.id}">
          <input id="add-${room.id}" type="text" maxlength="160" placeholder="New Item" aria-label="New punch item for ${esc(room.name)}">
          <select id="addtrade-${room.id}" aria-label="Trade">${tradeOpts(ui.trade || "General")}</select>
          <button class="btn primary" type="submit">Add</button>
        </form>` : ""}
        ${!canEdit ? "" : conf ? `<div class="confirm">Remove ${esc(room.name)} and its punch items from this list?
            <div class="acts">
            <button type="button" class="btn" data-cancel>Keep it</button>
            <button type="button" class="btn danger" data-delroom="${room.id}">Remove room</button>
            </div></div>`
          : `<div class="room-foot" style="gap:16px">
          <button type="button" class="link" data-editroom="${room.id}">Rename room</button>
          <button type="button" class="link muted" data-askroom="${room.id}">Remove room</button>
          </div>`}
      </div>` : ""}
    </section>`;
  });
  // Group the room cards under their floor headings, in the order of FLOORS
  let html = "";
  FLOORS.forEach(fl => {
    const sec = rooms.map((r, i) => r.floor === fl ? parts[i] : "").join("");
    if (sec) html += `<h2 class="floor">${fl}</h2>` + sec;
  });

  // Update the big count, label, and progress bar at the top
  const openTotal = total - done;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById("openN").textContent = openTotal;
  document.getElementById("openL").textContent = (openTotal === 1 ? "open item" : "open items") + (ui.trade ? " · " + ui.trade : "") + ` · ${pct}% done`;
  document.getElementById("gaugeFill").style.width = pct + "%";
  document.getElementById("gauge").setAttribute("aria-valuenow", pct);

  // Because the whole room list is rebuilt, remember what the user was typing and which field had focus, then restore both afterwards
  const focusId = document.activeElement && document.activeElement.id;
  const keep = {};
  document.querySelectorAll("#rooms input[type=text], #rooms textarea, #rooms select").forEach(el => keep[el.id] = el.value);
  // CHANGED: with no default rooms, a brand new list has nothing to draw. The old message would have read "No rooms have  items." (blank trade),
  // so now it shows "No rooms yet. Add your first room above." when no trade filter is active, and keeps the trade message when one is.
  document.getElementById("rooms").innerHTML = html || `<div class="empty">${
    ui.trade ? "No rooms have " + esc(ui.trade) + " items." : canEdit ? "No rooms yet. Add your first room above." : "No rooms yet."
  }</div>`;
  Object.entries(keep).forEach(([k, v]) => { 
    const el = document.getElementById(k); if (el) el.value = v; 
  });
  if (focusId) { 
    const el = document.getElementById(focusId); 
    if (el) el.focus({ 
      preventScroll: true 
    }); 
  }
  // Fill the job detail inputs (skipping the one being typed in so it doesn't get overwritten)
  document.querySelectorAll("[data-meta]").forEach(el => { 
    if (document.activeElement !== el) el.value = state.meta[el.dataset.meta] || ""; 
  });
  growDesc(); // ADDED: size the description box to its text
  // ADDED: show this list's current folder in the Folder dropdown ("No folder" if it has none, or its folder was deleted)
  const fsel = document.getElementById("jFolder");
  if (document.activeElement !== fsel) fsel.value = foldersList[state.meta.folderId] ? state.meta.folderId : "";
  // Browser tab title becomes "Lot 12 · Community Name"
  document.title = [state.meta.lot && "Lot " + state.meta.lot, state.meta.community].filter(Boolean).join(" · ") || "Punch List";
  updateTitle(); // ADDED: refresh the heading whenever the screen redraws
}

// NOTE: currently UNUSED since the "Copy list for subs" button was removed. Safe to delete this whole function, or keep it in case you add the button back.
// Builds the plain-text version of the list (open items only) that gets copied and sent to subcontractors
function listText() {
  const lines = [], m = state.meta;
  lines.push("PUNCH LIST" + (ui.trade ? " · " + ui.trade : ""));
  [m.date && "Date: " + fmtDay(m.date), m.community && "Community: " + m.community, m.address && "Address: " + m.address, m.lot && "Lot: " + m.lot, m.description && "Description: " + m.description].filter(Boolean).forEach(l => lines.push(l));
  lines.push("");
  let any = false;
  allRooms().forEach(room => {
    const open = itemsOf(room).filter(i => !rec(i.id).done && (!ui.trade || i.trade === ui.trade));
    if (!open.length) return;
    any = true;
    lines.push(room.name.toUpperCase());
    open.forEach(i => { lines.push("[ ] " + i.text + (ui.trade ? "" : " (" + i.trade + ")")); 
      if (rec(i.id).note) lines.push("    " + rec(i.id).note.replace(/\n/g, " ")); 
    });
    lines.push("");
  });
  if (!any) lines.push("No open items.");
  return lines.join("\n").trim();
}

// ================= RENDER: jobs list (home screen) =================
// CHANGED: split into two functions. jobRow() builds the HTML for ONE list (this is the old per-list code, unchanged),
// and renderJobs() now arranges the folders and the lists around them.
// ADDED: trash icon used on the delete buttons for folders and lists
const TRASH = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function jobRow(id, j) {
  // CHANGED: description added after Lot and Community (line breaks turned into spaces), e.g. "Lot 12 · Oakwood · Final walk"
  const desc = (j.description || "").replace(/\s+/g, " ").trim();
  const title = j.name || [j.lot && "Lot " + j.lot, j.community, desc].filter(Boolean).join(" · ") || "Untitled punch list"; // name comes from New Project
  const sub = [j.address, j.date && fmtDay(j.date)].filter(Boolean).join(" · ");
  const pill = typeof j.openCount === "number" && j.totalCount ? (j.openCount ? `<span class="pill">${
    j.openCount
  } open</span>` : `<span class="pill clear">Clear</span>`) : `<span class="pill none">No items</span>`;
  // ADDED: delete button on every list (editors only). It sits next to the list, not inside it, so tapping it never opens the list.
  const del = canEdit ? `<button type="button" class="icon-btn" data-jask="${esc(id)}" title="Delete list" aria-label="Delete list ${esc(title)}">${TRASH}</button>` : "";
  // ADDED: "are you sure?" box under the list. Deleting a list archives it, so it can be brought back from Settings > Archive.
  const confirm = canEdit && ui.confirmJob === id ? `<div class="confirm boxed jconfirm">Delete this list? It moves to Settings, under Archive, where you can bring it back or delete it for good.
        <div class="acts"><button type="button" class="btn" data-jcancel>Keep it</button><button type="button" class="btn danger" data-jdel="${esc(id)}">Delete</button></div></div>` : "";
  return `<li><div class="job-row"><a href="?job=${encodeURIComponent(id)}" data-job="${esc(id)}" draggable="false"><span class="j-main"><span class="j-title">${esc(title)}</span>${sub ? `<span class="j-sub">${esc(sub)}</span>` : ""}</span>${pill}</a>${del}</div>${confirm}</li>`;
}
function renderJobs() {
  // ADDED: don't redraw the list while a list is being dragged (the floating copy and highlights would be wiped). It redraws when the drag ends.
  if (drag.active) { 
    drag.rerender = true; 
    return; 
  }
  // Newest first
  const rows = Object.entries(jobsList).filter(([, j]) => !j.archived).sort( // CHANGED: archived lists are hidden (they live in Settings > Archive)
    (a, b) => (b[1].createdAt || "").localeCompare(a[1].createdAt || ""));
  // ADDED: remember what was typed in a folder rename box and which field had focus, because the whole list is rebuilt below
  const focusId = document.activeElement && document.activeElement.id;
  const keep = {};
  document.querySelectorAll("#jobs input").forEach(el => keep[el.id] = el.value);
  let html = "";
  // ADDED: one expandable card per folder (same look as the room cards), folders sorted A to Z
  // CHANGED: folders can now hold other folders. folderHtml() draws one folder, and inside it draws its sub-folders first, then its lists.
  function folderHtml(fid, fo) {
    const inside = rows.filter(([, j]) => j.folderId === fid); // the lists that belong to this folder
    const subs = childFolders(fid);                             // ADDED: the folders inside this folder
    const n = inside.length;
    const isOpen = !!ui.openFolders[fid];
    const proj = projectOfFolder(fid); // ADDED: the project this folder belongs to, if any
    const count = [subs.length && subs.length + (subs.length === 1 ? " folder" : " folders"), (n || !subs.length) && n + (n === 1 ? " list" : " lists")].filter(Boolean).join(" · ");
    // CHANGED: a folder now looks like a section header (big name, underline) instead of a button card. The header is still one tappable
    // button that opens and closes the folder. ADDED: a trash button on the right of the header (editors only) starts "Delete folder".
    return `<li><section class="folder ${isOpen ? "open" : ""}" data-dropfolder="${esc(fid)}">
      <div class="folder-bar">
        <h2 class="folder-title">
          <button type="button" class="folder-head" data-ftoggle="${esc(fid)}" aria-expanded="${isOpen}">
            <svg class="ficon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
            <span class="folder-name">${esc(fo.name)}</span>
            ${proj && projectNames[proj] ? `<span class="fproj" title="Part of ${esc(projectNames[proj])}">${esc(projectNames[proj])}</span>` : ""}
            <span class="folder-count">${count}</span>
            <svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </h2>
        ${canEdit ? `<button type="button" class="icon-btn" data-fask="${esc(fid)}" title="Delete folder" aria-label="Delete folder ${esc(fo.name)}">${TRASH}</button>` : ""}
      </div>
      ${canEdit && ui.confirmFolder === fid ? `<div class="confirm boxed jconfirm">Delete the folder ${esc(fo.name)}? The lists and folders inside are not deleted. They move up to ${foldersList[parentOf(fid)] ? esc(foldersList[parentOf(fid)].name) : "the main list"}.
          <div class="acts"><button type="button" class="btn" data-fcancel>Keep it</button><button type="button" class="btn danger" data-fdel="${esc(fid)}">Delete folder</button></div></div>` : ""}
      ${isOpen ? `<div class="folder-body">
        ${proj && projectNames[proj] ? `<div class="fproj-note"><span class="fproj-label">Part of project</span><a class="fproj-name" href="index.html#projects/${encodeURIComponent(proj)}">${esc(projectNames[proj])}</a><span class="fproj-hint">Lists added here join the project.</span></div>` : ""}
        ${ui.renameFolder === fid ? `<div class="edit" style="padding:12px 0"><input type="text" id="fname-${esc(fid)}" maxlength="40" value="${esc(fo.name)}" aria-label="Folder name"><div class="acts"><button type="button" class="btn" data-fcancel>Cancel</button><button type="button" class="btn primary" data-fsave="${esc(fid)}">Save</button></div></div>` : ""}
        <ul class="jobs">${subs.map(([sid, so]) => folderHtml(sid, so)).join("")}${n ? inside.map(([id, j]) => jobRow(id, j)).join("") : subs.length ? "" : `<li class="empty" style="padding:0">No lists in this folder yet.</li>`}</ul>
        ${!canEdit ? "" : `<div class="folder-foot"><button type="button" class="link" data-fnew="${esc(fid)}">New list here</button><button type="button" class="link" data-frename="${esc(fid)}">Rename</button></div>`}
      </div>` : ""}
    </section></li>`;
  }
  childFolders("").forEach(([fid, fo]) => { 
    html += folderHtml(fid, fo); 
  }); // top-level folders; each one draws its own sub-folders
  // ADDED: lists that are not in any folder (or whose folder was deleted) show below the folders
  const loose = rows.filter(([, j]) => !j.folderId || !foldersList[j.folderId] || foldersList[j.folderId].archived);
  if (sortedFolders().length && loose.length) html += `<li data-dropfolder=""><h2 class="floor">Not in a folder</h2></li>`;
  html += loose.map(([id, j]) => jobRow(id, j)).join("");
  document.getElementById("jobs").innerHTML = html || `<li class="empty">${canEdit ? "No lists yet. Tap <b>New list</b> to start one." : "No lists yet."}</li>`;
  document.getElementById("dragHint").hidden = !(canEdit && sortedFolders().length && (rows.length || sortedFolders().length > 1)); // ADDED: show the drag tip only when it's useful
  // ADDED: put back anything that was being typed, and the focus
  Object.entries(keep).forEach(([k, v]) => { 
    const el = document.getElementById(k); 
    if (el) el.value = v; 
  });
  if (focusId) { 
    const el = document.getElementById(focusId); 
    if (el) el.focus({ 
      preventScroll: true 
}); }
}

// ================= NAVIGATION =================
// Stop all live Firestore listeners (called when switching screens)
function stopListening() { 
  unsubs.forEach(u => { 
    try { 
      u(); 
    } catch (e) {

    } 
  }); 
  unsubs = []; 
}
// Show the home screen with the list of all punch lists
function showJobs() {
  stopListening(); jobId = null;
  try { renderProjectSide(); } catch (e) {} // ADDED: no project highlighted on the lists screen
  document.getElementById("jobView").hidden = true;
  document.getElementById("jobsView").hidden = false;
  document.title = "Lists";
  document.getElementById("offlineBanner").hidden = !!fs; // show the banner only in local-only mode
  if (fs) {
    // Live-listen to the "jobs" collection so the list updates automatically
    document.getElementById("jobsSaved").textContent = "Loading…";
    if (!uid) { 
      location.href = "login.html"; 
      return; 
    } // the home screen needs a signed-in user
    if (!wid) { 
      location.href = "signup.html"; 
      return; 
    } // no workspace yet, so finish setting one up
    unsubs.push(fs.collection("jobs").where("workspaceId", "==", wid).onSnapshot(snap => { // CHANGED: every list in this workspace
      jobsList = {}; snap.docs.forEach(d => jobsList[d.id] = d.data());
      jobsLoaded = true; syncFolderProjects(); // ADDED: folders holding a project's list join that project
      document.getElementById("jobsSaved").textContent = ""; renderJobs();
    }, 
    () => { 
      document.getElementById("jobsSaved").textContent = "Couldn't load. Check your connection."; 
    }));
  } else {
    // Local-only: build the list from localStorage (temporarily swapping state to count each job's items)
    jobsList = {};
    Object.entries(local.jobs).forEach(([id, s]) => { 
      const c = (() => { 
        state = s; return counts(); 
      })(); 
      jobsList[id] = Object.assign({}, 
      s.meta, { 
        openCount: c.open, 
        totalCount: c.total 
      }); });
    state = blank(); 
    renderJobs();
  }
}
// Open one punch list by id
function showJob(id) {
  stopListening(); jobId = id; dirtyMeta = {};
  try { renderProjectSide(); } catch (e) {} // ADDED: highlight this list's project in the sidebar
  // Firestore mode starts empty and fills in as data arrives; local mode loads from localStorage
  state = fs ? blank() : Object.assign(blank(), local.jobs[id] || { 
    meta: { 
      createdAt: new Date().toISOString() 
    } });
  // Restore which rooms were expanded last time; reset any open edit/confirm UI
  const p = uiPrefs(); ui.open = (p.open && p.open[id]) || {}; ui.edit = null; ui.confirm = null; ui.editRoom = null;
  document.getElementById("jobsView").hidden = true;
  document.getElementById("jobView").hidden = false;
  document.getElementById("confirmDelJob").hidden = true;
  document.getElementById("copyBox").hidden = true;
  window.scrollTo(0, 0);
  render();
  if (!fs) { 
    flag("Saved on this phone"); 
    return; 
  }
  flag("Syncing…");
  const lost = () => flag("Live sync stopped. Reload to reconnect.");
  // Live-listen to each sub-collection; any change (even from another phone) updates state and redraws
  COLLS.forEach(coll => {
    unsubs.push(fs.collection("jobs/" + id + "/" + coll).onSnapshot(snap => {
      const next = {}; snap.docs.forEach(d => { 
        next[d.id] = d.data(); 
      });
      state[coll] = next; render(); 
      flag(snap.metadata.fromCache ? "Saved on this phone. Syncing…" : "Synced");
    }, lost));
  });
  // Also listen to the job's own record (date, community, address, lot)
  unsubs.push(fs.doc("jobs/" + id).onSnapshot(snap => { 
    const next = snap.exists ? Object.assign({}, snap.data()) : {};
    Object.keys(dirtyMeta).forEach(k => { 
      if (k in state.meta) next[k] = state.meta[k];
    }); // ADDED: keep what is still being typed
    state.meta = next; 
    showLegacyBanner(snap.exists ? snap.data() : null); // ADDED (data safety)
    render(); }, 
    () => {}));
}
// ================= LEGACY LIST BANNER (ADDED, data safety) =================
// A list made before workspaces has no workspaceId, so it doesn't show in My Lists or on the dashboard. When its owner
// (or anyone, if it has no owner) opens it by its link, offer to move it into their workspace. See firebase-starter/legacy-data.js.
function showLegacyBanner(d) {
  const box = document.getElementById("legacyBanner");
  if (!box) return;
  box.hidden = !(fs && uid && wid && d && !d.workspaceId && (!d.ownerId || d.ownerId === uid) && window.HH_LEGACY);
}
document.getElementById("legacyClaim")?.addEventListener("click", async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await window.HH_LEGACY.claim(fs, jobId, uid, wid, state.meta.ownerId);
    toast("Moved into your workspace. It now shows in My Lists.");
  } catch (ex) {
    console.error("Couldn't move the list into the workspace:", ex);
    toast(ex && ex.code === "permission-denied" ? "Couldn't move it: make sure the latest Firestore rules are published." : "Couldn't move it. Check your connection.");
  }
  btn.disabled = false;
});
// Decide which screen to show based on the URL: ?job=abc opens that job, no param shows the home screen
function route() {
  const id = new URLSearchParams(location.search).get("job");
  if (id) showJob(id); 
  else showJobs();
}
// Navigate to a job (or home if id is null) and update the URL without reloading the page
function go(id) { 
  history.pushState(null, 
  "", 
  id ? "?job=" + encodeURIComponent(id) : location.pathname); 
  route(); 
}
// Make the browser's back/forward buttons work
window.addEventListener("popstate", route);

// ================= TRADES AND LEVELS (shared, editable) =================
// Save the trades and levels lists (to Firestore if connected, otherwise localStorage)
// CHANGED: now saves foldersList too (it lives in the same record as trades and levels)
function saveSettings() {
  if (!canEdit) return; // ADDED
  if (fs) {
    if (!uid || !wid) return; // guests opening a shared link have no settings to save
    // FIXED (data safety): this write replaces the whole record (trades, levels AND every folder). Before the saved record has
    // arrived, TRADES/FLOORS are the defaults and foldersList is empty, so saving then would wipe the workspace's folders.
    if (!settingsLoaded) { toast("Still loading your folders and trades. Try again in a moment."); return; }
    fs.doc(settingsPath()).set({ 
      trades: TRADES, 
      floors: FLOORS, 
      folders: foldersList 
    })
      .catch(() => toast("Couldn't save."));
  } else {
    local.trades = TRADES;
    local.floors = FLOORS;
    local.folders = foldersList;
    lsSave();
  }
}
// Refresh every dropdown and tag list that depends on trades/levels, then redraw
function applyTrades() {
  const tf = document.getElementById("tradeF"), cur = ui.trade;
  tf.innerHTML = `<option value="">All trades</option>` + tradeOpts(cur); tf.value = cur;
  document.getElementById("tradeList").innerHTML = TRADES.map((t, i) => `<span class="trade">${
    esc(t)
    } <button type="button" class="x" data-deltrade="${i}" aria-label="Remove ${
     esc(t)
     }">×</button></span>`).join("");
  const nf = document.getElementById("newRoomFloor"), cf = nf.value;
  nf.innerHTML = FLOORS.map(f => `<option>${esc(f)}</option>`).join("");
  if (FLOORS.includes(cf)) nf.value = cf; else nf.selectedIndex = FLOORS.length > 1 ? 1 : 0; // keep the previous choice, otherwise default to the second level
  document.getElementById("floorList").innerHTML = FLOORS.map((f, i) => `<span class="trade">${
    esc(f)
    } <button type="button" class="x" data-delfloor="${i}" aria-label="Remove ${
     esc(f)
     }">×</button></span>`).join("");
  applyFolders(); // ADDED: refresh folder-related screens whenever settings are applied (this also runs when the shared settings load)
  render();
}
// ADDED: refresh everything that shows folders: the Folder dropdown on a list, and the home screen
function applyFolders() {
  const sel = document.getElementById("jFolder");
  // CHANGED: sub-folders show their full path, e.g. "Oakwood / Phase 2", sorted by that path
  sel.innerHTML = `<option value="">No folder</option>` + Object.keys(foldersList).filter(id => !foldersList[id].archived).map(id => [id, folderPath(id)])
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
    .map(([id, p]) => `<option value="${esc(id)}">${esc(p)}</option>`).join("");
  sel.value = foldersList[state.meta.folderId] ? state.meta.folderId : "";
  renderJobs();
  refreshNewListChoices(); // ADDED: if the New punch list box is open, add the folders to it
}

// ================= EVENTS =================
applyTrades(); // initial fill of the dropdowns
// CHANGED: now a function that runs at boot, after we know who is signed in. Settings live under users/{uid}/settings/app.
let settingsLoaded = false; // ADDED (data safety): true once the workspace's saved trades, levels and folders have arrived
function loadSettings() {
  if (fs && uid && wid) {
    fs.doc(settingsPath()).onSnapshot(snap => {
      if (snap.metadata && snap.metadata.fromCache && !snap.exists) return; // an empty offline copy isn't the real record yet
      settingsLoaded = true;
      const d = snap.exists ? snap.data() : {};
      TRADES = Array.isArray(d.trades) && d.trades.length ? d.trades : DEFAULT_TRADES.slice();
      FLOORS = Array.isArray(d.floors) && d.floors.length ? d.floors : DEFAULT_FLOORS.slice();
      foldersList = d.folders && typeof d.folders === "object" ? d.folders : {};
      syncFolderProjects(); // ADDED: folders holding a project's list join that project
      applyTrades();
    }, () => {});
  } else if (!fs) {
    if (Array.isArray(local.trades) && local.trades.length) TRADES = local.trades;
    if (Array.isArray(local.floors) && local.floors.length) FLOORS = local.floors;
    foldersList = local.folders || {};
    applyTrades();
  }
  // Guests (shared link, not signed in) just use the default trades and levels
}
// Click the × on a level tag to remove it (at least one must remain)
document.getElementById("floorList").addEventListener("click", e => { 
  const b = e.target.closest("[data-delfloor]"); 
  if (!b || !needEdit()) return; 
  if (FLOORS.length < 2) { 
    toast("Keep at least one list"); 
    return; 
  } 
  FLOORS.splice(+b.dataset.delfloor, 1); 
  saveSettings(); 
  applyTrades(); 
});
// "Edit levels & trades" button toggles the editor panel
document.getElementById("tradesBtn").addEventListener("click", () => { 
  const b = document.getElementById("tradesBox"); 
  b.hidden = !b.hidden; 
});
// Click the × on a trade tag to remove it
document.getElementById("tradeList").addEventListener("click", e => { 
  const b = e.target.closest("[data-deltrade]"); 
  if (!b || !needEdit()) return; 
  TRADES.splice(+b.dataset.deltrade, 
  1); saveSettings(); 
  applyTrades(); 
});
// Status and trade filter dropdowns
document.getElementById("showF").addEventListener("change", e => { 
  ui.show = e.target.value; 
  render(); 
});
document.getElementById("tradeF").addEventListener("change", e => { 
  ui.trade = e.target.value; 
  render(); });
// ADDED: the "Assigned to" filter, and choosing someone in an item's "Assign to" picker
document.getElementById("whoF")?.addEventListener("change", e => { ui.who = e.target.value; render(); });
document.addEventListener("change", e => {
  const sel = e.target.closest && e.target.closest("[data-assignsel]");
  if (sel) assignItem(sel.dataset.assignsel, sel.value);
});
// ADDED: the description box grows with its text instead of scrolling inside a tiny box
function growDesc() {
  const t = document.getElementById("jDesc");
  if (!t) return;
  t.style.height = "auto";
  t.style.height = t.scrollHeight + 2 + "px";
}
// Typing in any job detail field updates state, updates the heading right away (CHANGED: updateTitle() added), and triggers a debounced save
document.querySelectorAll("[data-meta]").forEach(el => el.addEventListener("input", () => { 
  if (!canEdit) return; // ADDED
  state.meta = Object.assign({}, 
  state.meta, 
  { [el.dataset.meta]: el.value }); 
  dirtyMeta[el.dataset.meta] = true; // ADDED 
  if (el.id === "jDesc") growDesc(); // ADDED
  updateTitle(); 
  saveMeta(); 
}));
// ADDED: choosing a folder in the dropdown moves this list into that folder (empty value = no folder)
document.getElementById("jFolder").addEventListener("change", e => {
  if (!needEdit()) return; // ADDED
  state.meta = Object.assign({}, state.meta, { 
    folderId: e.target.value 
  });
  if (e.target.value) { 
    ui.openFolders[e.target.value] = true; uiSave(); 
  } // open that folder so the list is easy to find on the home screen
  if (!fs) { saveLocalJob(); 
    flag("Saved on this phone"); return; 
  }
  // ADDED: folders and projects follow each other (see FOLDERS JOIN PROJECTS)
  const fid = e.target.value, upd = { folderId: fid };
  if (fid && foldersList[fid]) {
    const folderProj = projectOfFolder(fid), myProj = projectExists(state.meta.projectId) ? state.meta.projectId : "";
    if (myProj && !folderProj) {
      // this list is in a project, the folder isn't yet: the folder joins this list's project
      foldersList = Object.assign({}, foldersList, { 
        [fid]: Object.assign({}, 
          foldersList[fid], 
          { 
            projectId: myProj 
          }) 
        });
      saveSettings(); 
      applyFolders();
      toast(foldersList[fid].name + " joined " + (projectNames[myProj] || "this list's project"));
    } else if (!myProj && folderProj) {
      // the folder is in a project, this list isn't yet: the list joins the folder's project
      upd.projectId = folderProj; upd.updatedAt = new Date().toISOString();
      state.meta = Object.assign({}, state.meta, { 
        projectId: folderProj 
      });
      document.getElementById("backBtn").textContent = "‹ Project";
      toast("Added to " + (projectNames[folderProj] || "the folder's project"));
    }
  }
  fs.doc("jobs/" + jobId).set(upd,
    { merge: true }).then(() => flag("Saved"),
    () => flag("Couldn't save. Check your connection."));
});
// Dismiss the install tip and remember that choice
document.getElementById("tipX").addEventListener("click", () => { 
  document.getElementById("tip").hidden = true; uiSave(); 
});
// CHANGED: a punch list that belongs to a project goes back to that project's page on the dashboard
document.getElementById("backBtn").addEventListener("click", () => {
  if (state.meta && state.meta.projectId) location.href = "index.html#projects/" + encodeURIComponent(state.meta.projectId);
  else go(null);
});
// CHANGED: the "New list" code now lives in a function so it can be used from two places: the main "New list" button
// (no folder) and the "New list here" link inside a folder. Creates a list with a random id and today's date, then opens it.
function createJob(folderId, projectId) { // projectId: the project this punch list belongs to (from a project page)
  if (fs && !uid) { 
    location.href = "login.html"; 
    return; 
  } // ADDED: must be signed in to make a list
  if (fs && !wid) { 
    location.href = "signup.html"; 
    return; 
  } // ADDED: and must have a workspace
  if (!canEdit) { 
    toast("You don't have access to create lists. Ask a workspace admin."); 
    if (!jobId) showJobs(); 
    return; 
  } // ADDED
  if (!projectId && folderId) projectId = projectOfFolder(folderId); // ADDED: a new list in a project's folder is part of that project
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = new Date(); 
  const d = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const meta = { 
    ownerId: uid, // who created it
    workspaceId: wid, // ADDED: which workspace it belongs to (everyone in the workspace can see it)
    date: d, 
    community: "", 
    address: "", 
    lot: "", 
    description: "", // ADDED
    folderId: folderId || "", 
    projectId: projectId || "", // ADDED: which project this punch list is part of
    createdAt: new Date().toISOString() 
  }; // ADDED: folderId
  if (fs && projectId) {
    // Fill in the community, lot and address from the project so they don't have to be typed again
    fs.doc("projects/" + projectId).get().then(p => {
      if (!p.exists) return;
      const pr = p.data(), fill = {};
      ["community", "lot", "address"].forEach(k => { 
        if (pr[k]) fill[k] = pr[k]; 
      });
      if (Object.keys(fill).length) return fs.doc("jobs/" + id).set(fill, { merge: true });
    }).catch(e => console.error("Couldn't copy the project details:", e));
  }
  if (fs) { 
    fs.doc("jobs/" + id).set(meta).catch(e => {
      console.error("Create list failed:", e);
      toast(e && e.code === "permission-denied" ? "Couldn't create the list: permission denied. Publish the new Firestore rules." : "Couldn't create the list. Check your connection.");
    }); 
  }
  else { 
    local.jobs[id] = Object.assign(blank(), { meta }); 
    lsSave(); 
  }
  if (folderId) { 
    ui.openFolders[folderId] = true; 
    uiSave(); 
  } // keep the folder open so the new list is visible when you come back
  go(id);
  setTimeout(() => document.getElementById("jCommunity").focus(), 50); // jump straight to the Community field
}
document.getElementById("newJob").addEventListener("click", () => createJob(""));

// ADDED: "New list" from the + menu in the left sidebar asks which project and which folder the list goes in.
// (From a project page the list goes straight into that project, so this box is skipped there.)
function refreshNewListChoices() { // fills both dropdowns; also called when projects or folders finish loading while the box is open
  const back = document.getElementById("nlBack");
  if (!back || back.hidden) return;
  const pSel = document.getElementById("nlProject"), fSel = document.getElementById("nlFolder");
  const keepP = pSel.value, keepF = fSel.value;
  const pids = Object.keys(projectNames).sort((a, b) => projectNames[a].localeCompare(projectNames[b], undefined, { sensitivity: "base" }));
  pSel.innerHTML = `<option value="">No project</option>` + pids.map(id => `<option value="${esc(id)}">${esc(projectNames[id])}</option>`).join("");
  fSel.innerHTML = `<option value="">No folder</option>` + Object.keys(foldersList).filter(id => !foldersList[id].archived).map(id => [id, folderPath(id)])
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
    .map(([id, path]) => `<option value="${esc(id)}">${esc(path)}</option>`).join("");
  pSel.value = keepP; if (pSel.value !== keepP) pSel.value = "";
  fSel.value = keepF; if (fSel.value !== keepF) fSel.value = "";
  updateNewListNote();
}
// Explains what a folder choice means for the project
function updateNewListNote() {
  const note = document.getElementById("nlNote");
  const fid = document.getElementById("nlFolder").value, pid = document.getElementById("nlProject").value;
  const fp = fid ? projectOfFolder(fid) : "";
  let text = "";
  if (fp && projectNames[fp] && !pid) text = "This folder is part of " + projectNames[fp] + ", so the list will join that project.";
  else if (fp && projectNames[fp] && pid && pid !== fp) text = "This folder is part of " + projectNames[fp] + ", but the list will stay in the project you picked.";
  note.textContent = text;
  note.hidden = !text;
}
function openNewListDialog() {
  // Not signed in, no workspace, or no permission: createJob explains (or redirects) the same way it always has
  if (fs && (!uid || !wid)) return createJob("", "");
  if (!canEdit) return createJob("", "");
  document.getElementById("nlBack").hidden = false;
  refreshNewListChoices();
  document.getElementById("nlProject").focus();
}
function closeNewListDialog() { document.getElementById("nlBack").hidden = true; }
document.getElementById("nlFolder").addEventListener("change", () => {
  // Choosing a folder that belongs to a project picks that project too (unless one is already chosen)
  const fid = document.getElementById("nlFolder").value, fp = fid ? projectOfFolder(fid) : "";
  const pSel = document.getElementById("nlProject");
  if (fp && projectNames[fp] && !pSel.value) pSel.value = fp;
  updateNewListNote();
});
document.getElementById("nlProject").addEventListener("change", updateNewListNote);
document.getElementById("nlOk").addEventListener("click", () => {
  const pid = document.getElementById("nlProject").value, fid = document.getElementById("nlFolder").value;
  closeNewListDialog();
  createJob(fid, pid); // makes the list in that folder and project and opens it
});
const nlCancel = () => { closeNewListDialog(); route(); };
document.getElementById("nlCancel").addEventListener("click", nlCancel);
document.getElementById("nlBack").addEventListener("click", e => { if (e.target.id === "nlBack") nlCancel(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("nlBack").hidden) nlCancel(); });
// ADDED: "New folder" button shows or hides the name form
document.getElementById("newFolder").addEventListener("click", () => {
  if (!needEdit()) return; // ADDED
  const f = document.getElementById("addFolderForm");
  f.hidden = !f.hidden;
  if (!f.hidden) document.getElementById("newFolderName").focus();
});
// CHANGED: this one click handler on the home screen list used to only open a list. It now also handles the folder buttons,
// using the same data- attribute approach as the room buttons (the buttons are re-created every time the list redraws).
document.getElementById("jobs").addEventListener("click", e => {
  // Clicking a list opens it without a full page reload (unchanged)
  const a = e.target.closest("a[data-job]");
  if (a) { 
    e.preventDefault(); 
    go(a.dataset.job); 
    return; 
  }
  const b = e.target.closest("button"); 
  if (!b) return;
  const d = b.dataset;
  if (!d.ftoggle && !needEdit()) return; // ADDED: everything except opening a folder edits something
  // Expand / collapse a folder
  if (d.ftoggle) { 
    ui.openFolders[d.ftoggle] = !ui.openFolders[d.ftoggle]; 
    ui.confirmFolder = null; 
    uiSave(); 
    renderJobs(); 
  }
  // Create a list inside this folder
  else if (d.fnew) { 
    createJob(d.fnew); 
  }
  // Start renaming a folder
  else if (d.frename) { 
    ui.renameFolder = d.frename; 
    ui.confirmFolder = null; 
    renderJobs(); 
    document.getElementById("fname-" + d.frename)?.focus(); 
  }
  // Save the new folder name (ignored if empty)
  else if (d.fsave) {
    const id = d.fsave, 
    name = document.getElementById("fname-" + id).value.trim();
    if (name) { 
      foldersList = Object.assign({}, 
      foldersList, 
      { 
        [id]: Object.assign({}, 
        foldersList[id], 
        { name }) }); 
        saveSettings(); 
      }
    ui.renameFolder = null; 
    applyFolders();
  }
  // Cancel a rename or a delete confirmation
  else if (b.hasAttribute("data-fcancel")) { 
    ui.renameFolder = null; 
    ui.confirmFolder = null; 
    renderJobs(); 
  }
  // Ask "delete this folder?"
  else if (d.fask) { 
    ui.confirmFolder = d.fask;
    ui.confirmJob = null;
    ui.renameFolder = null; 
    renderJobs(); 
  }
  // ADDED: ask "delete this list?" under that list
  else if (d.jask) {
    ui.confirmJob = d.jask;
    ui.confirmFolder = null;
    ui.renameFolder = null;
    renderJobs();
  }
  // ADDED: "Keep it" on the list confirmation
  else if (b.hasAttribute("data-jcancel")) {
    ui.confirmJob = null;
    renderJobs();
  }
  // ADDED: confirmed, delete the list
  else if (d.jdel) {
    deleteListFromAllLists(d.jdel);
  }
  // Confirm: remove the folder. The lists inside are NOT deleted. They still point at the old folder id, which no longer exists, so they show up under "Not in a folder".
  // CHANGED: the lists and sub-folders inside move up to this folder's parent (or the main list if it's a top-level folder)
  else if (d.fdel) {
    const up = parentOf(d.fdel);
    Object.entries(jobsList).forEach(([jid, j]) => { 
      if (j.folderId === d.fdel) setJobFolder(jid, up, true); 
    });
    const rest = Object.assign({}, foldersList);
    delete rest[d.fdel];
    Object.keys(rest).forEach(k => { 
      if (rest[k].parentId === d.fdel) rest[k] = Object.assign({}, rest[k], { parentId: up }); 
    });
    foldersList = rest;
    ui.confirmFolder = null; 
    saveSettings(); 
    applyFolders(); 
    toast("Folder deleted");
  }
});
// ================= ADDED: DELETE A LIST FROM ALL LISTS =================
// The trash button on a list row. Same safe step as "Archive this list" inside a list: the list, its rooms, items and signatures
// are kept and move to Settings > Archive, which is the only place a list can be deleted for good (the Firestore rules enforce this).
async function deleteListFromAllLists(id) {
  if (!needEdit()) return;
  ui.confirmJob = null;
  if (fs) {
    try {
      const now = new Date().toISOString();
      await fs.doc("jobs/" + id).update({ archived: true, archivedAt: now, archivedWith: "", updatedAt: now });
    } catch (e) {
      toast(e && e.code === "permission-denied" ? "You don't have access to delete this list." : "Couldn't delete. Check your connection.");
      renderJobs();
      return;
    }
    toast("List deleted. Find it in Settings, under Archive.");
  } else {
    delete local.jobs[id]; delete jobsList[id]; lsSave();
    toast("List deleted");
  }
  renderJobs();
}
// ================= DRAG A LIST INTO A FOLDER (ADDED) =================
// Works with a mouse (click and drag) and on a phone (press and hold ~0.35 seconds, then drag). It uses "pointer events" instead of the browser's
// built-in drag and drop, because the built-in version doesn't work with a finger on an iPhone.
const jobsEl = document.getElementById("jobs");

// Move a list into a folder (folderId = "" means take it out of any folder) and save it
// CHANGED: quiet = true skips the "Moved to" message and opening the folder (used when a folder is deleted)
function setJobFolder(id, folderId, quiet) {
  const cur = jobsList[id] && foldersList[jobsList[id].folderId] ? jobsList[id].folderId : "";
  if (cur === folderId || (folderId && !foldersList[folderId])) return; // already there, or the folder doesn't exist
  jobsList[id] = Object.assign({}, jobsList[id], { 
    folderId 
  }); // update the screen right away
  if (fs) fs.doc("jobs/" + id).set({ 
    folderId
  }, 
  { 
    merge: true 
  }).catch(() => toast("Couldn't move the list. Check your connection."));
  else if (local.jobs[id]) { 
    local.jobs[id].meta = Object.assign({}, 
    local.jobs[id].meta, 
    { 
      folderId 
    }); 
    lsSave(); 
  }
  if (quiet) return;
  if (folderId) { 
    ui.openFolders[folderId] = true; 
    uiSave(); 
  } // open the folder so you can see it landed
  const notes = syncFolderProjects(); // ADDED: the folder joins the list's project, or the list joins the folder's project
  toast((folderId ? "Moved to " + foldersList[folderId].name : "Taken out of its folder") + (notes.length ? ". " + notes.join(". ") : ""));
  if (notes.length) renderJobs();
}
// ADDED: move a folder into another folder (parentId = "" means move it to the top level) and save it.
// Refuses to put a folder inside itself or inside one of its own sub-folders.
function setFolderParent(fid, parentId) {
  if (!foldersList[fid] || parentOf(fid) === parentId) return;           // gone, or already there
  if (parentId && (!foldersList[parentId] || isInside(parentId, fid))) { // would loop
    toast("A folder can't go inside itself."); 
    return;
  }
  foldersList = Object.assign({}, foldersList, { 
    [fid]: Object.assign({}, 
      foldersList[fid], 
      { parentId }) 
    });
  saveSettings();
  if (parentId) { 
    ui.openFolders[parentId] = true; 
    uiSave(); 
  } // open the folder so you can see it landed
  const notes = syncFolderProjects(); // ADDED: a folder moved into a project's folder brings its lists into that project
  applyFolders();
  toast((parentId ? "Moved to " + foldersList[parentId].name : "Moved to the main list") + (notes.length ? ". " + notes.join(". ") : ""));
}
// ADDED: can the thing being dragged be dropped on this target? A folder can't land on itself or inside its own sub-folders.
function canDropOn(target) {
  if (!target) return false;
  const to = target.dataset.dropfolder;
  if (drag.kind !== "folder") return true;
  return !(to && isInside(to, drag.id)) && to !== parentOf(drag.id);
}

// Begin dragging: make the floating copy, fade the original, and (if the list is in a folder) add a drop area for taking it back out
function startDrag() {
  const li = drag.el && drag.el.closest("li");
  if (!li) { 
    finishDrag(false); 
    return; 
  }
  clearTimeout(drag.timer);
  drag.active = true;
  const r = li.getBoundingClientRect();
  drag.offX = drag.startX - r.left; drag.offY = drag.startY - r.top; // keep the grab point under the finger
  drag.ghost = document.createElement("ul"); 
  drag.ghost.className = "jobs drag-ghost"; 
  drag.ghost.style.width = r.width + "px";
  if (drag.kind === "folder") {
    // ADDED: for a folder, the floating copy is just its header (an open folder could be very tall)
    const g = document.createElement("li"), sec = document.createElement("section");
    sec.className = "room"; sec.appendChild(drag.el.cloneNode(true)); g.appendChild(sec);
    drag.ghost.appendChild(g);
  } else drag.ghost.appendChild(li.cloneNode(true));
  document.body.appendChild(drag.ghost);
  li.classList.add("is-dragging-source");
  const j = jobsList[drag.id];
  const inFolder = drag.kind === "folder" ? !!parentOf(drag.id) : !!(j && foldersList[j.folderId]);
  if (inFolder) {
    const dz = document.createElement("li");
    dz.className = "dropzone"; 
    dz.dataset.dropfolder = ""; 
    dz.textContent = "Drop here to take it out of its folder";
    jobsEl.appendChild(dz);
  }
  if (navigator.vibrate) navigator.vibrate(15); // small buzz on phones that support it
  tick();
}
// Runs every frame while dragging: scrolls the page when you're near the top or bottom edge, moves the floating copy, and highlights the folder underneath
function tick() {
  if (!drag.active) return;
  const edge = 80, 
  y = drag.lastY;
  if (y < edge) window.scrollBy(0, 
  -Math.ceil((edge - y) / 6));
  else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - (window.innerHeight - edge)) / 6));
  drag.ghost.style.transform = `translate(${drag.lastX - drag.offX}px, ${drag.lastY - drag.offY}px)`;
  const under = document.elementFromPoint(drag.lastX, drag.lastY); // the floating copy ignores the pointer, so this sees what's beneath it
  let target = under ? under.closest("[data-dropfolder]") : null;
  if (!canDropOn(target)) target = null; // ADDED: e.g. a folder over itself
  if (target !== drag.target) { 
    if (drag.target) drag.target.classList.remove("drop-hover"); 
    if (target) target.classList.add("drop-hover"); 
    drag.target = target; 
  }
  drag.raf = requestAnimationFrame(tick);
}
// End the drag. drop = true means the pointer was released (drop it), false means cancelled (put it back).
function finishDrag(drop) {
  clearTimeout(drag.timer); 
  cancelAnimationFrame(drag.raf);
  const wasActive = drag.active, 
  target = drag.target;
  if (wasActive) {
    if (drag.ghost) drag.ghost.remove();
    drag.ghost = null; 
    drag.active = false; 
    dragEndedAt = Date.now();
    jobsEl.querySelectorAll(".is-dragging-source").forEach(el => el.classList.remove("is-dragging-source"));
    jobsEl.querySelectorAll(".drop-hover").forEach(el => el.classList.remove("drop-hover"));
    const dz = jobsEl.querySelector(".dropzone"); if (dz) dz.remove();
    if (drop && target) { 
      if (drag.kind === "folder") setFolderParent(drag.id, target.dataset.dropfolder); // ADDED
      else setJobFolder(drag.id, target.dataset.dropfolder);
    }
  }
  const redraw = wasActive || drag.rerender;
  drag.id = null; 
  drag.el = null; 
  drag.kind = "";
  drag.target = null; 
  drag.rerender = false;
  if (redraw) renderJobs();
}
// Pressing on a list: with a mouse, wait for the pointer to move a few pixels; with a finger, wait for a press-and-hold
// (so that a normal swipe still scrolls the page). Only starts if at least one folder exists.
jobsEl.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) 
  return;
  if (!canEdit) return; // CHANGED: only editors can drag lists and folders
  const a = e.target.closest("a[data-job]");
  const fh = a ? null : e.target.closest("button[data-ftoggle]"); // ADDED: a folder's header can be dragged too
  if (a ? !sortedFolders().length : !(fh && sortedFolders().length > 1)) return; // nothing to drop it into
  Object.assign(drag, { 
    id: a ? a.dataset.job : fh.dataset.ftoggle, 
    kind: a ? "list" : "folder", // ADDED
    el: a || fh, 
    type: e.pointerType, 
    startX: e.clientX, 
    startY: e.clientY, 
    lastX: e.clientX, 
    lastY: e.clientY, 
    active: false 
  });
  if (e.pointerType !== "mouse") drag.timer = setTimeout(startDrag, 350);
});
document.addEventListener("pointermove", e => {
  if (!drag.id) return;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (drag.active) return;
  const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (drag.type === "mouse") { 
    if (moved > 6) startDrag(); 
  }
  else if (moved > 10) finishDrag(false); // finger moved before the press-and-hold finished: they're scrolling, not dragging
});
document.addEventListener("pointerup", () => { 
  if (drag.id) finishDrag(true); 
});
document.addEventListener("pointercancel", () => { 
  if (drag.id) finishDrag(false); 
});
// While dragging with a finger, stop the page from scrolling along with it
document.addEventListener("touchmove", e => { 
  if (drag.active) e.preventDefault(); 
}, 
{ 
  passive: false 
});
jobsEl.addEventListener("dragstart", e => e.preventDefault()); // turn off the browser's own link dragging
jobsEl.addEventListener("contextmenu", e => { 
  if (drag.id) e.preventDefault();
}); // no right-click / long-press menu on a list you're dragging
// After a drag ends, browsers can send a click to the list you were holding, which would open it. Swallow that click.
jobsEl.addEventListener("click", e => { 
  if (Date.now() - dragEndedAt < 400) { 
    e.preventDefault(); e.stopPropagation(); 
  } 
}, 
true);

// Copy text to the clipboard; if that's not allowed, show the text in a box so it can be selected and copied by hand
function copyOut(text, okMsg) {
  const box = document.getElementById("copyBox"), 
  ta = document.getElementById("copyText");
  ta.value = text;
  const fallback = () => { 
    box.hidden = false; 
    ta.focus(); 
    ta.select(); 
    toast("Select the text below and copy it"); 
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { 
    box.hidden = true;
    toast(okMsg); 
  }, 
  fallback);
  else fallback();
}
// REMOVED: the click listener for the "Copy list for subs" button. It had to go along with the button, because
// looking up a button that no longer exists would throw an error and stop the rest of the script from running.
// "Send link" opens the phone's share sheet (or copies the link on desktop)
document.getElementById("linkBtn").addEventListener("click", () => {
  const url = location.origin + location.pathname + "?job=" + encodeURIComponent(jobId);
  const title = document.title;
  if (navigator.share) navigator.share({ title, text: "Punch list: " + title, url }).catch(() => {});
  else copyOut(url, "Link copied. Anyone with it can open and check off this list.");
});
// Delete-whole-list flow: ask, then confirm or cancel
document.getElementById("askDelJob").addEventListener("click", () => { 
  if (!needEdit()) return; // ADDED
  document.getElementById("confirmDelJob").hidden = false; 
});
document.getElementById("keepJob").addEventListener("click", () => { 
  document.getElementById("confirmDelJob").hidden = true; 
});
document.getElementById("delJob").addEventListener("click", async () => {
  if (!needEdit()) return; // ADDED
  const id = jobId;
  if (fs) {
    // CHANGED (data safety): archive instead of deleting. The list, its rooms, items and signatures are all kept and show
    // in Settings > Archive, which is the only place a list can be deleted for good (the Firestore rules enforce this too).
    try {
      const now = new Date().toISOString();
      await fs.doc("jobs/" + id).update({ archived: true, archivedAt: now, archivedWith: "", updatedAt: now });
    } catch (e) { toast(e && e.code === "permission-denied" ? "You don't have access to archive this list." : "Couldn't archive. Check your connection."); return; }
  } else { delete local.jobs[id]; lsSave(); }
  toast(fs ? "List archived. Find it in Settings, under Archive." : "Punch list deleted"); go(null);
});
// ================= ADDED: DUPLICATE A LIST =================
// "Duplicate list" (next to Send link, editors only) makes a new list in the same folder with the same rooms, items, trades and notes.
// Nothing counts as done in the copy and no signatures are carried over, because a signature is a real sign-off for the original list.
// The copy gets today's date, and "(copy)" is added to its description so you can tell the two apart. Then it opens, so you can edit it right away.
let duplicating = false; // stops a double tap from making two copies
async function duplicateJob() {
  if (!jobId || duplicating || !needEdit()) return;
  if (fs && !uid) { location.href = "login.html"; return; }
  if (fs && !wid) { location.href = "signup.html"; return; }
  if (fs && navigator.onLine === false) { toast("You're offline. Connect to the internet to duplicate a list."); return; }
  duplicating = true;
  const btn = document.getElementById("dupJob"); if (btn) btn.disabled = true;
  flag("Duplicating…");
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let made = false; // true once the new list's record exists
  try {
    // 1. Get everything from the open list. Firestore mode asks the database directly, so a copy made right after opening isn't missing anything that hasn't synced yet.
    const src = { meta: {}, items: {}, custom: {}, rooms: {}, hidden: {} };
    if (fs) {
      const jd = await fs.doc("jobs/" + jobId).get();
      src.meta = jd.exists ? jd.data() : {};
      for (const coll of COLLS) { const snap = await fs.collection("jobs/" + jobId + "/" + coll).get(); snap.docs.forEach(d => { src[coll][d.id] = d.data(); }); }
    } else {
      Object.assign(src, JSON.parse(JSON.stringify(state)));
    }
    // 2. Build the copy. Items keep their trade and note but start open and unsigned.
    const nowIso = new Date().toISOString(), t = new Date();
    const today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    const items = {};
    Object.entries(src.items).forEach(([id, r]) => {
      if (!r || (!r.note && !r.trade)) return; // nothing worth keeping once done and signature are cleared
      items[id] = { done: false, doneAt: null, signedBy: "", signature: "", note: r.note || "", trade: r.trade || "", updatedAt: nowIso };
    });
    const m = src.meta || {}, desc = (m.description || "").trim().slice(0, 980);
    const meta = {
      ownerId: uid, workspaceId: wid, date: today,
      community: m.community || "", address: m.address || "", lot: m.lot || "",
      description: (desc ? desc + " " : "") + "(copy)",
      folderId: m.folderId || "", createdAt: nowIso
    };
    const copy = { items, custom: src.custom, rooms: src.rooms, hidden: src.hidden };
    // Count the copy's items the same way the app does (counts() reads the global state, so swap it in for a moment)
    const keep = state; state = Object.assign(blank(), copy);
    const c = counts(); state = keep;
    // 3. Save it
    if (fs) {
      await fs.doc("jobs/" + newId).set(Object.assign({}, meta, { openCount: c.open, totalCount: c.total, updatedAt: nowIso }));
      made = true; // the list record has to exist first: the rules look it up to check you may edit
      const writes = [];
      COLLS.forEach(coll => Object.entries(copy[coll]).forEach(([id, d]) => writes.push([coll, id, d])));
      for (let i = 0; i < writes.length; i += 400) { // Firestore allows 500 writes per batch; stay under it
        const b = fs.batch();
        writes.slice(i, i + 400).forEach(([coll, id, d]) => b.set(fs.doc("jobs/" + newId + "/" + coll + "/" + id), d));
        await b.commit();
      }
    } else {
      local.jobs[newId] = Object.assign(blank(), copy, { meta }); lsSave();
    }
    if (meta.folderId) { ui.openFolders[meta.folderId] = true; uiSave(); } // keep its folder open so the copy is easy to find
    toast("List duplicated. You're now in the copy.");
    go(newId);
  } catch (e) {
    console.error("Duplicate list failed:", e);
    toast(made ? "Couldn't finish copying. Delete the partial copy from All Lists and try again."
               : e && e.code === "permission-denied" ? "Couldn't duplicate: permission denied." : "Couldn't duplicate the list. Check your connection.");
  } finally {
    duplicating = false; if (btn) btn.disabled = false;
  }
}
document.getElementById("dupJob")?.addEventListener("click", duplicateJob);
// REMOVED: archiving lists and folders. Archiving now happens on a project's page (index.html#projects/{id}), which archives
// the project together with its punch lists. Lists and folders archived earlier still show in Settings > Archive.
// Checking/unchecking an item.
// CHANGED: checking an item no longer marks it done straight away. The box is unticked again and the signature box opens;
// the item is only marked done once the person types their name and signs (see SIGNATURE TO MARK DONE below).
// Unchecking still works right away and clears the signature.
document.addEventListener("change", e => {
  const cb = e.target.closest(".item input[type=checkbox]");
  if (!cb) return;
  const id = cb.closest(".item").dataset.id;
  if (cb.checked) { cb.checked = false; openSig(id); return; }
  state.items[id] = Object.assign({}, rec(id), { done: false, doneAt: null, signedBy: "", signature: "" });
  render(); saveItem(id);
});

// ================= ADDED: SIGNATURE TO MARK DONE =================
// The signature box asks for a typed name and a drawn signature. The name is filled in from the signed-in person's
// profile (or the last name typed on this phone). The drawing is saved as a small PNG with the item.
const sig = { id: null, drawn: false, drawing: false, last: null };
const sigBack = document.getElementById("sigBack"), pad = document.getElementById("sigPad"), sigName = document.getElementById("sigName"), sigErr = document.getElementById("sigErr");
let myName = ""; // the signed-in person's name from their profile, filled in during startup
function lastSigner() { try { return localStorage.getItem(LS + "-signer") || ""; } catch (e) { return ""; } }
function openSig(id) {
  // ADDED: if the browser is still showing an old copy of the page (no signature box), don't break. Ask for a reload instead.
  if (!sigBack || !pad) { toast("Reload the page to sign items off."); return; }
  sig.id = id; sig.drawn = false;
  const c = state.custom[id];
  document.getElementById("sigItem").textContent = c ? c.text : "";
  sigName.value = myName || lastSigner();
  sigErr.hidden = true;
  sigBack.hidden = false;
  document.documentElement.style.overflow = "hidden"; // ADDED: page behind the pop-up doesn't scroll while it's open
  sizePad();
  (sigName.value ? pad : sigName).focus({ preventScroll: true }); // CHANGED: focusing must never scroll the page
}
function closeSig() {
  sigBack.hidden = true; sig.id = null;
  document.documentElement.style.overflow = ""; // ADDED: let the page scroll again
  const cb = document.activeElement; if (cb && cb.blur) cb.blur();
}
// Match the canvas's pixels to its size on screen (sharper on phones) and wipe it
function sizePad() {
  const r = pad.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
  const ctx = pad.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1d2422";
  sig.drawn = false;
}
const padPt = e => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
pad?.addEventListener("pointerdown", e => {
  e.preventDefault(); pad.setPointerCapture(e.pointerId);
  sig.drawing = true; sig.last = padPt(e);
  const ctx = pad.getContext("2d"); ctx.beginPath(); ctx.arc(sig.last.x, sig.last.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = "#1d2422"; ctx.fill(); // a tap leaves a dot
  sig.drawn = true; sigErr.hidden = true;
});
pad?.addEventListener("pointermove", e => {
  if (!sig.drawing) return;
  const p = padPt(e), ctx = pad.getContext("2d");
  ctx.beginPath(); ctx.moveTo(sig.last.x, sig.last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  sig.last = p;
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => pad?.addEventListener(t, () => { sig.drawing = false; }));
// Shrink the signature to at most 400px wide before saving, so each one stays small (usually under 15 KB)
function sigImage() {
  const w = Math.min(400, pad.width), h = Math.round(pad.height * w / pad.width);
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  out.getContext("2d").drawImage(pad, 0, 0, w, h);
  return out.toDataURL("image/png");
}
document.getElementById("sigClear")?.addEventListener("click", sizePad);
document.getElementById("sigCancel")?.addEventListener("click", closeSig);
sigBack?.addEventListener("click", e => { if (e.target === sigBack) closeSig(); }); // tap outside the box to cancel
document.addEventListener("keydown", e => { if (e.key === "Escape" && sigBack && !sigBack.hidden) closeSig(); });
window.addEventListener("resize", () => { if (sigBack && !sigBack.hidden && !sig.drawn) sizePad(); });
document.getElementById("sigOk")?.addEventListener("click", () => {
  const name = sigName.value.replace(/\s+/g, " ").trim();
  const err = !name ? "Type your name." : !sig.drawn ? "Sign in the box." : "";
  if (err) { sigErr.textContent = err; sigErr.hidden = false; (name ? pad : sigName).focus({ preventScroll: true }); return; }
  const signature = sigImage();
  if (signature.length >= 100000) { sigErr.textContent = "That signature is too detailed. Tap Clear and sign again."; sigErr.hidden = false; return; }
  try { localStorage.setItem(LS + "-signer", name); } catch (e) {}
  const id = sig.id;
  state.items[id] = Object.assign({}, rec(id), { done: true, doneAt: new Date().toISOString(), signedBy: name, signature });
  closeSig(); render(); saveItem(id);
});
// One click handler for every button inside the rooms area. Each button carries a data- attribute that says what it does (event delegation, because the buttons are re-created on every render).
document.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || !b.closest("#rooms")) return;
  const d = b.dataset;
  // Expand / collapse a room
  if (d.toggle) { ui.open[d.toggle] = !ui.open[d.toggle]; ui.confirm = null; uiSave(); render(); }
  // ADDED: open or close the "Assign to" picker (people with "Assign tasks")
  else if (d.assign) {
    if (!perm.assignTasks) { toast("You don't have access to assign tasks. Ask an admin."); return; }
    ui.assign = d.assign; ui.due = null; render(); document.getElementById("assign-" + d.assign)?.focus();
  }
  else if (b.hasAttribute("data-assigncancel")) { ui.assign = null; render(); }
  // ADDED: due dates (people with "Assign tasks", or full list access): open the date picker, save, clear, or cancel
  else if (d.due) {
    if (!canDue()) { toast("You don't have access to set due dates. Ask an admin."); return; }
    ui.due = d.due; ui.assign = null; render(); document.getElementById("due-" + d.due)?.focus();
  }
  else if (d.duesave) { const el = document.getElementById("due-" + d.duesave); setDue(d.duesave, el ? el.value : ""); }
  else if (d.dueclear) setDue(d.dueclear, "");
  else if (b.hasAttribute("data-duecancel")) { ui.due = null; render(); }
  // ADDED: every other button in a room edits the list, so editors only
  else if (!b.hasAttribute("data-cancel") && !needEdit()) return;
  // Start editing an item
  else if (d.edit) { ui.edit = d.edit; render(); document.getElementById("note-" + d.edit)?.focus(); }
  // Start renaming a room
  else if (d.editroom) { ui.editRoom = d.editroom; ui.confirm = null; render(); document.getElementById("rname-" + d.editroom)?.focus(); }
  // Save a room rename / level change
  else if (d.saveroom) {
    const id = d.saveroom, name = document.getElementById("rname-" + id).value.trim(), floor = document.getElementById("rfloor-" + id).value;
    if (name) { const old = state.rooms[id] || {}; state.rooms[id] = Object.assign({}, old, { name, floor, createdAt: old.createdAt || new Date().toISOString() }); put("rooms", id, state.rooms[id]); }
    ui.editRoom = null; render();
  }
  // Cancel any open edit or confirmation
  else if (b.hasAttribute("data-cancel")) { ui.edit = null; ui.confirm = null; ui.editRoom = null; render(); }
  // Save an item edit (text, note, trade)
  else if (d.saveedit) {
    const id = d.saveedit;
    const note = document.getElementById("note-" + id).value.trim(), trade = document.getElementById("trade-" + id).value;
    const text = document.getElementById("text-" + id).value.trim();
    ui.edit = null; state.items[id] = Object.assign({}, rec(id), { note, trade });
    if (text && state.custom[id] && text !== state.custom[id].text) { state.custom[id] = Object.assign({}, state.custom[id], { text }); put("custom", id, state.custom[id]); }
    render(); saveItem(id);
  }
  // Remove an item (deletes both the item and its status record)
  else if (d.delitem) {
    const id = d.delitem;
    delete state.custom[id]; delete state.items[id];
    put("custom", id, null).then(() => put("items", id, null));
    render(); toast("Item removed");
  }
  // Ask "remove this room?"
  else if (d.askroom) { ui.confirm = d.askroom; render(); }
  // Confirm room removal: user-added rooms are deleted; default rooms are marked hidden instead (since they come from the ROOMS constant)
  else if (d.delroom) {
    const id = d.delroom; ui.confirm = null;
    if (state.rooms[id]) { delete state.rooms[id]; put("rooms", id, null); }
    if (ROOMS.some(b => b.id === id)) { state.hidden[id] = { hidden: true }; put("hidden", id, { hidden: true }); }
    render(); toast("Room removed");
  }
});
// One submit handler for all the forms (add room, add level, add trade, add item)
document.addEventListener("submit", e => {
  const f = e.target;
  e.preventDefault(); // stop the browser from reloading the page
  // CHANGED: adding an item needs "Add to-dos" (or full list access); every other form here needs full list access
  if (f.dataset.add ? !canAdd() : !canEdit) {
    toast(f.dataset.add ? "You don't have access to add to-dos. Ask an admin." : "You can check items off, but you don't have access to change this list. Ask an admin.");
    return;
  }
  // Add a new room
  if (f.id === "addRoom") {
    const inp = document.getElementById("newRoom"), name = inp.value.trim();
    if (!name) return;
    const id = "r-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    state.rooms[id] = { name, floor: document.getElementById("newRoomFloor").value, createdAt: new Date().toISOString() }; ui.open[id] = true; inp.value = "";
    render(); uiSave(); put("rooms", id, state.rooms[id]);
    document.getElementById("add-" + id)?.focus(); // jump into the new room's "New Item" field
    return;
  }
  // ADDED: create a new folder (ignores empty names; CHANGED: duplicate names are allowed, since every folder has its own id)
  if (f.id === "addFolderForm") {
    const inp = document.getElementById("newFolderName"), name = inp.value.trim();
    if (!name) return;
    const id = "f-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    foldersList = Object.assign({}, foldersList, { [id]: { name, createdAt: new Date().toISOString() } });
    ui.openFolders[id] = true; uiSave(); // start the new folder expanded
    inp.value = ""; f.hidden = true;
    saveSettings(); applyFolders();
    return;
  }
  // Add a level (ignores duplicates, case-insensitive)
  if (f.id === "addFloor") { const inp = document.getElementById("newFloor"), t = inp.value.trim(); if (t && !FLOORS.some(x => x.toLowerCase() === t.toLowerCase())) { FLOORS.push(t); saveSettings(); applyTrades(); } inp.value = ""; return; }
  // Add a trade (ignores duplicates, case-insensitive)
  if (f.id === "addTrade") { const inp = document.getElementById("newTrade"), t = inp.value.trim(); if (t && !TRADES.some(x => x.toLowerCase() === t.toLowerCase())) { TRADES.push(t); saveSettings(); applyTrades(); } inp.value = ""; return; }
  // Add a punch item to a room
  if (!f.dataset.add) return;
  const room = f.dataset.add, inp = document.getElementById("add-" + room), text = inp.value.trim();
  if (!text) return;
  const id = "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const data = { room, text, trade: document.getElementById("addtrade-" + room).value, createdAt: new Date().toISOString() };
  state.custom[id] = data; inp.value = "";
  render(); document.getElementById("add-" + room)?.focus(); put("custom", id, data); // keep focus so several items can be added quickly
});

// ================= BOOT (runs once when the page loads) =================
// Hide the install tip if it was dismissed before, or if the app is already running from the home screen
if (uiPrefs().tipHidden || navigator.standalone) document.getElementById("tip").hidden = true;
ui.openFolders = uiPrefs().openFolders || {}; // ADDED: restore which folders were expanded last time
// ADDED: owner of the workspace = editor. Admins are editors too. Other members are editors only if an admin turned on "Can edit lists" for them.
// The member record is watched live, so a change in Settings takes effect without reloading.
async function watchPerms() {
  let ownerId = "";
  try { const w = await fs.doc("workspaces/" + wid).get(); ownerId = w.exists ? w.data().ownerId : ""; } catch (e) {}
  if (ownerId === uid) { canEdit = true; perm = window.HH_PERMS ? window.HH_PERMS.of({}, true) : perm; renderSide(); return; }
  await new Promise(resolve => {
    fs.doc("workspaces/" + wid + "/members/" + uid).onSnapshot(snap => {
      // CHANGED: each permission comes from Settings > Members > Access (firebase-starter/perms.js)
      const d = snap.exists ? snap.data() : {};
      const nextPerm = snap.exists && window.HH_PERMS ? window.HH_PERMS.of(d, d.admin === true) : {};
      const changed = JSON.stringify(nextPerm) !== JSON.stringify(perm);
      perm = nextPerm;
      canEdit = !!perm.manageLists;
      applyPerms();
      if (changed) { ui.edit = null; ui.editRoom = null; ui.confirm = null; ui.assign = null; ui.due = null; render(); renderJobs(); renderSide(); }
      resolve();
    }, () => resolve());
  });
}
// ADDED: the people in the workspace, for the "Assign to" picker and the assignee filter. Watched live, so new people show up.
function watchMembers() {
  if (!fs || !uid || !wid) return;
  fs.collection("workspaces/" + wid + "/members").onSnapshot(snap => {
    members = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "", undefined, { sensitivity: "base" }));
    applyWhoFilter();
    render();
  }, e => console.error("Couldn't load the workspace's people:", e));
}
// ADDED: fill the "Assigned to" filter (hidden for guests, who can't see the workspace's people)
function applyWhoFilter() {
  const sel = document.getElementById("whoF");
  if (!sel) return;
  sel.hidden = !members.length;
  sel.innerHTML = `<option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>`
    + members.filter(m => m.id !== uid).map(m => `<option value="${esc(m.id)}">${esc(m.displayName || m.email || "Someone")}</option>`).join("");
  sel.value = ui.who;
  if (sel.value !== ui.who) { ui.who = ""; sel.value = ""; }
}
function boot() {
  loadSettings();
  loadProjects(); // ADDED: project names for folders that belong to a project
  startSideJobs(); // ADDED: the sidebar's project progress bars
  loadWorkspace(); // ADDED: workspace name and logo for the sidebar
  renderSide();
  // If we arrived from the dock's "New List" button, create a list right away and open it
  if (new URLSearchParams(location.search).get("new") === "1") {
    const projectId = new URLSearchParams(location.search).get("project") || ""; // ADDED: "New punch list" on a project page
    history.replaceState(null, "", location.pathname); // clear ?new=1 so a refresh doesn't make another list
    if (projectId) createJob("", projectId);           // from a project page: the list goes straight into that project
    else { route(); openNewListDialog(); }             // from the left menu's + button: ask which project and folder first
  } else {
    route();
  }
}
//  wait until Firebase knows who is signed in (or that nobody is), then start the app
if (authSvc) {
  const stopAuthWait = authSvc.onAuthStateChanged(async user => {
    stopAuthWait();
    uid = user ? user.uid : null;
    if (uid) {
      // find out which workspace this person belongs to (saved on their profile during sign-up)
      try {
        const snap = await fs.doc("users/" + uid + "/profile/info").get();
        wid = (snap.exists && snap.data().workspaceId) || null;
        myName = (snap.exists && snap.data().name) || ""; //  pre-fills the name in the signature box
      } catch (e) { wid = null; }
      if (wid) {
        await watchPerms(); watchMembers(); 
        if (window.HH_LEGACY) window.HH_LEGACY.adopt(fs, uid, wid, canEdit).then(n => {
          if (n) toast((n === 1 ? "1 older list was" : n + " older lists were") + " brought back into your workspace.");
        });
      }
    }
    applyPerms(); // ADDED
    boot();
  });
} else {
  boot();
}
// Keep the page content clear of the fixed top bar
function setNavH() {
  const n = document.getElementById("fnav");
  if (n) document.documentElement.style.setProperty("--nav-h", n.offsetHeight + "px");
}
setNavH();
window.addEventListener("resize", setNavH);
window.addEventListener("load", setNavH);
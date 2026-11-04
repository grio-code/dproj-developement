// ©HomeHub LLC 2026

//what each person in a workspace is allowed to do. Shared by every page (index, allLists, new-project, settings).
//
// Admins (the workspace owner plus anyone made an admin in Settings) can do everything.
// Everyone else starts with none of these and can check items off only. An admin switches each one on in
// Settings > Members > Access. They are saved on workspaces/{wid}/members/{uid} as perms: { key: true/false }.
//
// Members an admin gave "Can edit lists" before these existed (canEdit: true and no perms yet) keep full access
// until an admin changes their access. The Firestore rules (firebase-starter/firebase.rules) check the same thing.
(() => {
  const LIST = [
    ['createProjects', 'Create projects',                   'Start new projects.'],
    ['manageProjects', 'Edit, archive and delete projects', 'Change a project’s details, archive it, or delete it.'],
    ['manageLists',    'Create, edit and delete lists',     'Make lists and change their rooms, items, details, folders and trades.'],
    ['moveLists',      'Move lists into projects',          'Put a punch list that isn’t in a project into one.'],
    ['addTodos',       'Add to-dos',                        'Add new items to a list.'],
    ['assignTasks',    'Assign tasks',                      'Assign an item on any list to someone in the workspace, and set when it is due.']
  ];
  const KEYS = LIST.map(x => x[0]);

  // member: their members/{uid} record (or {}). isAdmin: owner or admin.
  // Returns { createProjects: bool, ..., any: bool } — "any" is true when they can do at least one thing beyond checking off.
  function of(member, isAdmin) {
    const m = member || {};
    const legacy = !m.perms && m.canEdit === true;
    const out = {};
    KEYS.forEach(k => { out[k] = !!isAdmin || legacy || !!(m.perms && m.perms[k] === true); });
    out.any = KEYS.some(k => out[k]);
    return out;
  }
  // The perms map to save for a member, with one switch changed
  function withChange(member, key, on) {
    const cur = of(member, false), next = {};
    KEYS.forEach(k => { next[k] = k === key ? !!on : cur[k]; });
    return next;
  }

  window.HH_PERMS = { LIST, KEYS, of, withChange };
})();
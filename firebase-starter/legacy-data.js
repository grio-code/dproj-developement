// ©HomeHub LLC 2026

// Brings back data saved before workspaces existed (see DATA-SAFETY.md).
//
// HH_LEGACY.adopt(db, uid, wid, canEditSettings) runs when a signed-in person opens My Lists or the dashboard:
//   1. Every list they own that has no workspaceId gets workspaceId = their workspace. Nothing else on the list changes.
//   2. Once per person, folders, trades and levels from their old personal settings are added to the workspace's settings
//      (only ones that are missing; nothing already there is changed or removed). Skipped if they can't edit lists.
// It resolves to the number of lists it brought back. It never deletes anything, and any failure is logged and ignored.
//
// Lists made before Oct 20, 2026 have no ownerId at all, so no search can find them. Opening one by its link shows a
// "Move into my workspace" banner instead (allLists.js, LEGACY LIST BANNER), which calls HH_LEGACY.claim().
(() => {
  async function adoptLists(db, uid, wid) {
    const snap = await db.collection('jobs').where('ownerId', '==', uid).get();
    const orphans = snap.docs.filter(d => !d.data().workspaceId);
    for (let i = 0; i < orphans.length; i += 400) { // Firestore allows 500 writes per batch
      const b = db.batch();
      orphans.slice(i, i + 400).forEach(d => b.update(d.ref, { workspaceId: wid, updatedAt: new Date().toISOString() }));
      await b.commit();
    }
    return orphans.length;
  }

  // ADDED: lists made before Oct 20, 2026 have no ownerId, so the search above can't find them. This browser may still
  // remember their ids: the old app saved which lists were opened (punch-app-v1-ui → open) and, in local-only mode, the
  // lists themselves (punch-app-v1 → jobs). Open each one by id (anyone can read one list) and claim it if it has no
  // workspace and no owner (or this person is the owner). Lists this browser never opened need tools/recover-lists.js.
  function rememberedIds() {
    const ids = new Set();
    const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
    Object.keys(read('punch-app-v1-ui').open || {}).forEach(id => ids.add(id));
    Object.keys(read('punch-app-v1').jobs || {}).forEach(id => ids.add(id));
    return [...ids].filter(id => id && !id.includes('/'));
  }
  async function adoptRemembered(db, uid, wid) {
    let n = 0;
    for (const id of rememberedIds()) {
      try {
        const s = await db.doc('jobs/' + id).get();
        if (!s.exists) continue;
        const d = s.data() || {};
        if (d.workspaceId || (d.ownerId && d.ownerId !== uid)) continue;
        await claim(db, id, uid, wid, d.ownerId);
        n++;
      } catch (e) { console.warn('Couldn’t bring back list ' + id + ':', e); }
    }
    return n;
  }

  async function mergeSettings(db, uid, wid) {
    const oldRef = db.doc('users/' + uid + '/settings/app');
    const old = await oldRef.get();
    if (!old.exists) return;
    const o = old.data() || {};
    if (o.mergedInto === wid) return; // already done once; don't bring back things removed since
    const wsRef = db.doc('workspaces/' + wid + '/settings/app');
    const ws = await wsRef.get();
    const w = ws.exists ? ws.data() : {};
    const folders = Object.assign({}, w.folders || {});
    let changed = false;
    Object.entries(o.folders || {}).forEach(([id, f]) => { if (f && !folders[id]) { folders[id] = f; changed = true; } });
    const union = (cur, add) => {
      const out = Array.isArray(cur) ? cur.slice() : [];
      (Array.isArray(add) ? add : []).forEach(t => {
        if (typeof t === 'string' && !out.some(x => String(x).toLowerCase() === t.toLowerCase())) { out.push(t); changed = true; }
      });
      return out;
    };
    const trades = union(w.trades, o.trades), floors = union(w.floors, o.floors);
    if (changed) {
      const upd = { folders };
      if (trades.length) upd.trades = trades;
      if (floors.length) upd.floors = floors;
      await wsRef.set(upd, { merge: true });
    }
    await oldRef.set({ mergedInto: wid, mergedAt: new Date().toISOString() }, { merge: true }); // the old copy itself is kept
  }

  async function adopt(db, uid, wid, canEditSettings) {
    if (!db || !uid || !wid) return 0;
    let n = 0;
    try { n = await adoptLists(db, uid, wid); } catch (e) { console.warn('Couldn’t check for lists from before workspaces:', e); }
    try { n += await adoptRemembered(db, uid, wid); } catch (e) { console.warn('Couldn’t check this browser for older lists:', e); }
    if (canEditSettings) {
      try { await mergeSettings(db, uid, wid); } catch (e) { console.warn('Couldn’t bring over folders and trades from before workspaces:', e); }
    }
    return n;
  }

  // A list with no workspaceId, opened by its link: put it in this person's workspace (and make them its owner if it has none)
  function claim(db, jobId, uid, wid, ownerId) {
    return db.doc('jobs/' + jobId).update({ workspaceId: wid, ownerId: ownerId || uid, updatedAt: new Date().toISOString() });
  }

  window.HH_LEGACY = { adopt, claim };
})();

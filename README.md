# ©HomeHub LLC 2026
# By Builders, for Builders

# Data safety

©HomeHub LLC 2026

How HomeHub keeps customer data from being lost or hidden, and what to check before changing code that reads or writes it.

## What happened in October 2026

The "workspace set up" change (Oct 21) switched My Lists from showing *your* lists (`jobs` where `ownerId == you`)
to showing *your workspace's* lists (`jobs` where `workspaceId == your workspace`). Lists made before that had no
`workspaceId`, so they disappeared from the app. Nothing was deleted. The data was still in Firestore, but no screen
asked for it any more. Trades, levels and folders also moved from `users/{uid}/settings/app` to
`workspaces/{wid}/settings/app`, so each person's older folders stopped showing too.

`firebase-starter/legacy-data.js` now brings these back automatically. See "Recovering older data" below.

## Backups (Firebase / Google Cloud)

The live project is **homehub-721**. Both of these are turned on (Oct 27, 2026) and need the Blaze plan.

1. **Point-in-time recovery (PITR).** A minute-by-minute history of the database for the last 7 days, so you can
   read or restore data as it was before a bad change.
   Check: `gcloud firestore databases describe --database='(default)' --project=homehub-721 | grep pointInTime`
2. **Daily backups.** A full copy every day, kept for 14 weeks (the maximum).
   Check: `gcloud firestore backups schedules list --database='(default)' --project=homehub-721`
3. **Before a risky change**, take an export right then, because the daily backup may be almost a day old:
   `gcloud firestore export gs://YOUR-BUCKET --project=homehub-721`
4. **Restoring** never overwrites the live database. It makes a new database next to it, and you copy back what you need.
   Backups don't include the Security Rules, so keep `firebase-starter/firebase.rules` in git (it is).

## Moving to a new Firebase project (done Oct 27, 2026)

The app moved from `integrate-software` to `homehub-721`. Firestore was copied with `gcloud firestore export` /
`gcloud firestore import`, and user accounts with `firebase auth:export` / `firebase auth:import` using the old
project's password hash settings, so user IDs and passwords stayed the same and every record still links to its owner.
If this ever happens again: copy both the data and the accounts, publish the rules in the new project, add the site's
domain under Authentication > Settings > Authorized domains, and turn on Email/Password with Email link.

## Rules for future code changes

1. **Changing which field a screen filters on hides old data.** If a query changes from one field to another
   (`ownerId` → `workspaceId`, a renamed field, a new required field), older records that don't have the new field vanish
   from the app. In the same change, add code that fills in the new field on older records (like `legacy-data.js`), and
   update the Firestore rules so that code is allowed to.
2. **Moving data to a new path hides it too.** If you move where something is stored (like settings moving from
   `users/…` to `workspaces/…`), copy the old data to the new place once, and keep the old copy.
3. **Never replace a whole shared record before it has loaded.** `saveSettings()` in `all-lists/allLists.js` writes
   trades, levels and every folder in one go. Saving before the saved copy has arrived would replace them with the
   defaults and no folders. It now waits for `settingsLoaded`. Prefer `update()` or `set(..., { merge: true })`, which
   only touch the fields you pass.
4. **Write only the fields you mean to change.** A full `set()` also rewrites fields you didn't touch, and the rules may
   refuse it, as happened with assigning tasks.
5. **Deleting is permanent, so everything is archived first.** "Archive this list" and "Archive project" hide things
   and keep all the data. Deleting for good happens only in Settings → Archive, after a confirmation, and the Firestore
   rules refuse to delete a list or project that isn't archived. Keep it that way: don't add a delete button anywhere else.
6. **Test against a copy of real data before pushing.** Run the Firebase emulator with an export of production data, or a
   second Firebase project, and check that existing lists, folders and projects still show.
7. **Publish the rules and the code together.** Code that depends on new rules fails until the rules are published.
   Code that stops depending on old rules can hide data if the rules change first.

## Recovering older data

- **Lists with an owner but no workspace** (made Oct 20–21, 2026): brought back automatically the next time their
  owner opens My Lists or the dashboard. A message says how many came back.
- **Old folders, trades and levels**: added to the workspace once per person (only ones that are missing). Nothing
  already in the workspace changes, and the old copy is kept.
- **Lists with no owner** (made before Oct 20, 2026): no search can find these. Open the list by its old link
  (`allLists.html?job=…`) while signed in, then tap **Move into my workspace**. To find their ids without the links,
  look in the Firebase console → Firestore → `jobs` for documents with no `ownerId`.
- **Lists saved on a phone only**: if Firebase ever failed to load, lists were saved in that phone's browser storage
  (key `punch-app-v1`). They are still on that phone and can be copied up by hand.
8. **Run the data check before and after every push** that touches how data is read or saved:
   `cd tools && node check-data.js`. It lists records the app can't see (no workspaceId, a missing workspace, and so on)
   and warns if any workspace has fewer lists, items, projects or folders than at the last check. Point-in-time recovery
   only goes back 7 days, so a problem has to be caught within a week to be undone minute by minute.
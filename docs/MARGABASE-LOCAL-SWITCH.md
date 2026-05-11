# Margabase Local Switch

Marga-App still defaults to Firebase.

For local testing only, start the Margabase compatibility API:

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/marga-platform"
npm run api:firestore -- --port=8787
```

Then open Marga-App locally and run this in the browser console:

```js
localStorage.setItem('marga_data_backend', 'margabase');
location.reload();
```

To return to Firebase:

```js
localStorage.removeItem('marga_data_backend');
location.reload();
```

The local Margabase API emulates the Firestore REST calls used by the app:

- list documents
- get document
- create/patch/delete document
- basic `:runQuery`

This is a compatibility bridge for testing and migration. Production cutover still requires incremental sync, auth, offline queue conflict handling, storage/photo migration, and module-by-module verification.


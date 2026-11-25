# Sleep Tracker

A Rise-style sleep tracker: sleep debt, energy schedule, and bedtime suggestions.
It runs as a home-screen app on iPhone. Your data stays on the device.

## Put it on your iPhone

1. **Host it (one time).** The app must be served over HTTPS. GitHub Pages is free:
   1. Sign in at https://github.com and create a new **public** repository, e.g. `sleep`.
   2. On the repo page, click **uploading an existing file** and drag in everything
      in this folder: `index.html`, `app.js`, `sleep-core.js`, `styles.css`, `sw.js`,
      `manifest.webmanifest`, and the `icons` folder. Click **Commit changes**.
   3. Go to **Settings > Pages**. Under "Branch", choose `main` and `/ (root)`, then **Save**.
   4. After a minute or two the page shows your URL, like `https://YOUR-NAME.github.io/sleep/`.
   Only the code is public. Your sleep data never leaves your phone.
2. **Install it.** On your iPhone, open that URL in **Safari**, tap the **Share** button,
   then **Add to Home Screen**, then **Add**.
3. Open it from the home-screen icon. It runs full-screen and works offline.

## Backups

Data lives in the app's storage on your phone. Deleting the home-screen app deletes
the data. Use **Settings > Export data > Save to Files** now and then. Use
**Import data** to restore.

## Updating the app

Upload the changed files to the same repo. Also change `CACHE` in `sw.js`
(e.g. `sleep-tracker-v1` to `sleep-tracker-v2`) whenever you add or remove a file.
The phone picks up the update the second time you open the app.

## Tests

Open `tests.html` in a browser to run the calculation tests. It doesn't need to be uploaded.

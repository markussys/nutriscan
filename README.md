# NutriScan

A small web app for following a diet: scan a food's barcode with your phone camera,
see its nutrition facts, and log what you eat against daily calorie and macro goals.

- **Barcode scanning** in the browser ([html5-qrcode](https://github.com/mebjas/html5-qrcode), bundled in `public/vendor/`)
- **Nutrition data** from [Open Food Facts](https://world.openfoodfacts.org), a free, open database. No API key needed.
- **Custom foods** for products that aren't in the database. You enter them once and they're saved.
- **Daily log** by meal, with calorie, protein, carb and fat goals, plus history and 7-day averages
- **Saved meals**: combine your foods with amounts, optionally set the cooked weight, and log a whole dish or a portion (½, ⅓, grams). Tweak amounts each time without changing the saved meal.
- **More nutrients**: saturated fat, fiber, sodium (with a daily limit), potassium, cholesterol and an estimate of natural creatine from meat and fish
- **No backend.** All data stays in your browser (`localStorage`). Export/import a JSON backup in Settings.
- **Installable** as an app (PWA): "Add to Home Screen" on your phone.

Plain HTML/CSS/JS with no build step. Everything the browser needs is in `public/`.

## Run locally with Docker

```bash
docker compose up -d --build
```

- On your PC: <http://localhost:8080>
- On your phone (same Wi-Fi): `https://<your-pc-ip>:8443`
  - Find your IP with `ipconfig` (the "IPv4 Address", e.g. `192.168.1.23`).
  - The certificate is self-signed, so accept the browser warning ("Advanced → Proceed").
    HTTPS is required because browsers only allow camera access on secure pages.
  - If it doesn't load, allow port 8443 through Windows Firewall.

`public/` is mounted into the container, so edits show up on refresh without a rebuild.

Stop it with `docker compose down`.

## Publish on GitHub Pages (free, real HTTPS)

1. Create a new repository on GitHub and push this folder to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "NutriScan"
   git branch -M main
   git remote add origin https://github.com/<you>/nutriscan.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys `public/` automatically.
   The app will be at `https://<you>.github.io/nutriscan/`.
4. Open that link on your phone and choose **Add to Home Screen**.

## Project layout

```
public/            the whole app (what gets served)
  index.html       markup: 4 views + 2 dialogs
  style.css        styles (automatic light/dark mode)
  app.js           all logic: storage, Open Food Facts lookup, scanner, UI
  sw.js            service worker (offline shell / installable)
  manifest.webmanifest
  icons/icon.svg
  vendor/html5-qrcode.min.js
Dockerfile         nginx + self-signed cert
nginx.conf
docker-compose.yml
```

## Notes

- Coverage of Baltic products in Open Food Facts is patchy. When a product is missing, the app
  asks you to enter it from the label. You can also add it on openfoodfacts.org to help others.
- Data is stored per browser and per device. Use **Settings → Export backup** to keep a copy or move to a new phone.

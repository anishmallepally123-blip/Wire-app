# Wire Manifest

A wiring log for an FRC electrical subteam. Pick a wire type, say where it starts
and ends, and it names the wire for you. Everything lands in a Google Sheet the
whole team shares.

## Naming

Names are endpoints only — the type is the color band, the gauge sits to the right.

| Wire | Name |
|---|---|
| PDH port 4 → Front Left Drive | `PDH04-FLD` |
| roboRIO → PDH | `RIO-PDH` |
| roboRIO port 0 → Intake | `RIO00-INTAKE` |

Ports pad to two digits, common devices shorten to what the team already says
(roboRIO → RIO, Pneumatic Hub → PH), and a repeat name gets `-2`, `-3`. Any name
can be overridden by hand.

## Wire types

| Type | Color | Gauge |
|---|---|---|
| 12 AWG Power | red | 12 |
| 22 AWG Power | orange | 22 |
| CAN | green | 22 |
| Ethernet | purple | 24 |
| PWM | blue | 26 |

## Set up the Google Sheet

1. Make a Sheet for the team. Name doesn't matter.
2. **Extensions ▸ Apps Script**, delete the placeholder, paste in `Code.gs`.
3. **Deploy ▸ New deployment ▸ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorize it, then copy the `/exec` URL.
5. Open the app, tap **Connect a sheet**, paste the URL.

The script creates a `Wires` tab on first write. Every add, edit, and delete
writes a row immediately; the app re-reads the sheet every 20 seconds so a wire
logged on the pit laptop shows up on a phone.

Re-deploy as a **new version** any time you edit `Code.gs`, or the app keeps
hitting the old code.

**Access note:** "Anyone" means anyone holding the URL can write. That's fine for
a link you keep inside the team. If you want it locked down, add a shared key
check at the top of `doPost` and send the same key from `src/sheet.js`.

## Run it locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Push this to a GitHub repo, branch `main`.
2. **Settings ▸ Pages ▸ Source: GitHub Actions.**
3. Push. `.github/workflows/deploy.yml` builds and publishes on every commit.

`vite.config.js` uses a relative base, so it works at any Pages path without edits.

## Layout

```
src/WireManifest.jsx   the whole UI
src/sheet.js           the one place that talks to Apps Script
src/store.js           local cache, so the pit works without wifi
Code.gs                paste this into Apps Script
```

Offline, the app keeps working from its local cache and shows a red dot. Once the
sheet is reachable again, the next write pushes through.

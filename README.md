# VaultGrid — a mini password manager

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20(Electron)-lightgrey)

A local, single-user password manager built with Node.js + Express. Every
account password is encrypted at rest with AES-256-GCM, locked behind a
master password. The UI blends Neumorphism / Soft UI (extruded single-tone
surfaces), a Swiss / editorial grid (index numerals, strong rules, mono
labels), and a Bento-style dashboard. It also ships as a real Windows desktop
app via Electron, with a packaged installer.

> **Note:** this is a learning/demo project built to practice encryption,
> Express, and Electron packaging — not an independently audited security
> product. See [Security model](#how-the-encryption-works) below before
> relying on it for anything high-stakes.

<!-- Add a screenshot of the dashboard here once you have one, e.g.: -->
<!-- ![VaultGrid dashboard](docs/screenshot.png) -->

## Features

- Master password gate (set once on first run, bcrypt-verified on login)
- Every saved password encrypted individually with AES-256-GCM, random IV per entry
- Add / edit / delete saved accounts (site, username, password, category, notes)
- Search and category filter
- One-click copy to clipboard (decrypts just-in-time, never sent to the browser otherwise)
- Built-in random password generator + live strength meter
- Session auto-locks after 2 hours or on explicit "Lock vault"

## Requirements

- Node.js 18+ (uses `crypto.randomUUID`, built-in `express.json`)

## Setup

```bash
cd password-manager
npm install
npm start
```

Then open **http://localhost:4300**. On first visit you'll be asked to create
a master password — do that, then you're in. Close the tab and come back
later and you'll need to unlock with the same master password.

## How the encryption works

- Your master password is never stored. On setup we store only a `bcrypt`
  hash of it (for verifying future logins) and a random "key salt".
- On every login, your master password is re-derived into a 256-bit AES key
  via `scrypt` + that stored salt. This key lives only in server memory for
  your session — it is **never** written to disk.
- Each password you save is encrypted individually with AES-256-GCM and a
  fresh random IV before being written to `data/vault.json`. The file itself
  never contains a plaintext password, a derived key, or your master password.
- Restarting the server invalidates all sessions (a new random session secret
  is generated each boot), so you'll simply need to unlock again.

This is a learning/demo project — solid building blocks, but not an audited
security product. Don't use it for anything you can't afford to lose.

## Running it as a Windows desktop app

The project is already set up as an Electron app (`main.js` starts the
Express server internally and opens it in a native window — no browser tab,
no visible terminal once packaged). Do this **on your Windows machine**, with
Node.js 18+ installed:

```powershell
cd password-manager
npm install
npm run electron      # opens VaultGrid as a desktop window, to test it first
npm run dist          # builds a real installer into dist/
```

`npm run dist` produces `dist\VaultGrid Setup 1.0.0.exe` — a normal Windows
installer (built with `electron-builder`) that adds a Start Menu entry and
desktop shortcut, just like any installed app. Double-click it, click
through, and VaultGrid launches as its own window from then on.

**Where your data lives once installed:** `main.js` points the vault at
`%APPDATA%\VaultGrid\data\vault.json` (not inside the install folder), so
your encrypted entries persist across reinstalls or updates.

A couple of things worth knowing:
- The first `npm run dist` download pulls Electron's Windows binaries (~150 MB) — it's building a bundled Chromium + Node runtime, so the installer itself will land around 60–90 MB. That's normal for Electron apps.
- If you'd rather have a single portable `.exe` with no installer wizard, change `"target": "nsis"` to `"target": "portable"` in `package.json`'s `build.win` section before running `npm run dist`.
- `npm start` (plain `node server.js`, no Electron) still works exactly as before if you just want to open it at `localhost:4300` in a regular browser tab.

## Emergency recovery from a backup

If `vault.json` ever gets deleted, corrupted, or you're restoring from a
backup copy, you don't need the full app running to get your passwords
back — `recover.js` decrypts a vault file directly from the command line.

```powershell
cd password-manager
npm install          # only needed once, if you haven't already
node recover.js "C:\path\to\your\backup\vault.json"
```

Leave off the path to read the live vault at `./data/vault.json` instead.
It will ask for your master password (typing is hidden), then print every
site, username, password, category and note to the screen.

To also save everything to a file you can import elsewhere, add `--csv`:

```powershell
node recover.js "C:\path\to\your\backup\vault.json" --csv
```

This writes a `recovered.csv` next to the vault file. **That CSV is plain
text, not encrypted** — move it wherever you need it (e.g. into another
password manager's import tool) and then delete it. A normal delete doesn't
scrub it from disk, so for anything sensitive, overwrite or shred it
afterward rather than just emptying the Recycle Bin.

## Project structure

```
password-manager/
├── main.js                 # Electron entry point: starts server.js, opens the native window
├── server.js              # Express app: auth + encrypted CRUD routes (now requirable, not just runnable)
├── package.json           # includes electron-builder config for the Windows installer
├── data/
│   └── vault.json          # created on first run — encrypted entries live here (dev mode only; see above for installed-app location)
└── public/
    ├── index.html           # single-page app shell (auth + dashboard + modal)
    ├── css/style.css        # Neumorphism + Swiss grid + Bento design system
    └── js/app.js             # fetch calls, rendering, generator, strength meter
```

## Customizing the look

All design tokens (colors, radii, shadows, fonts) live at the top of
`public/css/style.css` under `:root` — tweak the accent color, shadow
intensity, or grid spans there.

## Tech stack

- **Backend:** Node.js, Express, `express-session`
- **Auth / crypto:** `bcryptjs` (master password verification), Node's built-in
  `crypto` module (`scrypt` key derivation, AES-256-GCM encryption)
- **Storage:** a single local JSON file (`data/vault.json`) — no database needed
- **Frontend:** vanilla HTML/CSS/JS, no framework or build step
- **Desktop packaging:** Electron + `electron-builder` (NSIS installer for Windows)

## Contributing

This started as a personal mini-project, but issues and pull requests are
welcome — bug fixes, UI tweaks, or additional features (password export
formats, 2FA, cross-platform packaging) are all fair game.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, learn from it; just don't
assume it's been security-audited (see the note at the top of this README).

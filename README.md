# Fieldnotes / OSCP+

A deliberately small, local-first OSCP+ checklist and command notebook for Kali Linux.

Fieldnotes keeps four things together:

- a phase-based checklist with copy-ready command examples;
- reusable command variables such as `lhost`, `rhost`, ports, domain, user, password, hash, subnet, and wordlist;
- targets, accounts, loot, notes, and plain-text command results;
- a single JSON backup that moves the entire workspace to another machine.

The app has no backend, login, cloud sync, database, rich-text editor, or plugin system. State is stored in browser `localStorage` and can be exported at any time.

## Run on Kali

Node.js 22 is recommended (the project was created with Node 22.23.3).

```bash
git clone <your-repository-url> fieldnotes-oscp
cd fieldnotes-oscp
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite. For a production check:

```bash
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

## Workflow

1. Add a host under **Targets** and choose **Use in commands**.
2. Set `LHOST`, ports, domain, credentials, and the default wordlist in the checklist's **Variables** panel.
3. Work down the checklist. Expand a point to copy its rendered commands.
4. Paste or upload useful text output under that checklist point. Files are limited to 400 KB to protect browser storage.
5. Track reusable accounts and loot under **Findings**.
6. Export a JSON backup from **Backup** at the end of each target and before moving machines.

## Kali assumptions

The checklist prefers a small set of common Kali tools: Nmap, curl, ffuf, NetExec, Impacket, John/Hashcat, Netcat/Socat, and Ligolo-ng. It uses or discovers assets under:

```text
/usr/share/windows-resources
/usr/share/wordlists
/usr/share/seclists
/usr/share/ligolo-ng-common-binaries
```

Exact resource contents can vary with the Kali package snapshot, so commands that stage helper binaries use `find` before assuming a filename.

## Data and security

Passwords, hashes, notes, and results are stored as plain text in browser storage and in exported JSON. This is an exam notebook, not a password manager. Lock the workstation, protect backups, and reset the workspace when the data is no longer needed.

If the browser reports a storage error, export a backup and remove large saved results. Keep large binaries, screenshots, and full scan archives in `~/oscp/<target>/`; save only useful excerpts or paths in the app.

## Customize the methodology

Checklist content lives in [`src/data/checklist.js`](src/data/checklist.js). Each item has a stable ID, a title, optional detail, and one or more commands. Variables use `{{name}}` placeholders and are resolved in the browser.

Keep additions focused on repeatable decisions and commands you will actually use. The local `drgoteee.github.io/` checkout is ignored by Git and is reference material only.

## Scope and authorization

Use these commands only against systems you own or are explicitly authorized to assess. Always follow the current OSCP exam guide and restrictions supplied by OffSec; the app intentionally does not try to encode policy that may change.

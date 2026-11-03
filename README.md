# Fieldnotes / OSCP+

A deliberately small, local-first OSCP+ checklist and command notebook for Kali Linux.

Fieldnotes keeps four things together:

- a phase-based checklist with copy-ready command examples;
- reusable command variables such as `lhost`, `rhost`, ports, domain, user, password, hash, subnet, and wordlist;
- machine-scoped endpoints, accounts, loot, notes, command output, and screenshots;
- an OSCP-style machine report with the complete workspace and evidence embedded for later restoration.

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

If Vite reports that it cannot resolve `pdf-lib` after pulling newer commits, stop the development server, run `npm install` (or `npm ci` for a clean install), and restart it. The PDF dependency is recorded in both `package.json` and `package-lock.json`; an older `node_modules` directory is the usual cause.

## Workflow

1. Add a box under **Machines** with its initial IP. The machine name is the stable folder name, such as `/home/kali/oscp/active/`.
2. Add or select endpoints inside that machine. Parsed IP addresses and hostname/IP pairs are attached automatically; changing endpoints never creates another machine folder.
3. Set `LHOST`, ports, domain, credentials, and the default wordlist in the checklist's **Variables** panel.
4. Work down the checklist. Copying a command records the exact rendered command, endpoint, and time for the final report.
5. Paste, upload, or drag command output onto the item. The global evidence inbox routes common Nmap, SMB, Kerberos, web, and proof files automatically.
6. Review parsed ports, domains, credentials, hashes, tickets, endpoints, and copied commands under **Findings**.
7. Fill in the operator profile under **Report** once (name, OSID, GitHub, photo — shared by every machine), attach user and root/Administrator proof screenshots, write the short narrative, and generate the machine PDF.
8. Import that PDF on another machine to restore the full workspace. JSON export remains available as a fallback under **Backup**.

The PDF has a cover page, clickable contents and bookmarks, and a header on every page with your circular profile photo, name, OSID, and linked GitHub profile. Commands and output appear as dark terminal blocks that keep ANSI colors (16/256/truecolor), Unicode box drawing, and emoji. Save output with colors intact (for example `nxc ... | tee out.log`, or `script -q out.log`) to keep them. Fonts ship with the app (DejaVu), so export works offline. Emoji are drawn with the system color-emoji font (`fonts-noto-color-emoji` on Kali). CJK text is not covered by the bundled fonts.

The exam clock in the top bar counts down the exam window and then the report deadline. Its start time and length are editable and saved with the workspace. Press `/` on the checklist to jump to search.

A checklist item requires a pasted or uploaded result before it can be marked complete. A short note describing a failed or empty result is enough; the goal is to preserve what was actually tested.

TCP and UDP ports are tracked separately and accumulated across scan files. Nmap `open` and `open|filtered` UDP results populate `UDP PORT(S)`, and the focused UDP command automatically uses that list.

The bounded spray check builds target-scoped username, password, and NT-hash files from Findings. It provides one-password, discovered-secret, and limited-rockyou NetExec variants with jitter and saved logs. Review lockout policy before using anything beyond a single candidate password.

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

Passwords, hashes, notes, and results are stored as plain text in browser storage, exported JSON, and the PDF's embedded workspace. This is an exam notebook, not a password manager. Lock the workstation, protect reports and backups, and reset the workspace when the data is no longer needed.

If the browser reports a storage error, export a backup and remove large saved results. Text files are limited to 1 MB and screenshots/files to 3 MB. Keep large binaries and full scan archives in `/home/kali/oscp/<machine>/`; save useful excerpts or paths in the app.

## Customize the methodology

Checklist content lives in [`src/data/checklist.js`](src/data/checklist.js). Each item has a stable ID, a title, optional detail, and one or more commands. Variables use `{{name}}` placeholders and are resolved in the browser.

Keep additions focused on repeatable decisions and commands you will actually use. The local `drgoteee.github.io/` checkout is ignored by Git and is reference material only.

## Scope and authorization

Use these commands only against systems you own or are explicitly authorized to assess. Always follow the current OSCP exam guide and restrictions supplied by OffSec; the app intentionally does not try to encode policy that may change.

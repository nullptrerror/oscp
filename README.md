# Fieldnotes / OSCP+

A deliberately small, local-first OSCP+ checklist and command notebook for Kali Linux.

Fieldnotes keeps four things together:

- a phase-based checklist with copy-ready command examples;
- reusable command variables such as `lhost`, `rhost`, ports, domain, user, password, hash, subnet, and wordlist;
- machine-scoped endpoints, accounts, loot, notes, command output, and screenshots;
- an OSCP-style machine report with the complete workspace and evidence embedded for later restoration.

The exam-time application is deterministic and fully offline. It has no AI runtime, chatbot, prompt field, cloud API, exploit selector, scan-to-exploit path, or automatic credential chain. Every attack-relevant action is a separately reviewed command card initiated by the operator.

The static app has no login, cloud sync, database, rich-text editor, or plugin system. State is stored in browser `localStorage` and can be exported at any time. An optional localhost-only companion server can execute checklist commands in a real PTY on Kali while preserving the same static build.

## Run on Kali

Node.js 22 is recommended (the project was created with Node 22.23.3).

```bash
git clone <your-repository-url> fieldnotes-oscp
cd fieldnotes-oscp
npm ci
npm run dev:local
```

Open the local URL printed by Vite. The top bar should report **Runner**, and the checklist shows whether the small Kali tool set is present. Commands gain an interactive **Run in terminal** action. For a production-style local run:

```bash
npm test
npm run build
npm run serve:local
```

The local server binds only to `127.0.0.1` and permits working directories only beneath `/home/kali/oscp`. Override that root only when needed with `FIELDNOTES_WORKSPACE_ROOT=/another/path npm run serve:local`.

For static hosting, use `npm run build` and publish `dist/`. The app automatically falls back to paste/upload mode when the local runner is absent. `npm run dev` also starts the ordinary static development mode without command execution.

If Vite reports that it cannot resolve `pdf-lib` after pulling newer commits, stop the development server, run `npm install` (or `npm ci` for a clean install), and restart it. The PDF dependency is recorded in both `package.json` and `package-lock.json`; an older `node_modules` directory is the usual cause.

## Workflow

1. Add a box under **Machines** with its initial IP. Fieldnotes assigns a unique filesystem-safe folder slug, such as `/home/kali/oscp/active/`, separately from the display name.
2. Add or select endpoints inside that machine. Parsed IP addresses and hostname/IP pairs remain endpoint-bound candidates until you confirm them; changing endpoints never creates another machine folder.
3. Set `LHOST`, the filesystem-safe target slug, TCP/UDP collections, selected service/web endpoint, domain context, and the default wordlist in the checklist's **Variables** panel. Select one saved credential explicitly before credential-derived cards are rendered.
4. Work down the checklist. Each command has its own result area. Copying records the rendered command; running locally opens an interactive PTY for `sudo`, SSH, WinRM, and similar tools.
5. A local run writes a dedicated log beneath `notes/commands/`, appends the complete journey to `notes/terminal.log`, and saves the captured result to that command. Exit code zero never completes a check or proves a hypothesis. Classify each command and its parent check explicitly as **finding confirmed**, **no finding**, **command failed**, **blocked**, or **needs review**.
6. Review parser-extracted ports, domains, credentials, hashes, tickets, endpoints, and proof values under **Findings**. They remain unverified candidates and cannot affect variables or command generation until you confirm them.
7. Fill in the operator profile under **Report** once (name, OSID, GitHub, photo — shared by every machine), attach user and root/Administrator proof screenshots, write the short narrative, and generate the machine PDF.
8. Import that PDF on another machine to restore the full workspace. JSON export remains available as a fallback under **Backup**.

The PDF has a cover page, clickable contents and bookmarks, and a header on every page with your circular profile photo, name, OSID, and linked GitHub profile. Commands and output appear as dark terminal blocks that keep ANSI colors (16/256/truecolor), Unicode box drawing, and emoji. Save output with colors intact (for example `nxc ... | tee out.log`, or `script -q out.log`) to keep them. Fonts ship with the app (DejaVu), so export works offline. Emoji are drawn with the system color-emoji font (`fonts-noto-color-emoji` on Kali). CJK text is not covered by the bundled fonts.

The exam clock in the top bar counts down the exam window and then the report deadline. Its start time and length are editable and saved with the workspace. Press `/` on the checklist to jump to search.

A checklist item requires saved evidence before it can be classified as finding-confirmed or no-finding. Failed, blocked, and needs-review states remain incomplete so uncertainty is visible.

TCP and UDP ports are tracked separately and accumulated across scan files. Nmap `open` and `open|filtered` UDP results populate `UDP PORT(S)`, and the focused UDP command automatically uses that list.

The bounded credential check uses only the one credential explicitly selected for the active machine, with jitter and saved logs. It does not combine or spray every stored secret. Review and confirm lockout policy before any multi-user authentication attempt.

## Exam-safety boundary

The in-app **Exam safety** page records `rules_last_verified: 2026-11-17` and links directly to the current official Exam Guide, FAQ, AI policy, Body of Knowledge, and reporting requirements. Official current policy controls; Fieldnotes is not OffSec approved and does not guarantee compliance or an exam result.

Conservative safeguards include:

- prohibited or policy-verification cards are instructional and cannot be copied or run in exam-safe mode;
- Metasploit/Meterpreter is kept outside the core workflow, including its one-selected-target commitment and no-pivot rule;
- spoofing, poisoning, automatic exploitation, mass vulnerability scanning, automatic proof submission, and runtime AI are not implemented;
- proof values remain visible candidates until the operator verifies the interactive shell, original path, identity, target IP, screenshot, and manual control-panel submission;
- Daybreak and any AI-assisted development are pre-exam activities only. Do not use an AI assistant during the exam or reporting period.

The supplied PWK V3 study table is reconciled without walkthroughs: 208 raw rows (204 machine rows plus four resource rows), 204 grouped coverage records, 200 machine presets, and 189 normalized machine names. Core, legacy, post-OSCP, enterprise, and study-only scope are visibly separated. Every record has a traceable methodology/scope mapping; machine-specific public technique research remains explicitly unresolved unless a spoiler-safe source is actually reviewed.

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

Passwords, hashes, commands, terminal logs, notes, and results are stored as plain text on disk and/or in browser storage, exported JSON, and the PDF's embedded workspace. This is an exam notebook, not a password manager. The runner deliberately executes the exact rendered shell command you select; keep it bound to localhost, review each command, lock the workstation, and protect reports and backups.

If the browser reports a storage error, export a backup and remove large saved results. Text files are limited to 1 MB and screenshots/files to 3 MB. Keep large binaries and full scan archives in `/home/kali/oscp/<machine>/`; save useful excerpts or paths in the app.

## Customize the methodology

Checklist content lives in [`src/data/checklist.js`](src/data/checklist.js). Each command is normalized into a stable structured record containing its purpose, execution host, applicability facts, prerequisites, typed variables, expected positive/negative signals, manual branches, risk, state change, evidence, verification, cleanup, fallback, and policy classification. Typed placeholders are validated and shell-quoted before copy or execution.

Keep additions focused on repeatable decisions and commands you will actually use. The local `drgoteee.github.io/` checkout is ignored by Git and is reference material only.

## Scope and authorization

Use these commands only against systems you own or are explicitly authorized to assess. Always follow the current OSCP exam guide and restrictions supplied by OffSec; the app intentionally does not try to encode policy that may change.

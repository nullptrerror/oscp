Implement—not merely propose—a production-quality upgrade of the OSCP Fieldnotes repository.

Repository:
- Local checkout: /home/kali/localgit/oscp
- Remote reference: https://github.com/nullptrerror/oscp
- Supplied PWK V3 practice-box list:
  /home/kali/.codex/attachments/3f1f9f73-c334-47b5-acbf-ba5dbc2cd5d2/Pasted text.txt

MISSION

Transform Fieldnotes into a concise, offline-first, operator-driven OSCP+ checklist and command notebook that:

1. Covers the reusable PEN-200/OSCP+ techniques needed across the supplied practice-box corpus.
2. Produces exact, reviewable command templates using typed variables.
3. Prefers commands launched from the Kali/LHOST machine.
4. Provides complete, ordered pivot sequences when LHOST cannot directly reach a target.
5. Preserves evidence and reproducible reporting.
6. Remains conservative about OffSec’s automation restrictions.
7. Does not depend on an LLM, cloud service, or internet API at exam runtime.

Do not promise that the application can solve every box or guarantee exam compliance. The measurable objective is complete, traceable technique coverage with no silently unmapped boxes or unsupported claims.

CRITICAL EXAM-SAFETY BOUNDARY

Daybreak is a pre-exam development tool only. Never design or document Daybreak as something to use during the exam or reporting period. The completed application must work fully offline without AI.

Before editing, re-check the current official sources and record a `rules_last_verified` date:

- https://help.offsec.com/hc/en-us/articles/360040165632-OSCP-Exam-Guide
- https://help.offsec.com/hc/en-us/articles/4412170923924-OSCP-Exam-FAQ
- https://help.offsec.com/hc/en-us/articles/35549468971156-AI-Usage-Policy-in-OffSec-Exams
- https://help.offsec.com/hc/en-us/articles/38543335188756-OSCP-Body-of-knowledge
- https://help.offsec.com/hc/en-us/articles/360046787731-OSCP-Reporting-Requirements

Treat official current policy as controlling. Do not label the repository “OffSec approved.”

The exam-safe application must not:

- contain runtime AI, a chatbot, prompt box, Copilot-like assistance, or external AI calls;
- ingest or send exam IPs, output, screenshots, credentials, findings, or reports to an LLM;
- automatically select, modify, or execute exploits;
- implement scan-to-exploit pipelines or a “solve target” button;
- automatically chain credential reuse, lateral movement, privilege escalation, or pivoting;
- run unattended attacks against multiple hosts;
- use prohibited automatic exploitation or mass-vulnerability scanning functionality;
- perform spoofing, poisoning, or prohibited Responder behavior;
- submit proof values automatically;
- hide restricted functionality behind an otherwise allowed tool.

Keep actions operator initiated, one visible command at a time. Benign shell pipelines used to format or save one command’s output are acceptable, but attack-relevant state changes must be separate, visible steps.

EXISTING APPLICATION

Preserve and improve the current React/Vite architecture rather than rewriting it. It currently includes:

- a localhost-only PTY runner;
- checklist phases and variable substitution;
- machine-scoped endpoints, accounts, evidence, output, and reports;
- offline browser storage and import/export;
- PDF reporting;
- output parsing and deterministic command builders;
- 137 practice-box entries;
- a passing Node test suite.

Preserve localhost binding, workspace-root confinement, offline operation, existing data, PDF restoration, and stable IDs. Add workspace migrations if the data model changes.

Audit these existing behaviors carefully in the exam-safe design:

- parsed output automatically populating variables, users, accounts, and endpoints;
- `guidanceForDiscoveries` suggesting subsequent checks;
- credential-derived command builders;
- the first unfinished item being presented as the next action;
- exit status zero automatically completing a checklist item;
- automatic flag detection.

Neutral fact extraction may remain, but extracted facts must be shown as unverified candidates and require operator confirmation before they affect command generation. Do not infer an exploit path from output. Exit code zero must not mean that a hypothesis was proven.

Use explicit result states such as:

- finding confirmed;
- no finding;
- command failed;
- blocked;
- needs review.

Completion must require operator confirmation or a deliberately narrow, tested rule.

PRACTICE-BOX COVERAGE

The supplied table contains approximately 204 raw entries and 189 normalized unique names across HTB, PG Practice, PG Play, Vulnlab, Active Directory sets, chains, Post-OSCP material, and ProLabs. The existing repository contains only part of this catalog.

Parse and reconcile the entire supplied list. Normalize by provider, category, platform, and box name while retaining the raw source entry. Handle duplicates and conflicting categories explicitly.

Build a spoiler-safe coverage manifest. For each box, research only public, legitimate practice-box sources and map it to reusable technique IDs such as:

- exposed services and protocols;
- initial-access class;
- web weakness class;
- public-exploit adaptation requirements;
- Linux or Windows privilege-escalation class;
- AD relationship or authentication technique;
- assumed-breach starting state;
- pivot requirements;
- legacy OS, crypto, architecture, or tooling constraints.

Do not store flags, passwords, target IPs, box-specific payloads, answer keys, or walkthrough steps. Use box research to validate generic checklist coverage, not to reproduce solutions. Record source URLs and confidence. If a technique cannot be substantiated, mark it unresolved rather than inventing it.

Separate:

- core OSCP+/PEN-200 scope;
- optional or legacy study material;
- Post-OSCP, ProLab, enterprise, and multi-host chain material.

Every supplied entry must be accounted for, but advanced entries must not bloat or misrepresent the core exam checklist.

COMMAND DATA CONTRACT

Refactor checklist commands into structured, testable records. Each runnable command or sequence step must include:

- stable ID and title;
- purpose;
- `runsOn`: `lhost`, `foothold-linux`, `foothold-windows`, or `pivot`;
- applicability predicates;
- prerequisites;
- typed required variables;
- exact rendered command;
- expected positive signal;
- expected negative or failure signal;
- positive and negative manual branches;
- risk and state-change classification;
- evidence to preserve;
- side effects or noise;
- verification command;
- cleanup or rollback command when applicable;
- fallback;
- policy classification: `exam-core`, `restricted`, `prohibited`, `study-only`, or `verify-current-policy`.

The UI must visibly display `RUN ON`, prerequisites, risk, expected result, and cleanup.

Replace undeclared placeholders such as `FILE`, `HASH_MODE`, `EXPLOIT_ID`, `EXPLOIT_FILE`, `/EXPORT`, and `/path/to/...` with declared, validated variables. If an example cannot be safely rendered, mark it instructional and disable execution.

Separate display names from filesystem-safe slugs. Harden shell rendering and test spaces, parentheses, apostrophes, `$`, semicolons, Unicode, and hostile-but-valid values. Do not concatenate unvalidated values into shell syntax.

Fix overloaded variables such as `rport`, which is currently used both as a port list and a single web port. Introduce typed context such as:

- target host and target slug;
- TCP and UDP port collections;
- selected service endpoint;
- scheme, web port, vhost, and base URL;
- domain, realm, DC hostname, DC IP, and DNS server;
- username, credential type, and explicitly selected credential;
- LHOST/interface/listener port;
- pivot host, pivot user, pivot interface, proxy port;
- internal host and internal subnet;
- callback host as seen by the target.

LHOST-FIRST WORKFLOW

Prefer Kali-side clients over uploading enumeration utilities. A target-side command is appropriate only when it inherently requires execution on the target, such as local privilege enumeration, shell stabilization, proof collection, or starting a pivot agent.

When target-side execution is unavoidable, show:

1. why it is required;
2. the smallest required file or command;
3. staging from LHOST;
4. integrity/checksum verification when a file is transferred;
5. execution;
6. evidence capture;
7. cleanup.

Do not add runtime downloads to the exam workflow when a pre-exam tool inventory or packaged Kali resource can be used.

PIVOTING

Implement complete, manually operated pivot playbooks, not an autonomous pivoter. Cover direct access, one pivot, and two pivots where justified.

Include ordered and separately confirmable steps for:

- LHOST proxy or tunnel startup;
- pivot-agent discovery or minimal staging;
- pivot-side agent startup;
- session selection and tunnel activation;
- route creation;
- route and reachability verification;
- DNS considerations;
- scanning and enumeration from LHOST through the route;
- proxy-unfriendly protocols;
- listener and reverse-forward direction;
- SSH local, remote, and dynamic forwarding;
- Ligolo-ng as the primary routed workflow;
- a concise SSH/Chisel/Socat fallback where appropriate;
- multi-hop route ownership;
- teardown, route removal, process cleanup, and transferred-file cleanup.

Every step must identify the host on which it runs. Explain callback direction clearly. Never hide the sequence in a one-click script.

DETERMINISTIC DECISION SUPPORT

Build a local deterministic applicability engine, not an adaptive solver.

The operator should manually confirm facts such as platform, service, credential, reachability, route, and privilege context. The application may then rank a small set of applicable pre-authored command cards and explain why they match.

It must not:

- choose an exploit;
- execute the next card automatically;
- create a credential-driven attack chain;
- interpret arbitrary output as proof of vulnerability;
- turn all saved credentials into an automatic spray or reuse operation.

Keep suggestions concise: the smallest useful validation command first, then at most a few relevant fallbacks. Avoid a giant command dump.

OSCP-RELEVANT CONTENT

Use the current official Body of Knowledge as the core scope. Ensure concise reusable branches for:

- workspace setup, VPN/interface checks, logging, evidence, and tool preflight;
- complete TCP discovery, focused service scans, justified UDP checks, DNS and hostname dependencies;
- FTP, SSH, SMTP, DNS, HTTP/S, SMB/RPC, LDAP, NFS, SNMP, RDP, WinRM, and common database/application services;
- virtual hosts, APIs, traversal/file inclusion, uploads, command injection, access control, XSS, and manual SQL injection;
- public-exploit research, source inspection, architecture checks, compilation, parameter replacement, and troubleshooting;
- credential identification, cracking, deliberate reuse, lockout-policy review, and bounded manual spraying;
- Linux sudo, SUID, capabilities, cron/systemd, permissions, secrets, backups, groups, mounts, containers, and kernel checks as a last resort;
- Windows services, unquoted paths, writable binaries/directories, tasks, privileges, stored credentials, PowerShell history, installer policy, registry, DLL search order, and local groups;
- AD DNS/time setup, users/groups/policy/shares, AS-REP roasting, Kerberoasting, BloodHound, remote administration, pass-the-hash, ACLs, group control, DCSync, delegation, AD CS, trusts, and appropriate cleanup;
- assumed-breach starts and multi-host AD chains;
- proof collection and reproducible reporting.

Keep legacy buffer-overflow and advanced Post-OSCP material in clearly separated study appendices unless it is present in the current official core scope.

POLICY PRESENTATION

Add a dated exam-safety page with direct official links. Classify actions, not merely tool names.

Conspicuously document:

- prohibited automatic exploitation and mass-scanner functionality;
- prohibited spoofing and poisoning;
- AI prohibition during exam and reporting;
- Metasploit/Meterpreter’s one-selected-target limitation;
- the fact that even a failed module/check attempt commits that selected target;
- the prohibition on using Metasploit for pivoting;
- proof and screenshot requirements;
- the need to confirm ambiguous functionality with OffSec before the exam.

Keep Metasploit exploitation outside the core workflow. If any restricted command is retained for study, it must never appear as a normal exam-safe recommendation.

REPORTING

Preserve exact commands, timestamps, target scope, relevant output, conclusions, and cleanup. Keep report generation deterministic and offline; do not add AI-authored narratives.

Proof guidance must require the learner to:

- obtain proof in an interactive shell;
- read it from its original location;
- show the proof value and target IP context together;
- save the screenshot;
- manually submit the value before exam time ends.

Do not automatically submit or silently hide proof terminals.

IMPLEMENTATION AND TESTING

Add focused automated tests for:

- every supplied box being accounted for;
- every researched technique mapping to a reusable checklist entry or explicit appendix/out-of-scope record;
- no undeclared or magic placeholders;
- stable and unique IDs and command keys;
- typed variable validation and shell-safe rendering;
- command execution-side labels;
- policy classifications;
- state-changing commands having warning, verification, and cleanup;
- conservative result-state handling;
- no automatic exploit or chained attack runner;
- no prohibited commands being runnable in exam-safe mode;
- credential commands requiring an explicitly selected credential;
- one-target scoping;
- pivot route direction, one-hop and two-hop sequences, verification, and teardown;
- import/export and workspace migration compatibility.

Required validation gates:

- `npm test`
- `npm run build`
- `git diff --check`
- all static and dynamically generated commands pass the command-policy audit;
- no unresolved runnable placeholders;
- no runtime AI or external service dependency;
- no unrelated regressions.

WORKING RULES

- Inspect `git status` before editing and preserve unrelated user changes.
- Work incrementally and keep the existing stack unless a change is necessary.
- Do not commit, push, publish, or change the remote.
- Do not add box-specific spoilers or leaked exam material.
- Do not stop after an audit or proposal: implement, test, and refine the repository.
- If evidence is unavailable, record the limitation instead of guessing.
- Ask for input only if missing access or a decision would materially change scope.

FINAL HANDOFF

When complete, report:

1. files and behavior changed;
2. technique and box coverage statistics;
3. unresolved coverage with reasons;
4. exam-safety decisions and dated official sources;
5. commands/tests run and their results;
6. remaining risks or items that require confirmation from OffSec.

The terminal condition is a working, tested, offline application that offers concise, operator-selected, LHOST-first command guidance and explicit manual pivot sequences while preserving a clear boundary against autonomous exploitation.
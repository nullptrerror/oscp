/*
 * Spoiler-safe reconciliation of the supplied PWK V3 practice list.
 *
 * RAW_PRACTICE_ENTRIES is an accounting ledger: every non-heading machine/lab
 * cell from the supplied table appears once, including repeated cells.
 * PRACTICE_BOXES is the UI catalog: exact repeats inside the same provider and
 * category are folded together while rawEntryIds preserve provenance.
 *
 * Platform baselines describe which Fieldnotes methodology is relevant to a
 * category. They are not claims about a particular machine's solution. A
 * machine-specific technique is recorded only when the source entry says so;
 * otherwise the coverage record remains explicitly unresolved.
 */

export const PRACTICE_LIST_META = Object.freeze({
  id: "tjnull-pwk-v3-2026-07-18",
  title: "PWK V3 List",
  curator: "Tj Null",
  sourceUpdated: "2026-07-18",
  importedFrom: "Supplied local attachment: Pasted text.txt",
  disclaimer: "A study aid, not a substitute for PEN-200 labs and not a guarantee of an exam result.",
});

const sections = [
  {
    source: "htb", category: "Linux", platform: "linux", scope: "exam-core", names: [
      "Busqueda", "UpDown", "Sau", "Help", "Broker", "Intentions", "Soccer", "Keeper", "Monitored", "BoardLight", "Networked", "CozyHosting", "Editorial", "Magic", "Pandora", "Builder", "LinkVortex", "Dog", "Markup", "Editor", "Usage", "Titanic", "Outbound [Assumed Breach Box]", "Editor", "Expressway [Old System]", "Browsed",
    ],
  },
  {
    source: "htb", category: "Windows", platform: "windows", scope: "exam-core", names: [
      "Escape", "Servmon", "Support", "StreamIO", "Blackfield", "Intelligence", "Jeeves", "Manager", "Access", "Aero", "Mailing", "Administrator", "Certified", "Heist", "Tombwatcher (Assumed Breach Box)",
    ],
  },
  {
    source: "htb", category: "Active Directory", platform: "ad", scope: "exam-core", names: [
      "Active", "Forest", "Sauna", "Monteverde", "Timelapse", "Return", "Cascade", "Flight", "Blackfield", "Cicada", "Escape", "Adagio (HTB Enterprise Box)", "TheFrizz", "Fluffy", "Puppy", "Voleur", "Signed [Assumed Breach]", "Eighteen [Assumed Breach]",
    ],
  },
  {
    source: "htb", category: "Post OSCP", platform: "unknown", scope: "post-oscp", names: [
      "Mentor [Linux]", "Absolute [Windows]", "Outdated [Windows]", "Atom [Windows]", "APT [Windows]", "Aero [Windows]", "Cerberus [Windows/Linux]", "Multimaster [Windows]", "Cereal [Linux]", "Quick [Linux]", "Authority [Windows]", "Clicker [Linux]", "Rebound [Windows]", "Mailing [Windows]", "Vintage [Windows]", "EscapeTwo [Windows]", "Tombwatcher[Windows Active Directory]", "Rustykey [Timeroasting attack]", "DarkZero [Assumed Breach]",
    ],
  },
  { source: "htb", category: "ProLab", platform: "mixed", scope: "enterprise-chain", names: ["Dante", "RastaLabs"] },
  { source: "htb", category: "Post OSCP ProLab", platform: "mixed", scope: "post-oscp", names: ["Zephyr", "Alchemy"] },
  {
    source: "pg-practice", category: "Linux", platform: "linux", scope: "exam-core", names: [
      "Twiggy", "Exfiltrated", "Pelican", "Astronaut", "Blackgate", "Boolean", "Clue", "Cockpit", "Codo", "Crane", "Levram", "Extplorer", "Hub", "Image", "law", "Lavita", "PC", "Fired", "Press", "Scrutiny", "RubyDome", "Zipper", "Flu", "Workaholic", "PyLoader", "Plum", "SPX", "Jordak", "BitForge", "Vmdak", "Ochima", "Nibbles", "CVE-2023-6019", "Sea", "Payday", "Snookums", "SpiderSociety",
    ],
  },
  {
    source: "pg-practice", category: "Windows", platform: "windows", scope: "exam-core", names: [
      "Algernon", "Authby", "Craft", "Hutch", "Internal", "Jacko", "Kevin", "Resourced", "Squid", "DVR4", "Hepet", "Shenzi", "Nickel", "Slort", "MedJed", "Monster", "Mice",
    ],
  },
  { source: "pg-practice", category: "Active Directory", platform: "ad", scope: "exam-core", names: ["Access", "Heist", "Vault", "Nagoya", "Nagoya", "Resourced", "Hutch"] },
  {
    source: "pg-practice", category: "Post OSCP", platform: "unknown", scope: "post-oscp", names: [
      "Nagoya [Windows]", "Osaka [Windows]", "ProStore [Linux]", "RPC1 [Linux]", "Symbolic [Windows]", "Upsploit [Linux]", "Validator [Linux]", "GLPI [Linux]", "Marshalled [Linux]", "Educated [Linux]", "Kyoto [Windows Buffer Overflow]", "Nara [Windows Active Directory]",
    ],
  },
  {
    source: "pg-play", category: "Linux", platform: "linux", scope: "exam-core", names: [
      "Election 1", "Stapler", "Monitoring", "InsanityHosting", "Vegeta 1", "SoSimple", "Gaara", "Amaterasu", "Blogger", "Potato", "DC-9", "Tre", "Seppuku", "Funbox", "Katana", "DriftingBlue6", "Loly", "Blogger", "Stapler", "Sams [Windows]", "BTRSys2.1",
    ],
  },
  { source: "vulnlab", category: "Linux", platform: "linux", scope: "exam-core", names: ["Data", "Feedback", "Sync", "Forgotten", "Build", "Bamboo", "Dump"] },
  { source: "vulnlab", category: "Windows", platform: "windows", scope: "exam-core", names: ["Media", "Job", "Job2", "Lock", "Escape", "Bruno"] },
  { source: "vulnlab", category: "Active Directory", platform: "ad", scope: "exam-core", names: ["Baby", "Baby2", "Breach", "Sweep", "Sendai", "Phantom", "Hybrid (Chain)", "Trusted(Chain)", "Lustrous (Chain)", "Reflection(Chain)"] },
  { source: "vulnlab", category: "Post OSCP", platform: "unknown", scope: "post-oscp", names: ["Race [Linux]", "Kaiju [Chain]", "Push [Chain]", "Intercept [Chain]", "Zero"] },
  {
    source: "other-labs", category: "Other Labs", platform: "mixed", scope: "study-only", names: [
      "GOAD: https://github.com/Orange-Cyberdefense/GOAD/tree/main",
      "VulnAD: https://github.com/tjnull/OSCP-Stuff/tree/master/Active-Directory",
      "Ludus: https://gitlab.com/badsectorlabs/ludus",
      "Tj Null Active Directory box: https://github.com/tjnull/OSCP-Stuff/tree/master/Active-Directory",
    ],
  },
];

const SOURCE_META = Object.freeze({
  htb: { label: "Hack The Box", url: "https://app.hackthebox.com/machines", labType: "htb" },
  "pg-practice": { label: "Proving Grounds Practice", url: "https://portal.offsec.com/labs/play", labType: "oscp" },
  "pg-play": { label: "Proving Grounds Play", url: "https://portal.offsec.com/labs/play", labType: "oscp" },
  vulnlab: { label: "VulnLab / Hack The Box", url: "https://app.hackthebox.com/vulnlab", labType: "htb" },
  "other-labs": { label: "Other labs", url: "https://github.com/Orange-Cyberdefense/GOAD", labType: "oscp" },
});

export const SOURCE_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(SOURCE_META).map(([id, value]) => [id, value.label]),
));

const slug = (value) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const annotationTags = (rawEntry) => {
  const value = rawEntry.toLowerCase();
  return [
    value.includes("assumed breach") && "assumed-breach",
    value.includes("old system") && "legacy-os",
    value.includes("enterprise") && "enterprise",
    value.includes("chain") && "multi-host-chain",
    value.includes("buffer overflow") && "memory-corruption",
    value.includes("timeroasting") && "time-roasting",
  ].filter(Boolean);
};

const canonicalName = (rawEntry) => rawEntry
  .replace(/:\s*https?:\/\/\S+\s*$/i, "")
  .replace(/\s*\[(?:Assumed Breach(?: Box)?|Old System|Linux|Windows|Windows\/Linux|Windows Active Directory|Windows Buffer Overflow|Timeroasting attack|Chain)\]\s*/gi, " ")
  .replace(/\s*\((?:Assumed Breach Box|HTB Enterprise Box|Chain)\)\s*/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const platformFor = (section, rawEntry) => {
  if (/windows active directory/i.test(rawEntry)) return "ad";
  if (/windows\/linux/i.test(rawEntry)) return "mixed";
  if (/\[linux\]/i.test(rawEntry)) return "linux";
  if (/\[windows(?: buffer overflow)?\]/i.test(rawEntry)) return "windows";
  if (section.source === "other-labs" && /goad|vulnad|active directory/i.test(rawEntry)) return "ad";
  return section.platform;
};

const categoryFor = (section, rawEntry) => (
  section.source === "pg-play" && /\[windows\]/i.test(rawEntry) ? "Windows" : section.category
);

const scopeFor = (section, tags) => {
  if (tags.includes("legacy-os") || tags.includes("memory-corruption")) return "optional-legacy";
  if (tags.includes("enterprise") || (tags.includes("multi-host-chain") && section.scope === "exam-core")) return "enterprise-chain";
  return section.scope;
};

const entryUrl = (rawEntry, source) => rawEntry.match(/https?:\/\/\S+/)?.[0] || SOURCE_META[source].url;

let rawOrdinal = 0;
export const RAW_PRACTICE_ENTRIES = Object.freeze(sections.flatMap((section) => section.names.map((rawEntry) => {
  rawOrdinal += 1;
  const tags = annotationTags(rawEntry);
  const category = categoryFor(section, rawEntry);
  const platform = platformFor(section, rawEntry);
  const conflicts = [];
  if (category !== section.category) conflicts.push(`Source column says ${section.category}; entry annotation says ${category}.`);
  return Object.freeze({
    rawId: `pwkv3-${String(rawOrdinal).padStart(3, "0")}`,
    rawEntry,
    name: canonicalName(rawEntry),
    source: section.source,
    provider: SOURCE_META[section.source].label,
    rawCategory: section.category,
    category,
    rawPlatform: section.platform,
    platform,
    scope: scopeFor(section, tags),
    tags: Object.freeze(tags),
    sourceUrl: entryUrl(rawEntry, section.source),
    conflicts: Object.freeze(conflicts),
  });
})));

export const RAW_MACHINE_ENTRIES = Object.freeze(RAW_PRACTICE_ENTRIES.filter((entry) => entry.source !== "other-labs"));
export const LAB_RESOURCE_ENTRIES = Object.freeze(RAW_PRACTICE_ENTRIES.filter((entry) => entry.source === "other-labs"));

const globalMachineNames = new Map();
for (const entry of RAW_MACHINE_ENTRIES) {
  const key = entry.name.toLocaleLowerCase("en-US");
  const current = globalMachineNames.get(key) || [];
  current.push(entry);
  globalMachineNames.set(key, current);
}

export const NORMALIZED_MACHINE_NAMES = Object.freeze([...globalMachineNames.entries()].map(([key, entries]) => Object.freeze({
  id: slug(key),
  name: entries[0].name,
  providers: Object.freeze([...new Set(entries.map((entry) => entry.provider))]),
  rawEntryIds: Object.freeze(entries.map((entry) => entry.rawId)),
})));

const legacyStableIds = Object.freeze({
  "htb|Linux|Outbound": "htb-linux-outbound-assumed-breach",
  "htb|Active Directory|Adagio": "htb-active-directory-adagio-enterprise",
  "pg-play|Windows|Sams": "pg-play-windows-sams",
});

// The original slugger retained a trailing dash after bracketed annotations.
// Keep those exact persisted IDs resolvable when older workspaces are opened.
const legacyCompatibilityAliases = Object.freeze({
  "htb-linux-outbound-assumed-breach": ["htb-linux-outbound-assumed-breach-"],
  "htb-linux-expressway-old-system": ["htb-linux-expressway-old-system-"],
  "htb-windows-tombwatcher-assumed-breach-box": ["htb-windows-tombwatcher-assumed-breach-"],
  "htb-active-directory-adagio-enterprise": ["htb-active-directory-adagio-enterprise-"],
  "htb-active-directory-signed-assumed-breach": ["htb-active-directory-signed-assumed-breach-"],
  "htb-active-directory-eighteen-assumed-breach": ["htb-active-directory-eighteen-assumed-breach-"],
});

const groupedEntries = new Map();
for (const entry of RAW_PRACTICE_ENTRIES) {
  const key = `${entry.source}|${entry.category}|${entry.name.toLocaleLowerCase("en-US")}`;
  const current = groupedEntries.get(key) || [];
  current.push(entry);
  groupedEntries.set(key, current);
}

export const PRACTICE_BOXES = Object.freeze([...groupedEntries.entries()].map(([, entries]) => {
  const first = entries[0];
  const explicitId = legacyStableIds[`${first.source}|${first.category}|${first.name}`];
  const rawAliases = [...new Set(entries.map((entry) => slug(`${entry.source}-${entry.rawCategory}-${entry.rawEntry}`)))];
  const id = explicitId || rawAliases[0];
  return Object.freeze({
    id,
    name: first.name,
    displayName: first.name,
    source: first.source,
    provider: first.provider,
    category: first.category,
    rawCategories: Object.freeze([...new Set(entries.map((entry) => entry.rawCategory))]),
    platform: first.platform,
    os: first.platform === "linux" ? "Linux" : first.platform === "windows" ? "Windows" : first.platform === "ad" ? "Windows / AD" : "Mixed / unknown",
    labType: SOURCE_META[first.source].labType,
    scope: first.scope,
    tags: Object.freeze([...new Set(entries.flatMap((entry) => entry.tags))]),
    rawEntryIds: Object.freeze(entries.map((entry) => entry.rawId)),
    rawEntries: Object.freeze(entries.map((entry) => entry.rawEntry)),
    duplicateCount: entries.length,
    conflicts: Object.freeze([...new Set(entries.flatMap((entry) => entry.conflicts))]),
    sourceUrls: Object.freeze([...new Set(entries.map((entry) => entry.sourceUrl))]),
    legacyIdAliases: Object.freeze([...new Set([
      ...rawAliases.filter((alias) => alias !== id),
      ...(legacyCompatibilityAliases[id] || []),
    ])]),
  });
}));

const normalizedGroups = new Map();
for (const box of PRACTICE_BOXES) {
  const key = `${box.source}|${box.name.toLocaleLowerCase("en-US")}`;
  const current = normalizedGroups.get(key) || [];
  current.push(box);
  normalizedGroups.set(key, current);
}

export const NORMALIZED_PRACTICE_BOXES = Object.freeze([...normalizedGroups.entries()].map(([key, boxes]) => Object.freeze({
  id: slug(key),
  name: boxes[0].name,
  source: boxes[0].source,
  provider: boxes[0].provider,
  boxIds: Object.freeze(boxes.map((box) => box.id)),
  categories: Object.freeze([...new Set(boxes.map((box) => box.category))]),
  platforms: Object.freeze([...new Set(boxes.map((box) => box.platform))]),
  scopes: Object.freeze([...new Set(boxes.map((box) => box.scope))]),
  rawEntryIds: Object.freeze(boxes.flatMap((box) => box.rawEntryIds)),
  duplicate: boxes.reduce((total, box) => total + box.duplicateCount, 0) > 1,
  categoryConflict: new Set(boxes.map((box) => box.category)).size > 1,
})));

const globalNameGroups = new Map();
for (const entity of NORMALIZED_PRACTICE_BOXES) {
  const key = entity.name.toLocaleLowerCase("en-US");
  const current = globalNameGroups.get(key) || [];
  current.push(entity);
  globalNameGroups.set(key, current);
}

export const GLOBAL_NAME_COLLISIONS = Object.freeze([...globalNameGroups.entries()]
  .filter(([, entities]) => new Set(entities.map((entry) => entry.source)).size > 1)
  .map(([name, entities]) => Object.freeze({
    name,
    entityIds: Object.freeze(entities.map((entry) => entry.id)),
    providers: Object.freeze([...new Set(entities.map((entry) => entry.provider))]),
  })));

export const TECHNIQUE_REGISTRY = Object.freeze({
  "method.workspace-evidence": { title: "Workspace and evidence hygiene", checklistIds: ["setup-workspace", "setup-network", "setup-resources", "setup-reachability", "proof-artifacts"] },
  "method.network-discovery": { title: "Complete network discovery", checklistIds: ["recon-tcp-all", "recon-tcp-detail", "recon-udp", "recon-hostnames"] },
  "method.service-enumeration": { title: "Protocol-led service enumeration", checklistIds: ["svc-smb", "svc-smb-gpp", "svc-ldap", "svc-nfs", "svc-snmp", "svc-dns", "svc-mail-ftp", "svc-rdp", "svc-databases"] },
  "method.web-assessment": { title: "Manual web assessment", checklistIds: ["web-baseline", "web-content", "web-vhosts", "web-manual", "web-input-classes", "web-access-xss", "web-upload", "web-files-api"] },
  "method.initial-access": { title: "Public exploit adaptation and initial access", checklistIds: ["access-research", "access-adapt-exploit", "access-remote", "access-listener", "access-shells", "access-transfer", "access-tty"] },
  "method.credentials": { title: "Credential identification and deliberate reuse", checklistIds: ["creds-identify", "creds-crack", "creds-reuse", "creds-spray"] },
  "method.linux-privesc": { title: "Linux privilege escalation", checklistIds: ["linux-context", "linux-files", "linux-jobs", "linux-secrets", "linux-storage-groups", "linux-kernel-last-resort"] },
  "method.windows-privesc": { title: "Windows privilege escalation", checklistIds: ["windows-context", "windows-services", "windows-jobs", "windows-secrets", "windows-privileges-policy", "windows-helper"] },
  "method.active-directory": { title: "Active Directory methodology", checklistIds: ["ad-baseline", "ad-enum", "ad-trusts", "ad-bloodhound-paths", "ad-roast", "ad-spn-tgs", "ad-group-membership", "ad-domain-writedacl", "ad-remote", "ad-delegation-adcs"] },
  "method.pivoting": { title: "Manual pivoting", checklistIds: ["pivot-playbook"] },
  "method.proof-reporting": { title: "Interactive proof and reporting", checklistIds: ["proof-linux", "proof-windows", "proof-artifacts", "proof-cleanup"] },
  "access.assumed-breach": { title: "Assumed-breach start", checklistIds: ["ad-baseline", "creds-identify"] },
  "pivot.multi-host-chain": { title: "Multi-host chain", checklistIds: ["pivot-playbook"], scopeRecordId: "advanced-multi-host" },
  "legacy.os-tooling": { title: "Legacy operating system/tooling constraints", checklistIds: [], scopeRecordId: "legacy-systems" },
  "legacy.memory-corruption": { title: "Memory corruption adaptation", checklistIds: [], scopeRecordId: "legacy-memory-corruption" },
  "ad.time-roasting": { title: "Time-roasting", checklistIds: [], scopeRecordId: "post-oscp-ad" },
  "enterprise.lab": { title: "Enterprise/ProLab study", checklistIds: [], scopeRecordId: "enterprise-labs" },
});

export const COVERAGE_SCOPE_RECORDS = Object.freeze({
  "legacy-systems": { disposition: "appendix", scope: "optional-legacy", reason: "Legacy operating-system compatibility is kept outside the concise core workflow." },
  "legacy-memory-corruption": { disposition: "appendix", scope: "optional-legacy", reason: "Memory-corruption study is isolated from the default checklist." },
  "post-oscp-ad": { disposition: "out-of-scope", scope: "post-oscp", reason: "Advanced AD technique explicitly labeled post-OSCP in the source list." },
  "advanced-multi-host": { disposition: "appendix", scope: "enterprise-chain", reason: "Multi-host chains use manual pivot playbooks without changing the core machine checklist." },
  "enterprise-labs": { disposition: "out-of-scope", scope: "enterprise-chain", reason: "Enterprise and ProLab material is tracked but does not define core exam scope." },
});

const baselineTechniques = (platform) => {
  const common = ["method.workspace-evidence", "method.network-discovery", "method.service-enumeration", "method.initial-access", "method.credentials", "method.proof-reporting"];
  if (platform === "linux") return [...common, "method.web-assessment", "method.linux-privesc"];
  if (platform === "windows") return [...common, "method.web-assessment", "method.windows-privesc"];
  if (platform === "ad") return [...common, "method.windows-privesc", "method.active-directory", "method.pivoting"];
  return common;
};

const explicitTechniqueByTag = Object.freeze({
  "assumed-breach": "access.assumed-breach",
  "multi-host-chain": "pivot.multi-host-chain",
  "legacy-os": "legacy.os-tooling",
  "memory-corruption": "legacy.memory-corruption",
  "time-roasting": "ad.time-roasting",
  enterprise: "enterprise.lab",
});

export const PRACTICE_COVERAGE = Object.freeze(PRACTICE_BOXES.map((box) => {
  const explicitTechniqueIds = box.tags.map((tag) => explicitTechniqueByTag[tag]).filter(Boolean);
  const methodologyIds = baselineTechniques(box.platform);
  return Object.freeze({
    boxId: box.id,
    rawEntryIds: box.rawEntryIds,
    methodologyIds: Object.freeze(methodologyIds),
    techniqueIds: Object.freeze([...new Set(explicitTechniqueIds)]),
    coverageBasis: explicitTechniqueIds.length ? "source-annotation-and-platform-baseline" : "platform-baseline-only",
    researchStatus: "unresolved",
    confidence: explicitTechniqueIds.length ? "medium-for-explicit-annotation" : "unresolved",
    sourceUrls: box.sourceUrls,
    unresolvedReason: "No public, spoiler-safe, machine-specific technique source has been reviewed; do not infer a solution from the category baseline.",
  });
}));

const SCOPE_LABELS = Object.freeze({
  "exam-core": "Core OSCP+/PEN-200",
  "optional-legacy": "Optional / legacy study",
  "post-oscp": "Post-OSCP study",
  "enterprise-chain": "Enterprise / multi-host",
  "study-only": "Study resource",
});

export const PRACTICE_GROUPS = Object.freeze(Object.entries(PRACTICE_BOXES.filter((box) => box.source !== "other-labs").reduce((groups, box) => {
  const key = `${box.scope}::${box.source}::${box.category}`;
  groups[key] = [...(groups[key] || []), box];
  return groups;
}, {})).map(([key, entries]) => {
  const [scope, source, category] = key.split("::");
  return Object.freeze({ key, scope, label: `${SCOPE_LABELS[scope] || scope} — ${SOURCE_LABELS[source]} — ${category}`, boxes: Object.freeze(entries) });
}));

export const practiceBoxById = (id) => PRACTICE_BOXES.find((box) => box.id === id || box.legacyIdAliases.includes(id));

export const PLATFORM_PHASES = Object.freeze({
  linux: new Set(["setup", "recon", "services", "web", "access", "linux-privesc", "credentials", "pivoting", "proof"]),
  windows: new Set(["setup", "recon", "services", "web", "access", "windows-privesc", "credentials", "pivoting", "proof"]),
  ad: new Set(["setup", "recon", "services", "web", "access", "windows-privesc", "active-directory", "credentials", "pivoting", "proof"]),
  mixed: new Set(["setup", "recon", "services", "web", "access", "linux-privesc", "windows-privesc", "active-directory", "credentials", "pivoting", "proof"]),
  unknown: new Set(["setup", "recon", "services", "web", "access", "credentials", "pivoting", "proof"]),
});

export const platformLabel = (platform) => ({
  linux: "Linux",
  windows: "Standalone Windows",
  ad: "Windows Active Directory",
  mixed: "Mixed / multi-platform",
  unknown: "Unknown / confirm manually",
}[platform] || "Unknown / show all");

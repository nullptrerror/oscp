import { CHECKLIST } from "../data/checklist.js";
import { confirmedDiscoveries, visibleDiscoveries } from "./evidence.js";
import { getScopedItemValue } from "./workspace.js";

const COMMON_WEB_PORTS = new Set(["80", "443", "8000", "8080", "8443", "8888"]);

const RULES = [
  { itemId: "svc-smb", ports: new Set(["139", "445"]), protocols: new Set(["tcp"]), reason: "Confirmed SMB/NetBIOS exposure supports a focused share and identity check." },
  { itemId: "svc-ldap", ports: new Set(["389", "636", "3268", "3269"]), protocols: new Set(["tcp"]), reason: "Confirmed LDAP exposure supports a narrow directory-information check." },
  { itemId: "svc-dns", ports: new Set(["53"]), protocols: new Set(["tcp", "udp"]), reason: "Confirmed DNS exposure supports record and dependency validation." },
  { itemId: "svc-nfs", ports: new Set(["111", "2049"]), protocols: new Set(["tcp", "udp"]), reason: "Confirmed RPC/NFS exposure supports export enumeration from Kali." },
  { itemId: "svc-snmp", ports: new Set(["161"]), protocols: new Set(["udp"]), reason: "Confirmed SNMP exposure supports a bounded community and metadata check." },
  { itemId: "svc-mail-ftp", ports: new Set(["21", "25", "110", "143", "465", "587", "993", "995"]), protocols: new Set(["tcp"]), reason: "Confirmed file-transfer or mail exposure supports protocol-specific enumeration." },
  { itemId: "access-remote", ports: new Set(["22", "3389", "445", "5985", "5986"]), protocols: new Set(["tcp"]), requiresCredential: true, reason: "A manually selected credential and confirmed management service support one deliberate authentication check." },
];

const flattenChecklist = (checklist) => checklist.flatMap((phase) => phase.items.map((item) => ({
  ...item,
  phaseId: phase.id,
  phaseTitle: phase.title,
})));

const serviceTextLooksWeb = (entry) => /https?|ssl\/http|http-proxy/i.test(entry.service || "");

/**
 * Rank a small, deterministic set of pre-authored checks from facts the
 * operator has explicitly confirmed. This function never selects an exploit,
 * never renders a command, and never changes workspace state.
 */
export function rankApplicableChecks(workspace, checklist = CHECKLIST, limit = 3) {
  if (!workspace?.activeTargetId) return [];
  const items = flattenChecklist(checklist);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const incomplete = (itemId) => {
    const item = itemById.get(itemId);
    return item && !getScopedItemValue(workspace.completed || {}, workspace, itemId, false);
  };
  const targetId = workspace.activeTargetId;
  const belongs = (entry) => !entry.targetId || entry.targetId === targetId;
  const facts = confirmedDiscoveries(visibleDiscoveries(workspace.discoveries || [], {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId,
  })).filter(belongs);
  const ports = facts.filter((entry) => entry.type === "port");
  const selectedCredentialId = workspace.selectedCredentials?.[targetId] || "";
  const recommendations = [];
  const add = (itemId, reason, matchedFacts = [], score = 0) => {
    if (!incomplete(itemId) || recommendations.some((entry) => entry.itemId === itemId)) return;
    const item = itemById.get(itemId);
    recommendations.push({ itemId, title: item.title, phaseId: item.phaseId, phaseTitle: item.phaseTitle, reason, matchedFacts, score });
  };

  if (ports.length === 0) {
    add("setup-reachability", "No service fact has been confirmed yet; verify the route and target scope first.", [], 100);
    add("recon-tcp-all", "No confirmed TCP attack surface exists; perform one operator-initiated full TCP discovery scan.", [], 90);
  } else {
    add("recon-tcp-detail", "Confirmed ports exist; capture exact service and version evidence before researching weaknesses.", ports.map((entry) => `${entry.value}/${entry.protocol || "tcp"}`), 95);
  }

  const webPorts = ports.filter((entry) => entry.protocol === "tcp" && (COMMON_WEB_PORTS.has(String(entry.value)) || serviceTextLooksWeb(entry)));
  if (webPorts.length) add("web-baseline", "Confirmed HTTP/S exposure supports a small header, source, and technology baseline.", webPorts.map((entry) => `${entry.value}/tcp`), 80);

  for (const rule of RULES) {
    if (rule.requiresCredential && !selectedCredentialId) continue;
    const matches = ports.filter((entry) => rule.ports.has(String(entry.value)) && rule.protocols.has(entry.protocol || "tcp"));
    if (matches.length) add(rule.itemId, rule.reason, matches.map((entry) => `${entry.value}/${entry.protocol || "tcp"}`), rule.requiresCredential ? 85 : 75);
  }

  const confirmedUserProof = facts.some((entry) => entry.type === "flag" && entry.kind === "user");
  const target = (workspace.targets || []).find((entry) => entry.id === targetId);
  if (confirmedUserProof && target?.boxType === "linux") add("linux-context", "Confirmed user-level access supports local Linux context capture before privilege checks.", ["confirmed user proof"], 88);
  if (confirmedUserProof && ["windows", "ad"].includes(target?.boxType)) add("windows-context", "Confirmed user-level access supports local Windows context capture before privilege checks.", ["confirmed user proof"], 88);

  return recommendations.sort((left, right) => right.score - left.score || left.itemId.localeCompare(right.itemId)).slice(0, limit);
}

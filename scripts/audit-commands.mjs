import { ALL_ITEMS } from "../src/data/checklist.js";
import { auditCommandRecord, renderCommandRecord } from "../src/lib/commandContract.js";
import { getChecklistCommands } from "../src/lib/checklistCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";
import { PIVOT_STEPS } from "../src/data/pivotPlaybooks.js";

const staticCommands = ALL_ITEMS.flatMap((item) => item.commands);
const failures = [];
const auditContexts = [];

function auditWorkspace(kind, secret, aclRights) {
  const workspace = createDefaultWorkspace();
  const isHash = kind === "nt-hash";
  const credentialId = `audit-${kind}-credential`;
  workspace.activeTargetId = "audit-target";
  workspace.targets = [{ id: "audit-target", name: "Audit Target", slug: "audit-target" }];
  workspace.accounts = [{
    id: credentialId,
    targetId: "audit-target",
    domain: "audit.test",
    username: "operator",
    secret,
  }];
  workspace.selectedCredentials = { "audit-target": credentialId };
  workspace.discoveries = [{
    id: "audit-ticket",
    targetId: "audit-target",
    target: "Audit Target",
    type: "kerberos-ticket",
    status: "confirmed",
    username: "svc_sql",
    domain: "AUDIT.TEST",
    value: "$krb5tgs$23$*svc_sql$AUDIT.TEST$MSSQLSvc/dc01.audit.test*$0123456789abcdef$abcdef0123456789",
  }];
  Object.assign(workspace.variables, {
    targetName: "Audit Target",
    targetSlug: "audit-target",
    rhost: "192.0.2.10",
    rport: "80,445",
    uport: "53",
    tcpPorts: "80,445",
    udpPorts: "53",
    selectedServiceHost: "192.0.2.10",
    selectedServicePort: "445",
    webScheme: "http",
    webPort: "80",
    vhost: "app.audit.test",
    baseUrl: "http://app.audit.test",
    webPath: "index.php",
    webParameter: "id",
    webValue: "AUDIT_PROBE",
    sessionCookie: "session=audit-only",
    uploadFile: "/tmp/audit-upload.txt",
    uploadField: "file",
    uploadedRemotePath: "uploads/audit-upload.txt",
    domain: "audit.test",
    realm: "AUDIT.TEST",
    baseDn: "DC=audit,DC=test",
    dc: "dc01.audit.test",
    dcIp: "192.0.2.10",
    dnsServer: "192.0.2.10",
    user: "operator",
    password: isHash ? "" : secret,
    hash: isHash ? secret : "",
    selectedCredentialId: credentialId,
    credentialType: kind,
    memberUser: "operator",
    targetGroup: "Helpdesk",
    aclTarget: "audit.test",
    aclPrincipal: "operator",
    aclRights,
    dcsyncUser: "Administrator",
    bloodhoundSource: "OPERATOR@AUDIT.TEST",
    bloodhoundTarget: "DOMAIN ADMINS@AUDIT.TEST",
    gppCpassword: "audit-cpassword",
    gppXmlFile: "/tmp/Groups.xml",
    smbShare: "SYSVOL",
    smbDirectory: "Policies",
    nfsExport: "/srv/export",
    wordlist: "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
    exploitQuery: "audit service 1.0",
    exploitId: "12345",
    exploitFile: "/tmp/audit-exploit.c",
    compiledExploit: "/tmp/audit-exploit",
    transferFile: "agent-audit",
    hashesFile: "/tmp/audit.hashes",
    hashMode: "13100",
    sprayPassword: "AuditPassword1!",
    sprayJitter: "3-5",
    sprayRockyouLimit: "25",
    subnet: "172.16.9.0/24",
    internalSubnet: "172.16.10.0/24",
    internalHost: "172.16.10.10",
    pivotHost: "192.0.2.20",
    pivotUser: "operator",
    pivotInterface: "ligolo",
    proxyPort: "1080",
    callbackHost: "192.0.2.1",
    userFlagName: "local.txt",
    rootFlagName: "proof.txt",
  });

  const commands = [
    ...ALL_ITEMS.filter((item) => item.id !== "pivot-playbook").flatMap((item) => getChecklistCommands(item, workspace)),
    ...PIVOT_STEPS,
  ];
  const seenIds = new Set();
  for (const command of commands) {
    const { errors } = auditCommandRecord(command);
    const context = `${kind}/${aclRights}`;
    failures.push(...errors.map((error) => `[${context}] ${error}`));
    if (seenIds.has(command.id)) failures.push(`[${context}] ${command.id}: duplicate runtime command id`);
    seenIds.add(command.id);
    const requiredNames = new Set(command.requiredVariables.map((variable) => variable.name));
    const applicableSecret = kind === "nt-hash" ? !requiredNames.has("password") : !requiredNames.has("hash");
    if ((command.executionEnabled || command.terminal) && applicableSecret) {
      const rendered = renderCommandRecord(command, workspace.variables);
      if (rendered.missing.length || Object.keys(rendered.invalid).length) {
        failures.push(`[${context}] ${command.id}: unresolved synthetic render (${[...rendered.missing, ...Object.keys(rendered.invalid)].join(", ")})`);
      }
    }
    const protocols = [...command.template.matchAll(/\bnxc\s+(smb|winrm|ssh)\b/giu)].map((match) => match[1].toLowerCase());
    if (new Set(protocols).size > 1) failures.push(`[${context}] ${command.id}: chains credential reuse across protocols`);
  }
  if (!commands.some((command) => command.key?.startsWith("kerberos-ticket-"))) failures.push(`[${kind}/${aclRights}] ticket-derived commands were not generated`);
  if (!commands.some((command) => command.key === "acl-grant")) failures.push(`[${kind}/${aclRights}] ACL grant commands were not generated`);
  if (isHash && !commands.some((command) => /-hashes/u.test(command.template))) failures.push(`[${kind}/${aclRights}] no NT-hash authentication command was generated`);
  if (!isHash && !commands.some((command) => command.template.includes(secret))) failures.push(`[${kind}/${aclRights}] no password authentication command was generated`);
  auditContexts.push({ kind: `${kind}/${aclRights}`, commands });
}

for (const aclRights of ["All", "ResetPassword", "WriteMembers", "DCSync"]) {
  auditWorkspace("password", "AuditPassword1!", aclRights);
  auditWorkspace("nt-hash", "8846f7eaee8fb117ad06bdd830b7586c", aclRights);
}

if (failures.length > 0) {
  console.error(`Command-policy audit failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const summary = auditContexts.map(({ kind, commands }) => {
    const disabled = commands.filter((command) => !command.executionEnabled).length;
    return `${kind}=${commands.length} (${disabled} disabled)`;
  }).join(", ");
  console.log(`Command-policy audit passed: ${staticCommands.length} static; ${summary}.`);
}

import test from "node:test";
import assert from "node:assert/strict";
import { discoveriesForChecklistItem, guidanceForDiscoveries, mergePortLists, parseEvidence, routeEvidence, visibleDiscoveries } from "../src/lib/evidence.js";

test("nmap output yields ports and useful guidance", () => {
  const discoveries = parseEvidence("445/tcp open microsoft-ds\n5985/tcp open wsman", "tcp-detail.nmap");
  assert.deepEqual(discoveries.filter((item) => item.type === "port").map((item) => item.value), ["445", "5985"]);
  assert.ok(guidanceForDiscoveries(discoveries).some((step) => step.itemId === "svc-smb"));
  assert.ok(guidanceForDiscoveries(discoveries).some((step) => step.itemId === "access-remote"));
});

test("cracked Kerberos output yields a credential without treating failure as valid", () => {
  const discoveries = parseEvidence("$krb5tgs$23$*Administrator$ACTIVE.HTB$svc/host*$abc:Ticketmaster1968", "tgs.cracked.txt");
  const credential = discoveries.find((item) => item.type === "credential");
  assert.equal(credential.username, "Administrator");
  assert.equal(credential.secret, "Ticketmaster1968");
  assert.equal(parseEvidence("ACTIVE\\bob:bad STATUS_LOGON_FAILURE").some((item) => item.type === "credential"), false);
});

test("files route to the closest checklist item", () => {
  assert.equal(routeEvidence("tcp-all.nmap", "445/tcp open microsoft-ds"), "recon-tcp-detail");
  assert.equal(routeEvidence("GetUserSPNs.txt", "$krb5tgs$23$*svc$REALM$"), "ad-spn-tgs");
  assert.equal(routeEvidence("root-flag.png", ""), "proof-artifacts");
});

test("UDP scans retain open and open-filtered ports with protocol metadata", () => {
  const output = `PORT     STATE         SERVICE
53/udp   open          domain
88/udp   open          kerberos-sec
123/udp  open          ntp
137/udp  open|filtered netbios-ns
138/udp  open|filtered netbios-dgm
500/udp  open|filtered isakmp
4500/udp open|filtered nat-t-ike
623/udp  closed        asf-rmcp`;
  const discoveries = parseEvidence(output, "udp-top100.nmap").filter((entry) => entry.type === "port");

  assert.deepEqual(discoveries.map((entry) => entry.value), ["53", "88", "123", "137", "138", "500", "4500"]);
  assert.ok(discoveries.every((entry) => entry.protocol === "udp"));
  assert.equal(discoveries.find((entry) => entry.value === "137").state, "open|filtered");
  assert.equal(routeEvidence("udp-top100.nmap", output), "recon-udp");
});

test("TCP and UDP port lists accumulate without overwriting each other", () => {
  assert.equal(mergePortLists("53,445", ["88", "53", "123"]), "53,88,123,445");
  const discoveries = parseEvidence("53/tcp open domain\n53/udp open domain");
  assert.equal(discoveries.filter((entry) => entry.type === "port").length, 2);
});

test("LDAP and NetExec enumeration output yields tracked usernames", () => {
  const output = `sAMAccountName: SVC_TGS
SMB 10.129.81.60 445 DC Administrator 2018-07-18 00:00:00 0 Built-in account
active.htb\\alice`;
  const users = parseEvidence(output).filter((entry) => entry.type === "user").map((entry) => entry.value);
  assert.deepEqual(users, ["SVC_TGS", "Administrator", "alice"]);
});

test("negative and errored Nmap script results do not become CVE findings", () => {
  const output = `Host script results:
|_smb-vuln-ms10-054: false
|_samba-vuln-cve-2012-1182: Could not negotiate a connection: ERROR
| smb-vuln-example:
|   State: VULNERABLE
|_  IDs: CVE:CVE-2024-12345`;
  const cves = parseEvidence(output).filter((entry) => entry.type === "cve").map((entry) => entry.value);
  assert.deepEqual(cves, ["CVE-2024-12345"]);
});

test("SMB paths and share tables are not interpreted as usernames", () => {
  const output = `SMB 10.129.81.76 445 DC [*] Enumerated shares
SMB 10.129.81.76 445 DC Share Permissions Remark
SMB 10.129.81.76 445 DC NETLOGON Logon server share
getting file \\active.htb\\Policies\\MACHINE\\Preferences\\Groups\\Groups.xml
file : \\active.htb\\Policies\\MACHINE\\Preferences\\Groups\\Groups.xml
userName : active.htb\\SVC_TGS`;
  const users = parseEvidence(output).filter((entry) => entry.type === "user");
  assert.deepEqual(users.map((entry) => entry.value), ["SVC_TGS"]);
  assert.equal(users[0].domain, "active.htb");
});

test("parser switches and target-scoped ignore rules filter discoveries", () => {
  const discoveries = [
    { type: "user", value: "Policies", targetId: "active" },
    { type: "user", value: "alice", targetId: "other" },
    { type: "cve", value: "CVE-2024-12345", targetId: "active" },
  ];
  const ignored = [{ type: "user", value: "Policies", targetId: "active" }];
  assert.deepEqual(visibleDiscoveries(discoveries, { ignored, settings: { cve: false } }), [discoveries[1]]);
  assert.deepEqual(visibleDiscoveries([{ type: "user", value: "Policies" }], { ignored, targetId: "other" }).length, 1);
});

test("flags and Kerberos ticket material are not mislabeled as NTLM hashes", () => {
  const flag = "ed7471e27363eaa77b804cd997ac8fe2";
  const ticket = "$krb5tgs$23$*Administrator$ACTIVE.HTB$svc/host*$2cd835587a22aca9883346c32d3ea3ae";
  assert.deepEqual(parseEvidence(`${flag}\n`, "user.txt").filter((entry) => entry.type === "flag"), [
    { type: "flag", value: flag, kind: "user" },
  ]);
  assert.equal(parseEvidence(ticket, "tgs.hashes").some((entry) => entry.type === "ntlm-hash"), false);
  assert.deepEqual(parseEvidence("Administrator:500:aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c:::")
    .filter((entry) => entry.type === "ntlm-hash")
    .map((entry) => entry.value), ["8846f7eaee8fb117ad06bdd830b7586c"]);
});

test("scan and SMB output associate hostnames with endpoint addresses", () => {
  const output = `Nmap scan report for dc.active.htb (10.129.81.60)
SMB 10.129.81.60 445 DC [*] Windows (name:DC) (domain:active.htb)`;
  const hosts = parseEvidence(output).filter((entry) => entry.type === "hostname");
  assert.deepEqual(hosts.map((entry) => [entry.value, entry.address]), [
    ["dc.active.htb", "10.129.81.60"],
    ["dc.active.htb", "10.129.81.60"],
  ].slice(0, 1));
});

test("VPN route output updates local context without promoting routes to endpoints", () => {
  const output = `tun0 UNKNOWN 10.10.15.240/23 fe80::1/64
default via 10.42.42.1 dev eth0
10.10.8.0/22 via 10.10.14.1 dev tun0
10.129.0.0/16 via 10.10.14.1 dev tun0
172.17.0.0/16 dev docker0 scope link src 172.17.0.1`;
  const discoveries = discoveriesForChecklistItem("setup-network", parseEvidence(output));
  assert.deepEqual(discoveries, [{ type: "local-ip", value: "10.10.15.240" }]);
  assert.equal(discoveries.some((entry) => entry.type === "endpoint" || entry.type === "ip"), false);
});

test("only explicit scan targets are promoted as endpoint candidates", () => {
  const discoveries = parseEvidence("Nmap scan report for 10.129.81.60\nHost is up.");
  assert.ok(discoveries.some((entry) => entry.type === "endpoint" && entry.value === "10.129.81.60"));
});

test("Nmap vendor URLs and the operator LHOST are not remote endpoint discoveries", () => {
  const output = `kali vpn 10.10.15.240 ~/oscp/active
Starting Nmap 7.99 ( https://nmap.org )
Nmap scan report for 10.129.81.76
445/tcp open microsoft-ds`;
  const discoveries = discoveriesForChecklistItem("recon-tcp-detail", parseEvidence(output), { lhost: "10.10.15.240" });
  assert.equal(discoveries.some((entry) => entry.value === "nmap.org"), false);
  assert.equal(discoveries.some((entry) => entry.value === "10.10.15.240"), false);
  assert.ok(discoveries.some((entry) => entry.type === "endpoint" && entry.value === "10.129.81.76"));
  assert.ok(discoveries.some((entry) => entry.type === "port" && entry.value === "445"));
});

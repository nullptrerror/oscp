import test from "node:test";
import assert from "node:assert/strict";
import { guidanceForDiscoveries, mergePortLists, parseEvidence, routeEvidence } from "../src/lib/evidence.js";

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

test("scan and SMB output associate hostnames with endpoint addresses", () => {
  const output = `Nmap scan report for dc.active.htb (10.129.81.60)
SMB 10.129.81.60 445 DC [*] Windows (name:DC) (domain:active.htb)`;
  const hosts = parseEvidence(output).filter((entry) => entry.type === "hostname");
  assert.deepEqual(hosts.map((entry) => [entry.value, entry.address]), [
    ["dc.active.htb", "10.129.81.60"],
    ["dc.active.htb", "10.129.81.60"],
  ].slice(0, 1));
});

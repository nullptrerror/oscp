import test from "node:test";
import assert from "node:assert/strict";
import { guidanceForDiscoveries, parseEvidence, routeEvidence } from "../src/lib/evidence.js";

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

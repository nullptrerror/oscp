import { buildSmbDownloadCommands } from "./smbCommands.js";
import { buildAclCommands } from "./aclCommands.js";
import { buildRemoteAccessCommands } from "./remoteAccessCommands.js";
import { buildKerberosTicketCommands, buildSpnTgsCommands } from "./kerberosCommands.js";
import { buildUsersFileCommand } from "./userCommands.js";
import { buildSprayCommands } from "./sprayCommands.js";
import { buildBloodHoundCommands } from "./bloodhoundCommands.js";
import { createCommandRecord } from "./commandContract.js";
import { stepsForPivotPlaybook } from "../data/pivotPlaybooks.js";
import { isNtHash } from "./credentials.js";

export function getChecklistCommands(item, workspace, selectedPivotPlaybook = "pivot-direct") {
  if (item.id === "pivot-playbook") return stepsForPivotPlaybook(selectedPivotPlaybook);

  const scopedAccounts = workspace.accounts.filter((account) => (
    account.targetId ? account.targetId === workspace.activeTargetId : account.target === workspace.variables.targetName
  ));
  const selectedCredentialId = workspace.selectedCredentials?.[workspace.activeTargetId] || "";
  const selectedAccount = scopedAccounts.find((account) => account.id === selectedCredentialId);
  const accounts = selectedAccount ? [selectedAccount] : [];
  const variables = { ...workspace.variables, selectedCredentialId: selectedAccount?.id || "" };
  let commands = item.commands;

  if (item.id === "svc-smb") commands = [...item.commands, ...buildSmbDownloadCommands(accounts, variables)];
  if (item.id === "access-remote") commands = [...item.commands, ...(selectedAccount ? buildRemoteAccessCommands(accounts, variables) : [])];
  if (item.id === "ad-spn-tgs") commands = [...item.commands, ...(selectedAccount ? buildSpnTgsCommands(accounts, variables) : [])];
  if (item.id === "ad-domain-writedacl") commands = selectedAccount ? buildAclCommands(variables) : [];
  if (item.id === "ad-bloodhound-paths") commands = [...item.commands, ...buildBloodHoundCommands(variables)];
  if (item.id === "creds-crack") commands = [...item.commands, ...buildKerberosTicketCommands(workspace)];
  if (item.id === "ad-roast") {
    const usersFile = buildUsersFileCommand(workspace);
    commands = [usersFile, ...item.commands];
  }
  if (item.id === "creds-spray") commands = selectedAccount
    ? [...item.commands, ...buildSprayCommands(workspace, selectedAccount)]
    : item.commands;
  if (item.id === "creds-reuse" && selectedAccount && isNtHash(selectedAccount.secret)) {
    commands = [
      { key: "reuse-smb-hash", label: "SMB authentication with selected NT hash", value: "nxc smb {{rhost}} -u '{{user}}' -H '{{hash}}'", requiresSelectedCredential: true },
      { key: "reuse-winrm-hash", label: "WinRM authentication with selected NT hash", value: "nxc winrm {{rhost}} -u '{{user}}' -H '{{hash}}'", requiresSelectedCredential: true },
    ];
  }

  return commands.map((command, index) => {
    const record = createCommandRecord(item, command, index);
    const needsCredential = record.requiredVariables.some((variable) => variable.name === "selectedCredentialId");
    if (!needsCredential || selectedAccount) return record;
    return Object.freeze({
      ...record,
      executionEnabled: false,
      instructional: true,
      disabledReason: "Choose one saved credential explicitly for this machine before rendering or running this command.",
    });
  });
}

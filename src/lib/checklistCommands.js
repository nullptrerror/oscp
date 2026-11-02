import { buildSmbDownloadCommands } from "./smbCommands.js";
import { buildRemoteAccessCommands } from "./remoteAccessCommands.js";
import { buildSpnTgsCommands } from "./kerberosCommands.js";

export function getChecklistCommands(item, workspace) {
  const accounts = workspace.accounts.filter((account) => (
    account.targetId ? account.targetId === workspace.activeTargetId : account.target === workspace.variables.targetName
  ));
  if (item.id === "svc-smb") return [...item.commands, ...buildSmbDownloadCommands(accounts, workspace.variables)];
  if (item.id === "access-remote") return [...item.commands, ...buildRemoteAccessCommands(accounts, workspace.variables)];
  if (item.id === "ad-spn-tgs") return [...item.commands, ...buildSpnTgsCommands(accounts, workspace.variables)];
  return item.commands;
}

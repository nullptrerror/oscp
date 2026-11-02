import { buildSmbDownloadCommands } from "./smbCommands.js";
import { buildRemoteAccessCommands } from "./remoteAccessCommands.js";
import { buildSpnTgsCommands } from "./kerberosCommands.js";

export function getChecklistCommands(item, workspace) {
  if (item.id === "svc-smb") return [...item.commands, ...buildSmbDownloadCommands(workspace.accounts, workspace.variables)];
  if (item.id === "access-remote") return [...item.commands, ...buildRemoteAccessCommands(workspace.accounts, workspace.variables)];
  if (item.id === "ad-spn-tgs") return [...item.commands, ...buildSpnTgsCommands(workspace.accounts, workspace.variables)];
  return item.commands;
}

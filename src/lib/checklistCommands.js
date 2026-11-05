import { buildSmbDownloadCommands } from "./smbCommands.js";
import { buildAclCommands } from "./aclCommands.js";
import { buildRemoteAccessCommands } from "./remoteAccessCommands.js";
import { buildKerberosTicketCommands, buildSpnTgsCommands } from "./kerberosCommands.js";
import { buildUsersFileCommand } from "./userCommands.js";
import { buildSprayCommands } from "./sprayCommands.js";

export function getChecklistCommands(item, workspace) {
  const accounts = workspace.accounts.filter((account) => (
    account.targetId ? account.targetId === workspace.activeTargetId : account.target === workspace.variables.targetName
  ));
  if (item.id === "svc-smb") return [...item.commands, ...buildSmbDownloadCommands(accounts, workspace.variables)];
  if (item.id === "access-remote") return [...item.commands, ...buildRemoteAccessCommands(accounts, workspace.variables)];
  if (item.id === "ad-spn-tgs") return [...item.commands, ...buildSpnTgsCommands(accounts, workspace.variables)];
  if (item.id === "ad-domain-writedacl") return [...item.commands, ...buildAclCommands(workspace.variables)];
  if (item.id === "creds-crack") return [...item.commands, ...buildKerberosTicketCommands(workspace)];
  if (item.id === "ad-roast") {
    const usersFile = buildUsersFileCommand(workspace);
    return [
      usersFile,
      ...item.commands.map((command) => ({
        ...command,
        label: `Build users file + ${command.label}`,
        value: `${usersFile.value}; ${command.value}`,
      })),
    ];
  }
  if (item.id === "creds-spray") return [...item.commands, ...buildSprayCommands(workspace)];
  return item.commands;
}

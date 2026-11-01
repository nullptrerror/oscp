import { useState } from "react";
import { VARIABLE_GROUPS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";

const LABELS = {
  lhost: "LHOST",
  lport: "LPORT",
  rhost: "RHOST",
  rport: "RPORT(S)",
  targetName: "Target name",
  domain: "Domain",
  baseDn: "LDAP base DN",
  dc: "Domain controller",
  user: "Username",
  password: "Password",
  hash: "NTLM / hash",
  subnet: "Pivot subnet",
  interface: "VPN interface",
  wordlist: "Default wordlist",
};

export default function VariablesPanel() {
  const { workspace, actions } = useWorkspace();
  const [showSecrets, setShowSecrets] = useState(false);
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);

  return (
    <aside className="variables-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Command context</p>
          <h2>Variables</h2>
        </div>
        <button type="button" className="text-button" onClick={() => setShowSecrets((value) => !value)}>
          {showSecrets ? "Hide secrets" : "Show secrets"}
        </button>
      </div>
      {activeTarget && <p className="active-target">Active: <strong>{activeTarget.name}</strong></p>}
      <p className="panel-copy">Commands update as you type. Values stay in this browser until you export a backup.</p>

      {VARIABLE_GROUPS.map((group) => (
        <fieldset key={group.label}>
          <legend>{group.label}</legend>
          {group.keys.map((key) => (
            <label key={key}>
              <span>{LABELS[key]}</span>
              <input
                type={key === "password" && !showSecrets ? "password" : "text"}
                value={workspace.variables[key] ?? ""}
                onChange={(event) => actions.updateVariables({ [key]: event.target.value })}
                autoComplete="off"
                spellCheck="false"
              />
            </label>
          ))}
        </fieldset>
      ))}
    </aside>
  );
}

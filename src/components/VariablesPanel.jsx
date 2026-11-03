import { useState } from "react";
import { VARIABLE_GROUPS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { credentialVariables, isNtHash } from "../lib/credentials";
import { visibleDiscoveries } from "../lib/evidence";

const LABELS = {
  workspaceRoot: "Root path",
  lhost: "LHOST",
  lport: "LPORT",
  rhost: "RHOST",
  rport: "RPORT(S)",
  uport: "UDP PORT(S)",
  targetName: "Target name",
  domain: "Domain",
  baseDn: "LDAP base DN",
  dc: "Domain controller",
  user: "Username",
  password: "Password",
  gppCpassword: "GPP cpassword",
  hash: "NTLM / hash",
  smbShare: "SMB share",
  smbDirectory: "SMB directory",
  sprayPassword: "Spray password",
  sprayJitter: "Spray jitter",
  sprayRockyouLimit: "Rockyou limit",
  subnet: "Pivot subnet",
  interface: "VPN interface",
  wordlist: "Default wordlist",
};

export default function VariablesPanel() {
  const { workspace, actions } = useWorkspace();
  const [showSecrets, setShowSecrets] = useState(false);
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);
  const activeEndpoint = activeTarget?.endpoints?.find((endpoint) => endpoint.id === activeTarget.activeEndpointId) || activeTarget?.endpoints?.[0];
  const activeAccounts = workspace.accounts.filter((entry) => entry.targetId ? entry.targetId === workspace.activeTargetId : entry.target === workspace.variables.targetName);
  const activeUsers = (workspace.users || []).filter((entry) => entry.targetId ? entry.targetId === workspace.activeTargetId : entry.target === workspace.variables.targetName);
  const activeDiscoveries = visibleDiscoveries(workspace.discoveries, {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId: workspace.activeTargetId,
  }).filter((entry) => entry.targetId ? entry.targetId === workspace.activeTargetId : entry.targetName === workspace.variables.targetName);
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const suggestions = {
    rhost: unique(workspace.targets.flatMap((target) => (target.endpoints || []).map((endpoint) => endpoint.address))),
    domain: unique([...workspace.targets.map((target) => target.domain), ...activeAccounts.map((entry) => entry.domain)]),
    user: unique([...activeUsers.map((entry) => entry.username), ...activeAccounts.map((entry) => entry.username)]),
    password: unique(activeAccounts.map((entry) => entry.secret).filter((secret) => !isNtHash(secret))),
    hash: unique(activeAccounts.map((entry) => entry.secret).filter(isNtHash)),
    gppCpassword: unique(activeDiscoveries.filter((entry) => entry.type === "gpp-cpassword").map((entry) => entry.value)),
  };

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

      {workspace.targets.length > 0 && (
        <label className="context-picker">
          <span>Target</span>
          <select value={workspace.activeTargetId || ""} onChange={(event) => {
            const target = workspace.targets.find((entry) => entry.id === event.target.value);
            if (target) actions.useTarget(target);
          }}>
            {workspace.targets.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.host}</option>)}
          </select>
        </label>
      )}

      {activeTarget?.endpoints?.length > 0 && (
        <label className="context-picker">
          <span>Endpoint</span>
          <select value={activeEndpoint?.id || ""} onChange={(event) => {
            const endpoint = activeTarget.endpoints.find((entry) => entry.id === event.target.value);
            if (endpoint) actions.useEndpoint(activeTarget, endpoint);
          }}>
            {activeTarget.endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.address}{endpoint.hostnames?.length ? ` · ${endpoint.hostnames.join(", ")}` : ""}</option>)}
          </select>
        </label>
      )}

      {activeAccounts.length > 0 && (
        <label className="context-picker">
          <span>Saved account</span>
          <select value="" onChange={(event) => {
            const account = activeAccounts.find((entry) => entry.id === event.target.value);
            if (account) actions.updateVariables(credentialVariables(account));
          }}>
            <option value="">Choose credential…</option>
            {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.domain ? `${account.domain}\\` : ""}{account.username}</option>)}
          </select>
        </label>
      )}

      {VARIABLE_GROUPS.map((group) => (
        <fieldset key={group.label}>
          <legend>{group.label}</legend>
          {group.keys.map((key) => (
            <label key={key}>
              <span>{LABELS[key]}</span>
              <input
                type={key === "password" && !showSecrets ? "password" : "text"}
                list={suggestions[key]?.length ? `suggestions-${key}` : undefined}
                value={workspace.variables[key] ?? ""}
                onChange={(event) => actions.updateVariables({ [key]: event.target.value })}
                autoComplete="off"
                spellCheck="false"
              />
              {suggestions[key]?.length > 0 && <datalist id={`suggestions-${key}`}>{suggestions[key].map((value) => <option key={value} value={value} />)}</datalist>}
            </label>
          ))}
        </fieldset>
      ))}
    </aside>
  );
}

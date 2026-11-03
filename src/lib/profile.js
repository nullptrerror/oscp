// The operator profile is workspace-wide; older reports stored it per target, so those values remain a fallback.

export function githubProfile(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const handle = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(handle)) return null;
  return { handle, display: `github.com/${handle}`, url: `https://github.com/${handle}` };
}

export function getOperatorProfile(workspace, report = {}) {
  const profile = workspace.profile || {};
  return {
    name: profile.name || report.operatorName || "",
    osid: profile.osid || report.candidateId || "",
    github: profile.github || "",
    avatar: profile.avatar || report.profileImage || "",
  };
}

export const initials = (name) => String(name || "")
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join("") || "OP";

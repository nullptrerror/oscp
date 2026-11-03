export const FLAG_PROFILES = {
  oscp: { label: "OSCP+", userFlagName: "local.txt", rootFlagName: "proof.txt" },
  htb: { label: "Hack The Box", userFlagName: "user.txt", rootFlagName: "root.txt" },
  custom: { label: "Custom", userFlagName: "user.txt", rootFlagName: "root.txt" },
};

export const flagProfile = (labType = "oscp") => FLAG_PROFILES[labType] || FLAG_PROFILES.custom;

export function normalizeFlagSettings(target = {}) {
  const labType = FLAG_PROFILES[target.labType] ? target.labType : "oscp";
  const defaults = flagProfile(labType);
  return {
    labType,
    userFlagName: target.userFlagName || defaults.userFlagName,
    rootFlagName: target.rootFlagName || defaults.rootFlagName,
  };
}

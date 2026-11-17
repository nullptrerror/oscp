const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

const unavailable = (reason) => [{
  key: "temporary-user-choose-creator",
  label: "Choose the saved temporary-account creator credential",
  value: "printf '%s\\n' 'Choose the original saved creator credential before rendering this fallback.' >&2; false",
  executionEnabled: false,
  instructional: true,
  disabledReason: reason,
}];

export function buildTemporaryUserCommands(accounts = [], variables = {}) {
  const creatorId = String(variables.temporaryCreatorCredentialId || "").trim();
  if (!creatorId) return unavailable("Set TEMPORARY CREATOR CREDENTIAL ID to the original saved account that can create and delete users.");

  const creator = accounts.find((account) => account.id === creatorId);
  if (!creator?.username?.trim() || !creator?.secret?.trim()) {
    return unavailable("The recorded creator credential is not available on this machine. Restore or reselect that saved account before cleanup.");
  }

  const domain = creator.domain?.trim() || variables.domain;
  if (!String(domain || "").trim()) {
    return unavailable("Set the confirmed domain on the machine or saved creator credential before rendering this fallback.");
  }
  const username = creator.username.trim();
  const secret = creator.secret.trim();
  const isHash = /^[a-f0-9]{32}$/iu.test(secret);
  const auth = `-U ${shellQuote(`${domain}/${username}%${secret}`)}${isHash ? " --pw-nt-hash" : ""}`;
  const creatorSelected = String(variables.selectedCredentialId || "") === creatorId;
  const guard = `test '{{selectedCredentialId}}' = ${shellQuote(creatorId)} || { echo 'Reselect the recorded temporary-account creator credential'; exit 1; }`;
  const base = `-S '{{rhost}}' ${auth}`;
  const info = `${guard}; net rpc user info '{{temporaryUser}}' ${base}`;
  const remove = `${guard}; net rpc user delete '{{temporaryUser}}' ${base}`;
  const common = creatorSelected ? {} : {
    executionEnabled: false,
    instructional: true,
    disabledReason: `Reselect the recorded creator credential (${creatorId}) before running this lifecycle card.`,
  };

  return [
    {
      key: "temporary-user-confirm-absent",
      label: "Confirm temporary username is absent",
      requiresSelectedCredential: true,
      value: info,
      ...common,
    },
    {
      key: "temporary-user-create",
      label: "Create one temporary domain user",
      requiresSelectedCredential: true,
      stateChange: "directory-service",
      verificationCommand: info,
      cleanup: {
        required: true,
        command: remove,
        note: "Reselect the recorded original creator, then delete this exact temporary account only after restoring its DACL changes and removing any group memberships.",
      },
      value: `${guard}; net rpc user add '{{temporaryUser}}' '{{temporaryPassword}}' ${base}`,
      ...common,
    },
    {
      key: "temporary-user-verify",
      label: "Verify temporary domain user",
      requiresSelectedCredential: true,
      value: info,
      ...common,
    },
    {
      key: "temporary-user-delete",
      label: "Cleanup: delete temporary domain user",
      requiresSelectedCredential: true,
      stateChange: "directory-service",
      verificationCommand: info,
      cleanup: {
        required: false,
        command: "",
        note: "This command is the account rollback. An account-not-found result from the verification confirms cleanup.",
      },
      value: remove,
      ...common,
    },
  ];
}

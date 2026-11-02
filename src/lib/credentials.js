export const isNtHash = (secret = "") => /^(?:[a-f0-9]{32}:)?[a-f0-9]{32}$/i.test(String(secret).trim());

export function credentialVariables(account) {
  const secret = account?.secret?.trim() || "";
  return {
    domain: account?.domain || "",
    user: account?.username || "",
    password: isNtHash(secret) ? "" : secret,
    hash: isNtHash(secret) ? secret : "",
  };
}

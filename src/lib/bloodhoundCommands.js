const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const cypherString = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const principalName = (value, domain) => {
  const name = String(value || "").trim();
  if (!name) return "";
  if (name.includes("@") || name.includes(".")) return name.toUpperCase();
  return `${name}@${domain}`.toUpperCase();
};

const saveQuery = (filename, query) => {
  const path = `{{workspaceRoot}}/{{targetName}}/notes/bloodhound/${filename}`;
  return `mkdir -p '{{workspaceRoot}}/{{targetName}}/notes/bloodhound'; printf '%s\\n' ${shellQuote(query)} | tee ${shellQuote(path)}`;
};

export function buildBloodHoundCommands(variables = {}) {
  const domain = String(variables.domain || "{{domain}}").trim();
  const source = principalName(variables.bloodhoundSource || variables.user || "{{bloodhoundSource}}", domain);
  const target = principalName(variables.bloodhoundTarget || `DOMAIN ADMINS@${domain}`, domain);
  const exactPath = `MATCH (s), (t) WHERE toUpper(s.name) = ${cypherString(source)} AND toUpper(t.name) = ${cypherString(target)} MATCH p = shortestPath((s)-[*1..]->(t)) RETURN p`;
  const highValuePath = `MATCH (s), (t) WHERE toUpper(s.name) = ${cypherString(source)} AND t.highvalue = true MATCH p = shortestPath((s)-[*1..]->(t)) RETURN p ORDER BY length(p) LIMIT 25`;
  const ownedPath = "MATCH (s), (t) WHERE s.owned = true AND t.highvalue = true MATCH p = shortestPath((s)-[*1..]->(t)) RETURN p ORDER BY length(p) LIMIT 25";

  return [
    {
      key: "bloodhound-path-exact",
      label: `Create shortest-path query: ${source} to ${target}`,
      value: saveQuery("shortest-to-target.cypher", exactPath),
    },
    {
      key: "bloodhound-path-high-value",
      label: `Create shortest-path query: ${source} to high-value targets`,
      value: saveQuery("shortest-to-high-value.cypher", highValuePath),
    },
    {
      key: "bloodhound-path-owned",
      label: "Create shortest-path query: owned principals to high-value targets",
      value: saveQuery("owned-to-high-value.cypher", ownedPath),
    },
  ];
}

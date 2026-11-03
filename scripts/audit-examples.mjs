import fs from "node:fs";
import path from "node:path";
import { parseEvidence } from "../src/lib/evidence.js";
import { stripAnsi } from "../src/lib/terminalText.js";

const root = path.resolve(process.argv[2] || "examples/active");
const textExtensions = new Set([".txt", ".log", ".nmap", ".gnmap", ".hashes", ".xml", ".ini", ".inf"]);

if (!fs.existsSync(root)) {
  console.error(`Example directory not found: ${root}`);
  process.exitCode = 1;
} else {
  const files = fs.readdirSync(root, { recursive: true })
    .map((entry) => path.join(root, entry))
    .filter((entry) => fs.statSync(entry).isFile() && textExtensions.has(path.extname(entry).toLowerCase()));

  for (const file of files) {
    const content = stripAnsi(fs.readFileSync(file, "utf8"));
    const findings = parseEvidence(content, path.basename(file));
    if (findings.length === 0) continue;
    console.log(JSON.stringify({
      file: path.relative(process.cwd(), file),
      findings: findings.map(({ type, value, protocol, address, username, domain }) => ({
        type,
        value,
        ...(protocol ? { protocol } : {}),
        ...(address ? { address } : {}),
        ...(username ? { username } : {}),
        ...(domain ? { domain } : {}),
      })),
    }));
  }
}

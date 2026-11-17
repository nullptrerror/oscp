import fs from "node:fs";
import path from "node:path";
import { parseEvidence } from "../src/lib/evidence.js";
import { stripAnsi } from "../src/lib/terminalText.js";

const args = process.argv.slice(2);
const showValues = args.includes("--show-values");
const root = path.resolve(args.find((entry) => !entry.startsWith("--")) || "examples/active");
const textExtensions = new Set([".txt", ".log", ".nmap", ".gnmap", ".hashes", ".xml", ".ini", ".inf"]);

if (!fs.existsSync(root)) {
  console.error(`Example directory not found: ${root}`);
  process.exitCode = 1;
} else {
  const files = fs.readdirSync(root, { recursive: true })
    .map((entry) => path.join(root, entry))
    .filter((entry) => fs.statSync(entry).isFile() && textExtensions.has(path.extname(entry).toLowerCase()));

  if (showValues) console.error("WARNING: --show-values prints sensitive target evidence; redirect it only to an appropriately protected file.");
  let filesWithFindings = 0;
  let totalFindings = 0;
  for (const [index, file] of files.entries()) {
    const content = stripAnsi(fs.readFileSync(file, "utf8"));
    const findings = parseEvidence(content, path.basename(file));
    if (findings.length === 0) continue;
    filesWithFindings += 1;
    totalFindings += findings.length;
    const counts = Object.fromEntries([...new Set(findings.map((entry) => entry.type))]
      .sort()
      .map((type) => [type, findings.filter((entry) => entry.type === type).length]));
    console.log(JSON.stringify(showValues ? {
      file: path.relative(process.cwd(), file),
      findings: findings.map(({ type, value, protocol, address, username, domain }) => ({
        type,
        value,
        ...(protocol ? { protocol } : {}),
        ...(address ? { address } : {}),
        ...(username ? { username } : {}),
        ...(domain ? { domain } : {}),
      })),
    } : {
      fileIndex: index + 1,
      extension: path.extname(file).toLowerCase(),
      findingCounts: counts,
    }));
  }
  console.log(JSON.stringify({ summary: { scannedFiles: files.length, filesWithFindings, totalFindings, valuesRedacted: !showValues } }));
}

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachRunnerWebSocket, runnerMiddleware } from "./runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT) || 4173;
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
};

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("Missing dist/index.html. Run npm run build first.");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  runnerMiddleware(request, response, () => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const candidate = path.resolve(dist, `.${requestPath}`);
    const safeCandidate = candidate === dist || candidate.startsWith(`${dist}${path.sep}`) ? candidate : path.join(dist, "index.html");
    const file = fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile() ? safeCandidate : path.join(dist, "index.html");
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(file).pipe(response);
  });
});

attachRunnerWebSocket(server);
server.listen(port, "127.0.0.1", () => {
  console.log(`Fieldnotes local runner: http://127.0.0.1:${port}`);
  console.log(`Command workspace root: ${process.env.FIELDNOTES_WORKSPACE_ROOT || "/home/kali/oscp"}`);
});

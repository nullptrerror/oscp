import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { attachRunnerWebSocket, runnerMiddleware } from "./server/runner.mjs";

const localRunner = () => ({
  name: "fieldnotes-local-runner",
  configureServer(server) {
    server.middlewares.use(runnerMiddleware);
    attachRunnerWebSocket(server.httpServer);
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "local" ? [localRunner()] : [])],
  optimizeDeps: {
    entries: ["index.html"],
  },
}));

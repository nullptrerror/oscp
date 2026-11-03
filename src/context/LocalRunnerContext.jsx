import { createContext, useContext, useEffect, useMemo, useState } from "react";

const LocalRunnerContext = createContext(null);

export function LocalRunnerProvider({ children }) {
  const [runner, setRunner] = useState({ status: "checking", mode: "static", tools: [] });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Local runner unavailable");
        return response.json();
      })
      .then((health) => setRunner({ ...health, status: "ready" }))
      .catch(() => setRunner({ status: "static", mode: "static", tools: [] }))
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const value = useMemo(() => ({
    ...runner,
    available: runner.status === "ready" && runner.mode === "local" && Boolean(runner.token),
    terminalUrl: runner.token
      ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/terminal?token=${encodeURIComponent(runner.token)}`
      : "",
  }), [runner]);

  return <LocalRunnerContext.Provider value={value}>{children}</LocalRunnerContext.Provider>;
}

export function useLocalRunner() {
  const context = useContext(LocalRunnerContext);
  if (!context) throw new Error("useLocalRunner must be used inside LocalRunnerProvider");
  return context;
}

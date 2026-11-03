import { useLocalRunner } from "../context/LocalRunnerContext";

export default function RunnerStatus() {
  const runner = useLocalRunner();
  if (runner.status === "checking") return <div className="runner-status checking">Checking runner…</div>;
  if (!runner.available) return <div className="runner-status static" title="Paste and upload mode. Start npm run dev:local or npm run serve:local on Kali to execute commands here.">Static mode</div>;
  const ready = runner.tools.filter((tool) => tool.ready).length;
  const missing = runner.tools.filter((tool) => !tool.ready).map((tool) => tool.name);
  return (
    <div className={`runner-status ${missing.length ? "warning" : "ready"}`} title={missing.length ? `Missing: ${missing.join(", ")}` : `Workspace: ${runner.workspaceRoot}`}>
      Runner {ready}/{runner.tools.length}
    </div>
  );
}

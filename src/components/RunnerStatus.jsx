import { useLocalRunner } from "../context/LocalRunnerContext";

export default function RunnerStatus() {
  const runner = useLocalRunner();
  if (runner.status === "checking") return <div className="runner-status checking">Checking runner…</div>;
  if (!runner.available) return <div className="runner-status static" title="Review-only mode. Start the project with its embedded local runner to execute commands inside Fieldnotes.">Runner offline</div>;
  const ready = runner.tools.filter((tool) => tool.ready).length;
  const missing = runner.tools.filter((tool) => !tool.ready).map((tool) => tool.name);
  return (
    <div className={`runner-status ${missing.length ? "warning" : "ready"}`} title={missing.length ? `Missing: ${missing.join(", ")}` : `Workspace: ${runner.workspaceRoot}`}>
      Runner {ready}/{runner.tools.length}
    </div>
  );
}

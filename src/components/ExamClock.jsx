import { useEffect, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";

// OSCP+ currently allows 23 h 45 min of exam time and 24 h afterwards for the report; both are editable.
const DEFAULT_EXAM_MINUTES = 23 * 60 + 45;
const REPORT_MINUTES = 24 * 60;

const pad = (value) => String(value).padStart(2, "0");
const formatDuration = (milliseconds) => {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};
const toLocalInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function ExamClock() {
  const { workspace, actions } = useWorkspace();
  const exam = workspace.exam || {};
  const [now, setNow] = useState(() => Date.now());
  const started = exam.startedAt ? new Date(exam.startedAt) : null;
  const durationMinutes = Number(exam.durationMinutes) || DEFAULT_EXAM_MINUTES;

  useEffect(() => {
    if (!started) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [exam.startedAt]);

  const examEnd = started ? started.getTime() + durationMinutes * 60000 : null;
  const reportDue = examEnd ? examEnd + REPORT_MINUTES * 60000 : null;
  let phase = "idle";
  let label = "Exam clock";
  let value = "";
  if (started && now < examEnd) {
    const remaining = examEnd - now;
    phase = remaining < 60 * 60000 ? "critical" : remaining < 3 * 60 * 60000 ? "warning" : "running";
    label = "Exam";
    value = formatDuration(remaining);
  } else if (started && now < reportDue) {
    phase = reportDue - now < 3 * 60 * 60000 ? "critical" : "report";
    label = "Report due";
    value = formatDuration(reportDue - now);
  } else if (started) {
    phase = "done";
    label = "Report window closed";
  }

  return (
    <details className={`exam-clock ${phase}`}>
      <summary title="Exam and report countdown">
        <span className="exam-clock-label">{label}</span>
        {value && <strong>{value}</strong>}
      </summary>
      <div className="exam-popover">
        <p className="eyebrow">Exam countdown</p>
        <label>
          <span>Exam started</span>
          <input
            type="datetime-local"
            value={started ? toLocalInput(started) : ""}
            onChange={(event) => actions.updateExam({ startedAt: event.target.value ? new Date(event.target.value).toISOString() : "" })}
          />
        </label>
        <label>
          <span>Exam length (minutes)</span>
          <input
            type="number"
            min="1"
            value={durationMinutes}
            onChange={(event) => actions.updateExam({ durationMinutes: Number(event.target.value) || DEFAULT_EXAM_MINUTES })}
          />
        </label>
        {started && (
          <dl className="stat-list">
            <div><dt>Exam ends</dt><dd>{new Date(examEnd).toLocaleString()}</dd></div>
            <div><dt>Report due</dt><dd>{new Date(reportDue).toLocaleString()}</dd></div>
          </dl>
        )}
        <div className="exam-actions">
          {!started && <button type="button" className="button" onClick={() => actions.updateExam({ startedAt: new Date().toISOString() })}>Start now</button>}
          {started && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => { if (window.confirm("Clear the exam clock?")) actions.updateExam({ startedAt: "" }); }}
            >
              Clear clock
            </button>
          )}
        </div>
        <p className="exam-note">Times are local to this browser. Confirm limits in the current OffSec exam guide.</p>
      </div>
    </details>
  );
}

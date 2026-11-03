import { useRef, useState } from "react";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { fileToEvidence, routeEvidence } from "../lib/evidence";
import { stripAnsi } from "../lib/terminalText";

const itemTitles = Object.fromEntries(ALL_ITEMS.map((item) => [item.id, item.title]));

export default function EvidenceInbox() {
  const { actions } = useWorkspace();
  const inputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);

  const ingest = async (files) => {
    const routed = [];
    const errors = [];
    for (const file of files) {
      try {
        const evidence = await fileToEvidence(file);
        const itemId = routeEvidence(file.name, stripAnsi(evidence.content));
        actions.addEvidence(itemId, evidence);
        routed.push(`${file.name} → ${itemTitles[itemId] || itemId}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
    setMessage([...routed, ...errors].join(" · "));
  };

  const choose = async (event) => {
    await ingest([...event.target.files]);
    event.target.value = "";
  };

  const drop = async (event) => {
    event.preventDefault();
    setDragging(false);
    await ingest([...event.dataTransfer.files]);
  };

  return (
    <section
      className={`evidence-inbox ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div>
        <p className="eyebrow">Evidence inbox</p>
        <strong>Drop command output or screenshots here.</strong>
        <span>Files are routed to the closest check and parsed for ports, domains, credentials, hashes, and tickets.</span>
      </div>
      <button type="button" className="button secondary" onClick={() => inputRef.current?.click()}>Choose files</button>
      <input ref={inputRef} className="sr-only" type="file" multiple onChange={choose} />
      {message && <p className="inbox-message" role="status">{message}</p>}
    </section>
  );
}

import { PRACTICE_GROUPS, practiceBoxById } from "../data/practiceBoxes";

export default function PracticeBoxSelect({ value = "", onSelect }) {
  return (
    <label className="practice-box-select">
      <span>Practice box preset</span>
      <select value={value} onChange={(event) => onSelect(practiceBoxById(event.target.value) || null)}>
        <option value="">Manual / exam machine</option>
        {PRACTICE_GROUPS.map((group) => (
          <optgroup label={group.label} key={group.key}>
            {group.boxes.map((box) => {
              const annotations = box.tags.filter((tag) => ["assumed-breach", "legacy-os", "multi-host-chain", "enterprise"].includes(tag));
              return <option value={box.id} key={box.id}>{box.name}{annotations.length ? ` — ${annotations.join(", ")}` : ""}</option>;
            })}
          </optgroup>
        ))}
      </select>
      <small>Presets separate core, legacy, post-OSCP, and enterprise scope. Linked lab-building resources are tracked in coverage data but are not machine presets.</small>
    </label>
  );
}

import { PRACTICE_GROUPS, practiceBoxById } from "../data/practiceBoxes";

export default function PracticeBoxSelect({ value = "", onSelect }) {
  return (
    <label className="practice-box-select">
      <span>Practice box preset</span>
      <select value={value} onChange={(event) => onSelect(practiceBoxById(event.target.value) || null)}>
        <option value="">Manual / exam machine</option>
        {PRACTICE_GROUPS.map((group) => (
          <optgroup label={group.label} key={group.key}>
            {group.boxes.map((box) => <option value={box.id} key={box.id}>{box.name}</option>)}
          </optgroup>
        ))}
      </select>
      <small>Presets organize reusable methodology, not walkthrough spoilers. <a href="https://0xdf.gitlab.io/cheatsheets/offsec" target="_blank" rel="noreferrer">HTB OSCP list source</a></small>
    </label>
  );
}

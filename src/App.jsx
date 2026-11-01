import { NavLink, Route, Routes } from "react-router";

const pages = [
  { to: "/", label: "Checklist" },
  { to: "/targets", label: "Targets" },
  { to: "/vault", label: "Findings" },
  { to: "/backup", label: "Backup" },
];

function Placeholder({ eyebrow, title, copy }) {
  return (
    <main className="page-shell placeholder">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{copy}</p>
    </main>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Fieldnotes home">
          <span className="brand-mark">F/</span>
          <span>FIELDNOTES</span>
          <small>OSCP+</small>
        </NavLink>
        <nav aria-label="Primary navigation">
          {pages.map((page) => (
            <NavLink key={page.to} to={page.to} end={page.to === "/"}>
              {page.label}
            </NavLink>
          ))}
        </nav>
        <div className="storage-status" title="Saved in this browser">
          <span aria-hidden="true" /> Local
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <Placeholder
              eyebrow="Operator checklist"
              title="Keep the methodology close."
              copy="The checklist workspace is being assembled here."
            />
          }
        />
        <Route
          path="/targets"
          element={
            <Placeholder
              eyebrow="Target book"
              title="One place for every host."
              copy="Target context and variables will live here."
            />
          }
        />
        <Route
          path="/vault"
          element={
            <Placeholder
              eyebrow="Evidence locker"
              title="Keep what mattered."
              copy="Accounts, loot, and command output will be collected here."
            />
          }
        />
        <Route
          path="/backup"
          element={
            <Placeholder
              eyebrow="Portable state"
              title="Leave no notes behind."
              copy="Import and export will make this workspace portable."
            />
          }
        />
      </Routes>
    </div>
  );
}

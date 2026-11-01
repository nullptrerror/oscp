import { NavLink, Route, Routes } from "react-router";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import ChecklistPage from "./pages/ChecklistPage";
import TargetsPage from "./pages/TargetsPage";

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

function AppRoutes() {
  const { saveState } = useWorkspace();
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
        <div className={`storage-status ${saveState.status}`} title={saveState.message}>
          <span aria-hidden="true" /> {saveState.status === "error" ? "Storage error" : "Local"}
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={<ChecklistPage />}
        />
        <Route
          path="/targets"
          element={<TargetsPage />}
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

export default function App() {
  return (
    <WorkspaceProvider>
      <AppRoutes />
    </WorkspaceProvider>
  );
}

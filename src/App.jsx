import { NavLink, Route, Routes } from "react-router";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import ChecklistPage from "./pages/ChecklistPage";
import TargetsPage from "./pages/TargetsPage";
import FindingsPage from "./pages/FindingsPage";
import BackupPage from "./pages/BackupPage";
import ReportPage from "./pages/ReportPage";
import ExamClock from "./components/ExamClock";

const pages = [
  { to: "/", label: "Checklist" },
  { to: "/targets", label: "Machines" },
  { to: "/vault", label: "Findings" },
  { to: "/report", label: "Report" },
];

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
        <div className="topbar-status">
          <ExamClock />
          <div className={`storage-status ${saveState.status}`} title={saveState.message}>
            <span aria-hidden="true" /> {saveState.status === "error" ? "Storage error" : "Local"}
          </div>
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
          element={<FindingsPage />}
        />
        <Route
          path="/report"
          element={<ReportPage />}
        />
        <Route
          path="/backup"
          element={<BackupPage />}
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

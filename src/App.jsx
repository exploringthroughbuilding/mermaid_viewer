import { lazy, Suspense } from "react";
import ViewerPage from "./viewer/ViewerPage.jsx";

const DebugPage = import.meta.env.DEV ? lazy(() => import("./debug/DebugPage.jsx")) : null;

export default function App() {
  if (window.location.pathname !== "/debug") return <ViewerPage />;
  if (!DebugPage) return <ViewerPage />;
  return (
    <Suspense fallback={<div className="route-loading">Loading syntax laboratory…</div>}>
      <DebugPage />
    </Suspense>
  );
}

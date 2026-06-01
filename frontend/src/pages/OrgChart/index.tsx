// Org Chart router. The parent <Route path="/org-chart/*"> in App.tsx
// hands sub-paths to us; we choose home (project list) vs. editor.

import { Route, Routes } from "react-router-dom";

import OrgChartEditor from "./OrgChartEditor";
import OrgChartHome from "./OrgChartHome";

export default function OrgChart() {
  return (
    <Routes>
      <Route index element={<OrgChartHome />} />
      <Route path=":id" element={<OrgChartEditor />} />
    </Routes>
  );
}

// Cash Flow Returns — app router.
//   /cash-flow-returns                    pipeline dashboard
//   /cash-flow-returns/:dealId            deal workspace (PDF-mirror canvas)
//   /cash-flow-returns/:dealId/print      print-friendly summary (Phase 9)

import { Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DealWorkspace from "./pages/DealWorkspace";
import DealPrint from "./pages/DealPrint";

export default function CashFlowReturnsApp() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path=":dealId" element={<DealWorkspace />} />
      <Route path=":dealId/print" element={<DealPrint />} />
    </Routes>
  );
}

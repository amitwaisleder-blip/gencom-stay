// Intern Program — module entry point.
//
// Mounted at /intern-program/* in App.tsx. Wraps every route with
// RoleProvider (URL-driven `?as=…` viewpoint) and the module-scoped
// CSS class so the design tokens / animations don't bleed into the
// rest of the host app.
//
// Routes (paths absolute, mounted under /intern-program by App.tsx):
//   /                       Interns list
//   /coffee-chats           Module-level coffee chat directory
//   /:id                    Intern profile (bio + resume + skills)
//   /:id/schedule           Week / month / timeline scheduler
//   /:id/deliverables       Phase 2 — output log
//   /:id/goals              Phase 2 — learning goals + check-ins
//   /:id/feedback           Phase 2 — manager weekly pulses
//   /:id/kudos              Phase 4 — public recognition
//   /:id/shadow-days        Phase 3 — request half-day with another team
//   /:id/return-offer       Phase 4 — manager edit-own / HR view-all
//   /:id/portfolio          Phase 4 — auto-compiled, exportable to PDF

import { Route, Routes } from "react-router-dom";

import { TooltipProvider } from "./components/ui/tooltip";
import { RoleProvider } from "./lib/role";

import "./styles.css";

import InternsListRoute from "./routes/InternsListRoute";
import InternLayout from "./routes/InternLayout";
import ProfileRoute from "./routes/ProfileRoute";
import ScheduleRoute from "./routes/ScheduleRoute";
import DeliverablesRoute from "./routes/DeliverablesRoute";
import GoalsRoute from "./routes/GoalsRoute";
import FeedbackRoute from "./routes/FeedbackRoute";
import ShadowDaysRoute from "./routes/ShadowDaysRoute";
import ReturnOfferRoute from "./routes/ReturnOfferRoute";
import { ModuleSubHeader } from "./components/module/sub-header";

export default function InternProgram() {
  return (
    <RoleProvider>
      <TooltipProvider delayDuration={150}>
        <div className="intern-module flex flex-col gap-4">
          <ModuleSubHeader />
          <Routes>
            <Route index element={<InternsListRoute />} />
            <Route path=":id" element={<InternLayout />}>
              <Route index element={<ProfileRoute />} />
              <Route path="schedule" element={<ScheduleRoute />} />
              <Route path="deliverables" element={<DeliverablesRoute />} />
              <Route path="goals" element={<GoalsRoute />} />
              <Route path="feedback" element={<FeedbackRoute />} />
              <Route path="shadow-days" element={<ShadowDaysRoute />} />
              <Route path="return-offer" element={<ReturnOfferRoute />} />
            </Route>
          </Routes>
        </div>
      </TooltipProvider>
    </RoleProvider>
  );
}

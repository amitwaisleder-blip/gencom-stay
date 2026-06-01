import { Route, Routes } from "react-router-dom";
import CapexTrackerHome from "./Home";
import ProjectView, { HotelView } from "./ProjectView";
import SingleHotelWizard from "./wizards/SingleHotelWizard";
import PortfolioWizard from "./wizards/PortfolioWizard";
import ProjectWizard from "./wizards/ProjectWizard";

export default function CapexTracker() {
  return (
    <Routes>
      <Route index element={<CapexTrackerHome />} />
      <Route path="new/single" element={<SingleHotelWizard />} />
      <Route path="new/portfolio" element={<PortfolioWizard />} />
      <Route path="new/project" element={<ProjectWizard />} />
      <Route path="projects/:id" element={<ProjectView />} />
      <Route path="projects/:id/hotels/:hotelId" element={<HotelView />} />
    </Routes>
  );
}

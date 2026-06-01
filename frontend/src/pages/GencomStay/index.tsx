// Gencom Stay — internal portal for Gencom team members to request
// complimentary / discounted stays at portfolio properties. Tone is
// luxury-hospitality: warm off-white surfaces, muted gold accent,
// Cormorant Garamond for property names, Inter for body.

import { Route, Routes } from "react-router-dom";
import PortfolioList from "./PortfolioList";
import PropertyDetail from "./PropertyDetail";
import RequestStay from "./RequestStay";

export default function GencomStay() {
  return (
    // A warm off-white background wraps every Gencom Stay screen. The
    // negative margins pull against the outer dashboard padding so the
    // luxury surface runs edge-to-edge without fighting the header.
    <div className="-mx-6 -my-8 min-h-[calc(100vh-100px)] bg-[#faf7f1] text-[#1a1d24]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <Routes>
          <Route index element={<PortfolioList />} />
          <Route path="properties/:id" element={<PropertyDetail />} />
          <Route path="properties/:id/request" element={<RequestStay />} />
        </Routes>
      </div>
    </div>
  );
}

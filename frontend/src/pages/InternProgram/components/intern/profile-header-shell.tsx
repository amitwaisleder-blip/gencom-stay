import { useLocation } from "react-router-dom";

import { ProfileHeader } from "./profile-header";
import type { Intern } from "@/data";

/** Hides the per-intern profile header on the /portfolio route — the
 *  portfolio page renders its own banner header and the duplicate
 *  reads as visual noise. Everywhere else it shows normally. */
export function ProfileHeaderShell({ intern }: { intern: Intern }) {
  const { pathname } = useLocation();
  if (pathname.endsWith("/portfolio")) return null;
  return (
    <div className="intern-profile-header">
      <ProfileHeader intern={intern} />
    </div>
  );
}

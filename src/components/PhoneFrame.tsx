import type { ReactNode } from "react";

/**
 * Wraps the app in an iPhone-style device frame on desktop so the mobile-first UI
 * can be previewed true-to-size. On real phones (narrow viewports) the frame
 * collapses via `display: contents` (see styles.css) and the app goes full-screen.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="device-stage">
      <div className="device">
        <div className="device-screen">
          <span className="device-island" />
          {children}
        </div>
      </div>
      <p className="device-caption">
        Mobile preview — open on your phone (or narrow this window) for full screen.
        <br />
        <span className="device-build">build {__BUILD_ID__}</span>
      </p>
    </div>
  );
}

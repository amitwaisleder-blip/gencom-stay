import { RoleSwitcher } from "./role-switcher";

/** Module-level sub-header — Demo Mode pinned left, role switcher
 *  right. The intern profile header overlays its own Edit Profile
 *  button into the right slot when active so users can hit Edit and
 *  the role switcher from the same row without scrolling. */
export function ModuleSubHeader() {
  return (
    <div
      id="intern-module-subheader-actions"
      className="flex items-center justify-between gap-3 pb-2 print:hidden"
    >
      <span
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] font-semibold text-muted-foreground"
        aria-hidden
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
        Demo Mode
      </span>
      <div
        className="flex items-center gap-2"
        id="intern-module-subheader-right"
      >
        {/* Profile-header portals its Edit Profile button into this
         *  slot so it sits next to the role switcher. Filled at runtime. */}
        <div id="intern-module-subheader-edit-slot" className="flex items-center gap-2" />
        <RoleSwitcher />
      </div>
    </div>
  );
}

// Hosts the standalone "Overlap · Gencom Meeting Scheduler" inside the
// dashboard chrome. Unlike the Catering / Inbox Briefing embeds, the
// scheduler is a fully self-contained static page (all markup, styles, and
// logic inline; only the EmailJS CDN is fetched at runtime). It ships in
// frontend/public/meeting-scheduler.html, which Vite serves at the site
// root — so there's no separate server to launch and the iframe is always
// reachable. We just frame it full-bleed below the header.

const SCHEDULER_URL = "/meeting-scheduler.html";

export default function MeetingSchedulerEmbed() {
  return (
    <div
      style={{ marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)" }}
      className="px-4 md:px-6"
    >
      <iframe
        src={SCHEDULER_URL}
        title="Gencom Meeting Scheduler"
        className="w-full border border-gencom-sand rounded-2xl bg-white shadow-card"
        // 57px sticky header + ~32px breathing room — pin the iframe to fill
        // the viewport below the dashboard chrome so the scheduler feels
        // like a first-class section, not a tiny embed.
        style={{ height: "calc(100vh - 120px)" }}
      />
    </div>
  );
}

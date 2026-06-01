// Hosts the standalone Inbox Briefing app inside the Gencom dashboard
// chrome via an iframe — same pattern as CateringEmbed. The app runs as
// a separate FastAPI + Vite process on ports 8001 and 5180; the
// dashboard's start.ps1 boots it alongside the backend and frontend, but
// when someone runs the dashboard without it the iframe would show a
// "127.0.0.1 refused to connect" page. Detect that and surface
// instructions instead.

import { useEffect, useRef, useState } from "react";

const IB_HOST = "127.0.0.1";
const IB_PORT = 5180;
const IB_URL = `http://${IB_HOST}:${IB_PORT}`;
// `?embed=1` tells the inbox-briefing app to skip its own standalone
// landing page (the duplicate "Inbox Briefing" tile + placeholder
// Atrium/Rostrum/Wayfinder tiles) and route straight to setup or
// today's briefing depending on health.
const IB_EMBED_URL = `${IB_URL}/?embed=1`;

type Reachability = "checking" | "ok" | "down";

export default function InboxBriefingEmbed() {
  const [status, setStatus] = useState<Reachability>("checking");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Same probe pattern as CateringEmbed — a no-cors fetch tells us if
  // anything is listening on the port without trying to read the body.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function probe() {
      try {
        await fetch(IB_URL, { mode: "no-cors", cache: "no-store" });
        if (!cancelled) setStatus("ok");
      } catch {
        if (!cancelled) {
          setStatus("down");
          timer = setTimeout(probe, 3000);
        }
      }
    }
    probe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      style={{ marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)" }}
      className="px-4 md:px-6"
    >
      {status === "ok" ? (
        <iframe
          ref={iframeRef}
          src={IB_EMBED_URL}
          title="Inbox Briefing"
          className="w-full border border-gencom-sand rounded-md bg-white"
          style={{ height: "calc(100vh - 120px)" }}
        />
      ) : (
        <ServerDown status={status} />
      )}
    </div>
  );
}

function ServerDown({ status }: { status: Reachability }) {
  return (
    <div className="w-full flex items-center justify-center" style={{ height: "calc(100vh - 120px)" }}>
      <div className="max-w-xl bg-white border border-gencom-sand rounded-md p-8 shadow-sm">
        <div className="t-eyebrow text-gencom-stone mb-2">Inbox Briefing</div>
        <div className="t-h1 mb-4">
          {status === "checking" ? "Connecting…" : "Inbox Briefing server isn't running"}
        </div>

        {status === "checking" && (
          <p className="t-body text-gencom-stone">
            Looking for the Inbox Briefing app at{" "}
            <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">{IB_URL}</code>…
          </p>
        )}

        {status === "down" && (
          <>
            <p className="t-body mb-4">
              Inbox Briefing runs as a separate FastAPI + Vite stack on{" "}
              <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">{IB_URL}</code>{" "}
              (backend on :8001). The dashboard embeds it in an iframe — when
              its servers aren't up, you'd see "127.0.0.1 refused to connect"
              here.
            </p>

            <div className="t-eyebrow mb-2 text-gencom-stone">Fix</div>
            <p className="t-body mb-3">
              <span className="font-semibold">Easiest:</span> double-click{" "}
              <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">inbox-briefing/start.bat</code>.
              First run creates a Python venv and installs deps; later runs
              start instantly.
            </p>
            <p className="t-body mb-3">
              <span className="font-semibold">Manual:</span>
            </p>
            <pre
              className="text-[12px] bg-gencom-ink/95 text-white rounded px-3 py-3 overflow-x-auto"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            >
              cd inbox-briefing{"\n"}.\start.ps1
            </pre>

            <p className="t-micro text-gencom-stone mt-4">
              This page auto-checks every 3 seconds — once the server boots,
              the briefing app will load here without a page refresh.
            </p>

            <div className="mt-5 flex gap-2">
              <a
                href={IB_EMBED_URL}
                target="_blank"
                rel="noreferrer"
                className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
              >
                Open in new tab
              </a>
              <button
                onClick={() => window.location.reload()}
                className="t-eyebrow px-3 py-1.5 bg-emerald-700 text-white rounded-md hover:bg-emerald-800"
              >
                Reload now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

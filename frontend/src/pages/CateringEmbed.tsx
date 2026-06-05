// Hosts the standalone Gencom Catering Request app (a separate Next.js
// process on port 3002) inside an iframe so it lives under the Gencom
// dashboard chrome. start.ps1 launches the catering server alongside the
// dashboard automatically — but if someone runs the frontend without it
// (e.g. via `npm run dev` directly) the iframe would show a blank
// "127.0.0.1 refused to connect" page. Detect that case and show
// actionable instructions instead.

import { useEffect, useRef, useState } from "react";

const CATERING_HOST = "127.0.0.1";
const CATERING_PORT = 3002;
const CATERING_URL = `http://${CATERING_HOST}:${CATERING_PORT}`;

type Reachability = "checking" | "ok" | "down";

export default function CateringEmbed() {
  const [status, setStatus] = useState<Reachability>("checking");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Poll until the catering server answers. Browsers block reading the
  // body of cross-origin requests, but a bare `fetch` with no-cors will
  // succeed if anything is listening at all — and reject if the port is
  // refused. That's the signal we use to flip "down" → "ok" once the
  // server boots, so the user doesn't have to refresh the page.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function probe() {
      try {
        // mode: "no-cors" — we just want to know if the TCP handshake works.
        await fetch(CATERING_URL, { mode: "no-cors", cache: "no-store" });
        if (!cancelled) setStatus("ok");
      } catch {
        if (!cancelled) {
          setStatus("down");
          // Re-probe every 3s while down — picks up the moment the user
          // boots the server in another terminal.
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
          src={CATERING_URL}
          title="Gencom Catering Request"
          className="w-full border border-gencom-sand rounded-md bg-white"
          // 57px sticky header + ~32px breathing room. Pin the iframe to
          // fill the viewport below the dashboard chrome so the catering
          // app feels like a first-class section, not a tiny embed.
          style={{ height: "calc(100vh - 120px)" }}
        />
      ) : (
        <CateringServerDown status={status} />
      )}
    </div>
  );
}

function CateringServerDown({ status }: { status: Reachability }) {
  return (
    <div
      className="w-full flex items-center justify-center"
      style={{ height: "calc(100vh - 120px)" }}
    >
      <div className="max-w-xl bg-white border border-gencom-sand rounded-md p-8 shadow-sm">
        <div className="t-eyebrow text-gencom-stone mb-2">Catering App</div>
        <div className="t-h1 mb-4">
          {status === "checking" ? "Connecting…" : "Catering server isn't running"}
        </div>

        {status === "checking" && (
          <p className="t-body text-gencom-stone">
            Looking for the catering app at <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">{CATERING_URL}</code>…
          </p>
        )}

        {status === "down" && (
          <>
            <p className="t-body mb-4">
              The catering app runs as a separate Next.js process on
              <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded mx-1">{CATERING_URL}</code>.
              The dashboard embeds it in an iframe — when its server isn't
              up, you'd see "127.0.0.1 refused to connect" in this panel.
            </p>

            <div className="t-eyebrow mb-2 text-gencom-stone">Fix</div>
            <p className="t-body mb-3">
              <span className="font-semibold">Easiest:</span> double-click{" "}
              <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">gencom-catering-request/start-catering.bat</code>.
              It auto-finds portable Node and runs the dev server — works even
              if <code className="text-[11px]">node</code> isn't on your system PATH.
            </p>
            <p className="t-body mb-3">
              <span className="font-semibold">Or:</span> re-launch the dashboard via{" "}
              <code className="text-[12px] bg-gencom-mist px-1 py-0.5 rounded">start.bat</code>{" "}
              — it now boots the catering server alongside the backend and frontend.
            </p>
            <p className="t-body mb-3">
              <span className="font-semibold">Manual command line</span> (only if you have Node on PATH):
            </p>
            <pre
              className="text-[12px] bg-gencom-ink/95 text-white rounded px-3 py-3 overflow-x-auto"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            >
              cd gencom-catering-request{"\n"}npm run dev
            </pre>
            <p className="t-micro text-gencom-stone mt-2">
              "<code>'npm' is not recognized</code>" means Node isn't on PATH —
              use the <code>start-catering.bat</code> path above instead.
            </p>

            <p className="t-micro text-gencom-stone mt-4">
              This page is auto-checking every 3 seconds — once the server
              boots, the catering form will load here without a page refresh.
            </p>

            <div className="mt-5 flex gap-2">
              <a
                href={CATERING_URL}
                target="_blank"
                rel="noreferrer"
                className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
              >
                Open in new tab
              </a>
              <button
                onClick={() => window.location.reload()}
                className="t-eyebrow px-3 py-1.5 bg-gencom-green text-white rounded-md hover:bg-gencom-greendark"
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

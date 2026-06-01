import { Link, useLocation } from "react-router-dom";

const COPY: Record<string, { title: string; blurb: string; icon: string }> = {
  "/fast-budget": {
    title: "Fast Budget Generator",
    icon: "⚡",
    blurb:
      "A quick budget tool for situations where full scope isn't available yet. Working on it — the backend is in progress.",
  },
  "/pip-generator": {
    title: "PIP Generator",
    icon: "📋",
    blurb:
      "Scope-narrowing tool for early-stage deals. Will produce a PIP-style list you can import into the Full Budget Generator. In development.",
  },
};

export default function ComingSoon() {
  const { pathname } = useLocation();
  const info = COPY[pathname] ?? { title: "Coming Soon", icon: "🚧", blurb: "This tool is in development." };
  return (
    <div className="max-w-xl mx-auto text-center py-16">
      <div className="text-6xl mb-4">{info.icon}</div>
      <h1 className="font-display text-4xl text-gencom-ink">{info.title}</h1>
      <div className="mt-2 text-2xl font-display text-gencom-gold">Coming Soon!</div>
      <p className="mt-4 text-sm text-gencom-stone">{info.blurb}</p>
      <Link
        to="/"
        className="mt-6 inline-block px-4 py-2 border border-gencom-sand rounded-md bg-white text-sm hover:bg-gencom-mist"
      >
        ← Back to home
      </Link>
    </div>
  );
}

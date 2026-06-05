// Reusable "Coming Soon" placeholder page. New tiles on the dashboard
// home that don't have a real page yet route here by passing a title
// (and optional short blurb) as props.

import { Link } from "react-router-dom";

export default function ComingSoonPage({
  title, blurb,
}: { title: string; blurb?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-[11px] uppercase tracking-[0.22em] text-gencom-gold font-semibold">
        {title}
      </div>
      <h1 className="mt-3 font-display text-5xl md:text-6xl uppercase tracking-[0.15em] text-gencom-ink">
        Coming Soon!
      </h1>
      <div className="mt-5 h-px w-16 bg-gencom-gold" />
      {blurb && (
        <p className="mt-5 max-w-md text-[14px] leading-relaxed text-gencom-stone">
          {blurb}
        </p>
      )}
      <Link
        to="/"
        className="mt-8 text-[11px] uppercase tracking-[0.18em] font-semibold text-gencom-stone hover:text-gencom-ink"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}

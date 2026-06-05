// The Gencom emblem and the third-party brand glyphs used on action buttons.
// The emblem is served from /gencom-logo.svg — replace that file with the official
// asset any time to use the exact brand image; everything here picks it up.

export function Logo({ size = 34, className = "" }: { size?: number; className?: string }) {
  // Styled badge per the Alpine design direction: serif italic "g" on the accent
  // green. Replace /gencom-logo.svg (used for favicons/app icons) with the official
  // asset any time; this in-app mark mirrors it.
  return (
    <span
      className={`gm-logo ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize: Math.round(size * 0.62),
      }}
      aria-label="Gencom"
    >
      g
    </span>
  );
}

/** Microsoft four-square logo for the sign-in button. */
export function MicrosoftLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

/** Simplified Outlook glyph for the "Save to Outlook" button. */
export function OutlookLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9.5" y="4" width="11" height="16" rx="1.5" fill="#0a6cb4" />
      <path d="M11 8h8M11 12h8M11 16h5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="2.5" y="6" width="11" height="12" rx="2.5" fill="#0f7fd4" />
      <text
        x="8"
        y="15.5"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize="9"
        fontWeight="700"
        fill="#fff"
      >
        O
      </text>
    </svg>
  );
}

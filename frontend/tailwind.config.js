/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gencom: {
          ink: "#1a1d24",      // primary text / near-black
          stone: "#6b6f78",    // secondary text / muted
          sand: "#e7e2d6",     // hairline borders (lightened for a cleaner, modern edge)
          line: "#efece4",     // extra-subtle dividers
          green: "#4f6f55",    // primary brand accent (matches the logo)
          greendark: "#3f5944",// darker green for hover/active on solid green buttons
          greensoft: "#e3ebe3",// tinted green for soft fills / focus rings
          gold: "#b89555",     // secondary accent (used sparingly)
          goldsoft: "#ece1c8", // tinted gold for soft fills
          mist: "#f7f5f0",     // app background (cleaner off-white)
          cloud: "#fcfbf8",    // elevated surface tint between white and mist
        },
        // ---- Intern Program tokens (HSL CSS vars in src/styles/intern.css) ----
        // Scoped via .intern-module class on the wrapper so they don't bleed
        // into the rest of the pip-budget-app surfaces.
        background: "hsl(var(--background, 0 0% 100%))",
        foreground: "hsl(var(--foreground, 222 14% 11%))",
        muted: { DEFAULT: "hsl(var(--muted, 220 14% 96%))", foreground: "hsl(var(--muted-foreground, 220 9% 46%))" },
        card: { DEFAULT: "hsl(var(--card, 0 0% 100%))", foreground: "hsl(var(--card-foreground, 222 14% 11%))" },
        border: "hsl(var(--border, 220 13% 91%))",
        input: "hsl(var(--input, 220 13% 91%))",
        ring: "hsl(var(--ring, 222 84% 56%))",
        accent: { DEFAULT: "hsl(var(--accent, 222 84% 56%))", foreground: "hsl(var(--accent-foreground, 210 20% 98%))" },
        primary: { DEFAULT: "hsl(var(--primary, 222 84% 56%))", foreground: "hsl(var(--primary-foreground, 210 20% 98%))" },
        secondary: { DEFAULT: "hsl(var(--secondary, 220 14% 96%))", foreground: "hsl(var(--secondary-foreground, 222 14% 11%))" },
        destructive: { DEFAULT: "hsl(var(--destructive, 0 72% 51%))", foreground: "hsl(var(--destructive-foreground, 0 0% 98%))" },
        success: { DEFAULT: "hsl(var(--success, 152 60% 36%))", foreground: "hsl(var(--success-foreground, 0 0% 98%))" },
        warning: { DEFAULT: "hsl(var(--warning, 36 90% 50%))", foreground: "hsl(var(--warning-foreground, 0 0% 14%))" },
        // Department palette — picked to differentiate at a glance in the
        // scheduler's mix bar. Stable hex (no CSS var) so they read identically
        // inside or outside the .intern-module scope.
        dept: {
          // Keys preserved from the original seed so existing rows
          // resolve; the labels in vocabularies.ts map them to the
          // Gencom org's actual departments.
          engineering: "hsl(214 92% 56%)",  // Design + Construction
          product: "hsl(262 70% 60%)",      // Acquisitions
          design: "hsl(330 80% 60%)",       // Interior Design
          data: "hsl(173 75% 38%)",         // Capital Markets
          operations: "hsl(28 90% 55%)",    // Accounting
          marketing: "hsl(8 80% 60%)",      // Legal
          finance: "hsl(140 50% 40%)",      // Finance
          tax: "hsl(48 70% 45%)",           // Tax (new)
        },
      },
      borderRadius: {
        // Intern module radius — falls back to a default if the CSS var
        // isn't set so non-module pages still get a sane value.
        lg: "var(--radius, 0.625rem)",
        md: "calc(var(--radius, 0.625rem) - 2px)",
        sm: "calc(var(--radius, 0.625rem) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        // Previously Georgia serif. Unified to Inter across the whole app —
        // only the Gencom wordmark in the top-left keeps the serif treatment
        // (via an inline font-family override in HeaderBrand).
        display: ["Inter", "system-ui", "sans-serif"],
        brand: ["Georgia", "serif"],
        // Cormorant Garamond — reserved for Gencom Stay property names and
        // luxury-hospitality display type. Imported from Google Fonts in index.html.
        "serif-display": ["'Cormorant Garamond'", "Cormorant", "Georgia", "serif"],
      },
      boxShadow: {
        // Modern, soft elevation scale — layered low-opacity shadows read
        // cleaner than a single hard drop shadow. Used by the shared .card
        // component class and the global header/nav.
        card: "0 1px 2px rgba(26,29,36,0.04), 0 1px 3px rgba(26,29,36,0.05)",
        "card-hover": "0 12px 32px -12px rgba(26,29,36,0.20), 0 2px 6px rgba(26,29,36,0.06)",
        header: "0 1px 0 rgba(26,29,36,0.05), 0 6px 20px -16px rgba(26,29,36,0.25)",
        ring: "0 0 0 3px rgba(79,111,85,0.28)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 220ms ease-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

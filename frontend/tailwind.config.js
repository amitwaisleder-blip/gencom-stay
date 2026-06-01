/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gencom: {
          ink: "#1a1d24",
          stone: "#6b6f78",
          sand: "#d9d4c8",
          gold: "#b89555",
          mist: "#f5f3ee",
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

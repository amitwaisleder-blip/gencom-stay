import { useEffect, useState } from "react";

/**
 * Fixed-position "↑ Back to top" chip that appears only after the user has
 * scrolled far enough that the top of the page is off-screen. Click to smooth-
 * scroll back. Intended for long pages like Scope Review, Scope Overview, and
 * Budget Summary.
 */
export default function BackToTop({ threshold = 600 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > threshold);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-30 flex items-center gap-1.5 px-4 py-2 rounded-full shadow-lg bg-gencom-ink text-gencom-mist hover:bg-gencom-ink/90 text-sm font-semibold border border-gencom-ink"
      title="Scroll back to the top of the page"
      aria-label="Back to top"
    >
      <span className="text-base leading-none">↑</span>
      <span>Back to top</span>
    </button>
  );
}

// Everything PropertyNav used to render (5 tabs, Refresh, Chat) now lives in
// the sticky app header — see App.tsx. The component stays as a no-op so we
// don't have to surgically remove every <PropertyNav /> callsite on the pages.
export default function PropertyNav() {
  return null;
}

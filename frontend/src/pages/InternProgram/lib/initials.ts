/** Build initials from a name. "Mira Anand" → "MA"; single word → first 2 chars.
 *  Lives outside "use client" files so server components can call it. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

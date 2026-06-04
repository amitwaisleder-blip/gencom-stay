import {
  ShieldAlert,
  Tag,
  CalendarDays,
  Newspaper,
  Users,
  Package,
  User,
  AtSign,
  type LucideIcon,
} from "lucide-react";
import type { EmailMessage } from "../models/types";
import { categoryOf, levelOf } from "../intel/category";

const ICONS: Record<string, LucideIcon> = {
  security: ShieldAlert,
  social: AtSign,
  promo: Tag,
  calendar: CalendarDays,
  news: Newspaper,
  group: Users,
  update: Package,
  person: User,
};

/** A tinted rounded tile with a category icon, colored by predicted priority. */
export function Avatar({ message, size = 44 }: { message: EmailMessage; size?: number }) {
  const level = levelOf(message);
  const Icon = ICONS[categoryOf(message)] ?? User;
  return (
    <span
      className={`avatar lvl-${level}`}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      <Icon size={size * 0.5} strokeWidth={2} />
    </span>
  );
}

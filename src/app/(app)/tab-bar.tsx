"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/today", label: "Today", icon: "◉" },
  { href: "/week", label: "Week", icon: "▦" },
  { href: "/food", label: "Food", icon: "◐" },
  { href: "/progress", label: "Progress", icon: "↗" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`tap flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-0.5 text-xs ${
                  active ? "text-accent font-semibold" : "text-muted"
                }`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

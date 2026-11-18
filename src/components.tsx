import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export const inputCls = "tap w-full rounded-xl border border-line bg-surface-2 px-3 text-base";
export const primaryBtn = "tap flex items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-fg";
export const secondaryBtn = "tap flex items-center justify-center rounded-xl border border-line bg-surface-2 px-4 font-semibold";

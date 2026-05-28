import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32", className)}>
      <div className="mx-auto w-full max-w-7xl">{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "center"
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <p className="mb-4 text-xs font-medium uppercase tracking-[0.28em] text-emerald-300/70">{eyebrow}</p>
      <h2 className="text-balance text-4xl font-semibold tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      {description ? <p className="mt-6 text-pretty text-base leading-8 text-zinc-400 sm:text-lg">{description}</p> : null}
    </div>
  );
}

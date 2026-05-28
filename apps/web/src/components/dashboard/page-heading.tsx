import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.28em] text-emerald-300/70">{eyebrow}</p>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        <p className="mt-5 text-pretty text-base leading-8 text-zinc-400 sm:text-lg">{description}</p>
      </div>
      {action}
    </div>
  );
}

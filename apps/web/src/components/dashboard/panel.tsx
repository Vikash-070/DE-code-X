import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  children,
  className
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass rounded-[28px] p-6", className)}>
      {title ? <h2 className="mb-6 text-lg font-semibold tracking-[-0.02em] text-white">{title}</h2> : null}
      {children}
    </div>
  );
}

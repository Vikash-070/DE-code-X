"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

const nodePositions = [
  ["left-[14%] top-[16%]", "API"],
  ["right-[16%] top-[22%]", "Auth"],
  ["left-[10%] top-[54%]", "State"],
  ["left-[43%] top-[43%]", "Graph"],
  ["right-[12%] bottom-[18%]", "Risk"]
];

export function RepositoryGraph({ className }: { className?: string }) {
  return (
    <div className={cn("relative min-h-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#050707]", className)}>
      <motion.div
        className="moving-grid absolute inset-0 opacity-25"
        animate={{ backgroundPosition: ["0 0", "52px 52px"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(29,118,89,.26),transparent_46%),linear-gradient(180deg,transparent,#050707_88%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 900 480" fill="none" aria-hidden>
        {[
          "M168 92 C310 55 498 88 690 124",
          "M166 270 C340 215 460 260 448 232",
          "M690 124 C748 226 724 290 776 372",
          "M126 276 C252 398 398 360 536 390"
        ].map((d) => (
          <motion.path
            key={d}
            d={d}
            stroke="url(#repo-line)"
            strokeWidth="1.5"
            strokeDasharray="8 10"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
          />
        ))}
        <defs>
          <linearGradient id="repo-line" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#6ee7b7" stopOpacity=".08" />
            <stop offset=".5" stopColor="#6ee7b7" stopOpacity=".82" />
            <stop offset="1" stopColor="#ffffff" stopOpacity=".12" />
          </linearGradient>
        </defs>
      </svg>
      {nodePositions.map(([position, label], index) => (
        <motion.div
          key={label}
          className={cn(
            "absolute grid h-20 w-20 place-items-center rounded-2xl border border-emerald-200/15 bg-black/55 text-xs font-medium text-emerald-100 shadow-glow backdrop-blur-xl",
            position
          )}
          animate={{ y: [0, -10, 0], scale: [1, 1.03, 1] }}
          transition={{ duration: 4 + index * 0.35, repeat: Infinity, ease: "easeInOut" }}
        >
          {label}
        </motion.div>
      ))}
    </div>
  );
}

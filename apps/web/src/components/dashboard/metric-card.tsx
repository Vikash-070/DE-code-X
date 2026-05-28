"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export function MetricCard({
  title,
  value,
  detail,
  icon: Icon
}: {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <motion.div whileHover={{ y: -6 }} className="glass rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-emerald-200" />
        <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.9)]" />
      </div>
      <p className="mt-8 text-sm text-zinc-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</p>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{detail}</p>
    </motion.div>
  );
}

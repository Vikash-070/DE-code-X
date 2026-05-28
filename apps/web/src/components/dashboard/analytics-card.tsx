"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export function AnalyticsCard({
  title,
  value,
  detail,
  icon: Icon,
  inverse = false
}: {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  inverse?: boolean;
}) {
  const displayValue = inverse ? 100 - value : value;

  return (
    <motion.div whileHover={{ y: -6 }} className="glass rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-emerald-200" />
        <span className="text-sm text-zinc-500">{displayValue}%</span>
      </div>
      <h3 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{detail}</p>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${displayValue}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-forest-700 to-emerald-300"
        />
      </div>
    </motion.div>
  );
}

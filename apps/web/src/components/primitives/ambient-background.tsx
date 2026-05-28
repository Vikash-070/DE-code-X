"use client";

import { motion } from "framer-motion";

export function AmbientBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-black">
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[-22rem] h-[50rem] w-[50rem] -translate-x-1/2 rounded-full bg-forest-700/25 blur-3xl"
        animate={{ scale: [1, 1.12, 1], opacity: [0.55, 0.9, 0.55] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-[6%] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-emerald-500/10 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="moving-grid absolute inset-0 opacity-[0.16]"
        animate={{ backgroundPosition: ["0px 0px", "52px 52px"] }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,transparent_0,rgba(0,0,0,.12)_38%,#000_78%)]" />
    </div>
  );
}

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-medium transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.14)] hover:bg-emerald-50",
        forest: "border border-emerald-300/25 bg-forest-700/80 text-white shadow-glow hover:border-emerald-200/50 hover:bg-forest-600",
        ghost: "border border-white/10 bg-white/[0.035] text-white backdrop-blur-xl hover:border-white/20 hover:bg-white/[0.07]",
        dark: "border border-white/10 bg-black/60 text-white hover:border-emerald-200/30 hover:bg-black"
      },
      size: {
        default: "h-11 px-5",
        sm: "h-8 px-4 text-xs",
        lg: "h-13 px-7 text-[15px]",
        icon: "h-10 w-10 px-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

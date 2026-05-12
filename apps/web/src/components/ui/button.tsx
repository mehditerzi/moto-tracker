import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg dark:focus-visible:ring-offset-bg-dark disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Default = inverted text/bg, our muted "secondary primary".
        default:
          "bg-text text-bg hover:bg-text/90 dark:bg-text-dark dark:text-bg-dark dark:hover:bg-text-dark/90",
        // Accent = the one place the lime appears. Black on lime, with an
        // ignition glow that's strongest at rest and tightens on hover so it
        // visually "fires".
        accent:
          "bg-accent text-black shadow-ignite hover:bg-accent/95 hover:shadow-[0_4px_18px_-4px_rgba(225,255,77,0.55)]",
        outline:
          "border border-border bg-transparent text-text hover:bg-surface hover:border-text/30 dark:border-border-dark dark:text-text-dark dark:hover:bg-surface-elev-dark dark:hover:border-text-dark/30",
        ghost:
          "text-text hover:bg-surface dark:text-text-dark dark:hover:bg-surface-elev-dark",
        danger:
          "bg-danger text-white shadow-sm shadow-danger/30 hover:bg-danger/90",
        link: "text-text underline-offset-4 hover:underline dark:text-text-dark",
      },
      size: {
        sm: "h-9 px-3 text-[13px]",
        md: "h-11 px-4",
        lg: "h-12 px-6 text-[15px] font-semibold tracking-tight",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg dark:focus-visible:ring-offset-bg-dark disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-text text-bg hover:bg-text/90 dark:bg-text-dark dark:text-bg-dark dark:hover:bg-text-dark/90",
        accent:
          "bg-accent text-black shadow-sm shadow-accent/30 hover:bg-accent/90 hover:shadow-accent/40",
        outline:
          "border border-border bg-transparent hover:bg-surface hover:border-text/30 dark:border-border-dark dark:hover:bg-surface-elev-dark dark:hover:border-text-dark/30",
        ghost: "hover:bg-surface dark:hover:bg-surface-elev-dark",
        danger: "bg-danger text-white shadow-sm shadow-danger/20 hover:bg-danger/90",
        link: "text-text underline-offset-4 hover:underline dark:text-text-dark",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-6 text-base",
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

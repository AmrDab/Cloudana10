import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "btn-primary-glow",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "btn-ghost-enterprise",
        secondary: "btn-secondary-glow", 
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        enterprise: "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white border border-indigo-400/30 hover:shadow-[0_0_30px_rgba(99,102,241,0.4)] hover:scale-[1.02]",
        success: "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white border border-emerald-400/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-[1.02]",
        warning: "bg-gradient-to-r from-amber-600 to-amber-500 text-white border border-amber-400/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.4)] hover:scale-[1.02]"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-14 rounded-xl px-8",
        xl: "h-16 rounded-2xl px-10 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
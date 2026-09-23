import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-7 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden border-[2.5px] border-black px-3 py-0.5 text-[11px] font-black tracking-wider uppercase whitespace-nowrap transition-all focus-visible:ring-[3px] focus-visible:ring-cyan-400 [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-[#00E5FF] text-black shadow-[2px_2px_0px_0px_black]",
        secondary:
          "bg-white text-black shadow-[2px_2px_0px_0px_black]",
        destructive:
          "bg-red-500 text-white shadow-[2px_2px_0px_0px_black]",
        outline:
          "bg-white text-black shadow-[2px_2px_0px_0px_black]",
        ghost:
          "border-transparent bg-transparent shadow-none",
        link: "border-transparent bg-transparent shadow-none underline",
        success:
          "bg-emerald-400 text-black shadow-[2px_2px_0px_0px_black]",
        warning:
          "bg-yellow-400 text-black shadow-[2px_2px_0px_0px_black]",
        live:
          "bg-black text-[#00E5FF] border-[#00E5FF] shadow-[2px_2px_0px_0px_#00E5FF] animate-pulse",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

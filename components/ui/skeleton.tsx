import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse border-[2px] border-black bg-zinc-200 shadow-[2px_2px_0px_0px_black] brutal-animate-shimmer",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }

"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-0 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center p-0 text-muted-foreground group-data-horizontal/tabs:h-12 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-white border-[3px] border-black shadow-[4px_4px_0px_0px_black] gap-0",
        line: "gap-0 bg-white border-b-[3px] border-black",
        brutal: "bg-black border-[3px] border-black shadow-[4px_4px_0px_0px_#00E5FF] gap-1 p-1",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-11 flex-1 items-center justify-center gap-1.5 border-r-[3px] border-black last:border-r-0 px-4 py-0 text-[11px] font-black tracking-widest uppercase whitespace-nowrap text-black/60 transition-all hover:text-black hover:bg-[#00E5FF]/20 focus-visible:ring-[3px] focus-visible:ring-cyan-400 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:bg-[#00E5FF] data-active:text-black data-active:font-black data-active:shadow-[inset_0px_-4px_0px_0px_black]",
        "group-data-[variant=brutal]/tabs-list:text-white/70 group-data-[variant=brutal]/tabs-list:hover:text-white group-data-[variant=brutal]/tabs-list:data-active:bg-[#00E5FF] group-data-[variant=brutal]/tabs-list:data-active:text-black group-data-[variant=brutal]/tabs-list:border-r-0 group-data-[variant=brutal]/tabs-list:rounded-none",
        "group-data-[variant=line]/tabs-list:border-r-0 group-data-[variant=line]/tabs-list:h-12 group-data-[variant=line]/tabs-list:data-active:bg-[#00E5FF]",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none bg-white", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }

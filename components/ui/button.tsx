import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border-[3px] border-black bg-clip-padding text-sm font-black uppercase tracking-wider whitespace-nowrap transition-all outline-none select-none focus-visible:ring-[3px] focus-visible:ring-cyan-400 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_black] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          'bg-[#00E5FF] text-black shadow-[4px_4px_0px_0px_black] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_black] hover:bg-[#00D4FF]',
        outline:
          'bg-white text-black shadow-[4px_4px_0px_0px_black] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_black] hover:bg-zinc-50',
        secondary:
          'bg-black text-white border-white shadow-[4px_4px_0px_0px_#00E5FF] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_#00E5FF] hover:bg-zinc-900',
        ghost:
          'border-transparent bg-transparent shadow-none hover:bg-[#00E5FF]/20 hover:border-black hover:shadow-[2px_2px_0px_0px_black]',
        destructive:
          'bg-red-500 text-white shadow-[4px_4px_0px_0px_black] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_black] hover:bg-red-600',
        link: 'border-transparent bg-transparent shadow-none text-black underline-offset-4 hover:underline',
        cyan: 'bg-[#00E5FF] text-black shadow-[4px_4px_0px_0px_black] hover:bg-[#00D4FF] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_black]',
        brutal:
          'bg-white text-black shadow-[6px_6px_0px_0px_black] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_black] text-base',
      },
      size: {
        default: 'h-10 gap-2 px-5',
        xs: 'h-7 gap-1 px-3 text-xs',
        sm: 'h-8 gap-1.5 px-3.5 text-xs',
        lg: 'h-12 gap-2 px-6 text-base',
        icon: 'size-10',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

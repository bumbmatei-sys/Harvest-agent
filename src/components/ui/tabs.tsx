"use client"

/**
 * ⚠️ MODIFIED FROM THE INSTALLED SNAPSHOT (THE-276-FIX). One defect, twelve
 * class names, no structural change.
 *
 * As vendored by THE-274 this component styled itself with `data-horizontal:`
 * and `data-vertical:` variants — which Tailwind compiles to the attribute
 * selectors `[data-horizontal]` and `[data-vertical]`:
 *
 *     .data-horizontal\:flex-col[data-horizontal] { flex-direction: column }
 *
 * The installed @base-ui/react (^1.5.0) does not emit those attributes. It
 * emits `data-orientation="horizontal"`, and `Tabs` below sets the same
 * attribute explicitly. So NONE of those twelve rules ever matched, and the
 * consequences were both visible:
 *
 *   1. 🔴 The root kept `display:flex` with the default `row` direction,
 *      because `flex-col` never applied. `TabsList` and the active `Panel` are
 *      siblings, and the panel carries `flex-1` — so the panel rendered as a
 *      SECOND COLUMN beside the tab strip instead of below it. Measured in
 *      headless Chromium at a 1917px viewport: the panel sat at x=1205 with a
 *      width of 420px inside a 1044px container, and every widget in it
 *      inherited that band.
 *   2. The active tab's underline (`variant="line"`) is drawn by an `::after`
 *      whose inset, height and offset are all `group-data-horizontal/tabs:`
 *      rules, so it was turned visible by `opacity-100` while having no
 *      geometry at all.
 *
 * The variants are therefore spelled `data-[orientation=horizontal]:` and
 * `data-[orientation=vertical]:`, matching the attribute this Base UI version
 * actually renders. Nothing else moved: same elements, same slots, same
 * variants, same API. THE-274's digest pin for this file is updated with this
 * ticket named as the reason.
 */
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
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
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
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
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
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }

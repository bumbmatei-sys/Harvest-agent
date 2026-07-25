"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// The app ships light-only (there is no ThemeProvider anywhere, so `useTheme()`
// returns next-themes' empty fallback context and `theme` is undefined). The
// shadcn default of "system" would therefore hand sonner "system" and render
// DARK toasts over a light UI for anyone whose OS is in dark mode. Default to
// light; a caller can still pass `theme` explicitly, and a real ThemeProvider
// added later takes over on its own.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "light" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      // These override sonner's own defaults on the same element, so every var
      // referenced here must actually resolve. The shadcn defaults (--popover,
      // --popover-foreground, --border, --radius) are NOT defined in this app's
      // globals.css: each one made its custom property invalid at computed-value
      // time, which drops the declaration that uses it back to `unset` — a
      // transparent, borderless, square-cornered toast. Point them at the tokens
      // Harvest actually defines in :root instead.
      style={
        {
          "--normal-bg": "var(--surface-raised)",
          "--normal-text": "var(--text-body)",
          "--normal-border": "var(--border-default)",
          "--border-radius": "12px", // = rounded-brand
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

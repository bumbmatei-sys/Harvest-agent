"use client"

import { useTheme } from "@/lib/use-theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// THE-273 — this file used to hard-code light, and that stopped being true.
//
// What stood here was: "the app ships light-only (there is no ThemeProvider
// anywhere, so `useTheme()` returns next-themes' empty fallback context and
// `theme` is undefined)". Both halves were accurate when written and the
// default of "light" was the right call then — shadcn's own default of
// "system" would have handed sonner the OS preference and rendered DARK
// toasts over a light-only UI. Dark mode has since landed (stage 3, plus the
// Classic family, four palettes in all), `<Toaster />` is mounted app-wide in
// layout.tsx, and Classic is the default family since #409 — so the light
// default became the mirror image of the bug it was avoiding: a white toast
// on a #1C1C1C page, for every success, error and confirmation in both the
// admin and member apps.
//
// The hook is `@/lib/use-theme`, not `next-themes`. next-themes never drove
// anything here and is no longer installed; THE-271 shipped a first-party,
// next-themes-shaped read of what the pre-paint script already stamped on
// <html>. It never stamps and never writes on read, so mounting it inside a
// toast cannot race layout.tsx's pre-paint script or move a stored choice.
//
// 🔴 Its `theme` is the RESOLVED theme — 'light' | 'dark', NEVER 'system'.
// That is load-bearing here rather than incidental: sonner passes `theme`
// straight through to its own prop, and "system" makes the toast follow the
// OS instead of the app. On the THE-85 pre-auth funnel, where a stored 'dark'
// is deliberately forced to light, "system" would put a dark toast on a
// forced-light sign-in page — the same class of bug in a new costume. There
// is deliberately NO `as ToasterProps["theme"]` cast below: 'light' | 'dark'
// assigns to sonner's 'light' | 'dark' | 'system' on its own, so if the hook's
// return type ever widened to include 'system', this would be a type error
// rather than a silent behaviour change.
//
// The family axis (`palette`) is deliberately NOT read. The three colour vars
// below are `var()` references to Harvest tokens, and `var()` is late-bound:
// they resolve in the scope of the element that reads them, and <html> already
// carries data-palette. So Harvest/Classic fall through the cascade without
// this component knowing which family it is in — one alias per role instead of
// four branches. `theme` is passed because sonner styles more than these three
// vars from it (the description colour, the cancel/close buttons and their
// hover states, and the rich-colour success/error/warning/info sets).
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
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
      // --popover-foreground, --border, --radius) were NOT defined in this
      // app's globals.css when this file was installed: each one made its
      // custom property invalid at computed-value time, which drops the
      // declaration that uses it back to `unset` — a transparent, borderless,
      // square-cornered toast.
      //
      // ⚠️ THE-263 (#407) and THE-264 (#408) have since defined all four, so
      // the upstream spelling would now COMPILE. It is still not restored, and
      // the hand-patch below is not a leftover to tidy away.
      //
      // The four were resolved through the real cascade in all four palettes
      // before deciding, and they are value-for-value IDENTICAL to what is
      // written here: --popover IS var(--surface-raised), --popover-foreground
      // IS var(--text-body), --border IS var(--border-default), and --radius is
      // 12px, the same rounded-brand this line hard-codes (globals.css says so
      // at its own --radius). So "revert to upstream" would be a rename with no
      // pixel behind it — pure risk. What it would change is the number of hops
      // between a toast and the token that decides its colour: the bridge names
      // are aliases maintained for shadcn's benefit, and one of them being
      // re-pointed is a paint change here that no toast test would explain.
      // These four are what the ratios in the-273-toast-dark-mode.test.tsx are
      // measured on, in all four palettes, and getting one wrong produces no
      // CSS and no error — see the failure mode above.
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

# Style lock - Hindavi Tourism CRM

Established: 2026-09-19. Source: existing production UI; this pass preserves its established visual system.

## Palette
- Background: #f5f7fb
- Surface: #ffffff
- Primary: #176fe0
- Accent: #c24c13 (adjusted from #f47732 so white labels meet WCAG AA)
- Text primary: #172b45
- Text muted: #738298
- Border: #e3e9f2
- Button label: #ffffff
- Dark mode: not needed; single light mode.

## Color contract
- Text-safe: text/surface 14.31, text/background 13.34, white/accent 4.84, white/primary 4.79, background/accent 4.51.
- UI-safe: background/primary 4.46, accent/border 3.97, primary/border 3.92.
- Decorative only: text/primary, text/accent, surface/border, background/border, primary/accent.

## Typography and shape
- Font: Inter with Segoe UI/Arial system fallbacks; 13px operational body text.
- Radius: 9-15px; soft low-depth shadow on raised panels.
- Separation: 1px hairline borders, white panels on the quiet page background.

## Density and navigation
- Dense, information-heavy app shell; 4px base spacing with 12-20px control/card padding.
- Persistent white sidebar, background content canvas, blue active navigation treatment.
- Topbar stays contextual: current page, search, notifications and account.

## Motion
- Feel: crisp and operational.
- Panel entrance: 180ms ease-out, 8px rise; press feedback: 120ms scale.
- Repeated table scanning remains static; reduced motion removes transforms and transitions.
- Verification: pending final motion audit and browser feel check.

## Assets
- Existing Hindavi wordmark treatment and destination photography are preserved.
- No new decorative assets are required for these data and workflow screens.

## Taste memory
- Decision log: `.tastemaker/decisions.log`.
- Pending review: retain the existing dense information architecture while expanding workflows.
- No personal-profile promotion.

## Do not
- Do not replace the established blue/orange brand or app-shell layout without an explicit redesign request.
- Do not add decorative dashboard cards where a compact table or linked command-center view communicates the workflow better.

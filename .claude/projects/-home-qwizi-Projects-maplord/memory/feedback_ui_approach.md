---
name: UI/UX approach preferences
description: User wants consistent shadcn components, reusable patterns, no AI-looking gradients, good contrast
type: feedback
---

Use shadcn/ui components (Card, Badge, Button, Tabs, Input, Separator) instead of custom divs with inline Tailwind.
Create reusable components for repeated patterns.
Use theme CSS variables (bg-card, text-foreground, border-border) not hardcoded colors (bg-slate-950/55, border-white/10).
No excessive gradients — looks AI-generated. Keep it clean and minimal.
Font: Barlow (UI) + Rajdhani (display/headings).
Ensure high contrast — text must be readable.
**Why:** User cares about professional, consistent look. Iterating on colors wastes time — get it right by using the design system.
**How to apply:** Always use shadcn components first. Only custom if shadcn doesn't cover the use case. Use theme vars everywhere.

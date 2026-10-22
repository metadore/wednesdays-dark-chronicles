---
name: Obsidian & Ink
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#20201f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c9c6c5'
  primary: '#c9c6c5'
  on-primary: '#313030'
  primary-container: '#0a0a0a'
  on-primary-container: '#7b7979'
  inverse-primary: '#5f5e5e'
  secondary: '#c6c6c7'
  on-secondary: '#2f3131'
  secondary-container: '#454747'
  on-secondary-container: '#b4b5b5'
  tertiary: '#ddb7ff'
  on-tertiary: '#4a0080'
  tertiary-container: '#140029'
  on-tertiary-container: '#985ed0'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c9c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c7'
  on-secondary-fixed: '#1a1c1c'
  on-secondary-fixed-variant: '#454747'
  tertiary-fixed: '#f0dbff'
  tertiary-fixed-dim: '#ddb7ff'
  on-tertiary-fixed: '#2c0050'
  on-tertiary-fixed-variant: '#622599'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  display-lg:
    fontFamily: Libre Caslon Text
    fontSize: 64px
    fontWeight: '400'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Libre Caslon Text
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 48px
  headline-lg-mobile:
    fontFamily: Libre Caslon Text
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 38px
  headline-md:
    fontFamily: Libre Caslon Text
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '300'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.1em
spacing:
  unit: 4px
  container-max: 1120px
  gutter: 24px
  margin-mobile: 20px
  section-gap: 120px
---

## Brand & Style
The design system is built upon a Gothic Minimalist aesthetic, capturing the macabre elegance and intellectual sharpness of a modern-day Wednesday Addams. It targets an audience that appreciates high-concept design, literary depth, and the beauty of the macabre.

The visual language is characterized by "monochrome gloom"—a high-contrast environment where whitespace is treated as "dead space" to create a sense of isolation and focus. The style avoids soft gradients and playful roundedness, opting instead for sharp edges, architectural layouts, and subtle, sophisticated textures. Every element should feel intentional, cold, and impeccably composed.

## Colors
The palette is strictly curated to evoke a sense of nocturnal sophistication.

- **Obsidian Black (#0A0A0A):** The primary canvas. It is not a flat black, but a deep, void-like base.
- **Stark White (#FFFFFF):** Used exclusively for high-contrast typography and essential UI borders.
- **Slate Grey (#1A1A1A / #2E2E2E):** Defines secondary surfaces and containment without breaking the dark atmosphere.
- **Deep Indigo / Crimson (#4B0082 / #420D0D):** A single, muted accent color used sparingly for interactive states (hover/active) and meaningful highlights.

Interaction should feel like a drop of ink in water—calculated and impactful. Use white-on-black for the majority of the UI to maintain the "monochrome gloom" effect.

## Typography
The typography system relies on the tension between the classical and the technical. 

- **Headlines:** Use *Libre Caslon Text*. Its high-contrast serifs and sharp terminals provide a literary, authoritative, and slightly "old world" feel. Headlines should be set with tight tracking to enhance their architectural presence.
- **Body:** Use *Inter*. It provides a clean, neutral, and highly readable counterpoint to the decorative headlines. 
- **Metadata/Technical:** Use *Geist*. Its monospaced-influenced structure suggests a meticulous, almost forensic precision, perfect for dates, tags, and code snippets.

All labels should be uppercase with generous letter spacing to evoke a sense of archival labeling.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy on desktop to create a centered, gallery-like experience. On mobile, it transitions to a fluid single-column layout.

- **Vertical Rhythm:** Use a strict 4px baseline grid. Large gaps (Section Gaps) are encouraged between content blocks to signify a "void" and prevent visual clutter.
- **The Margin of Silence:** Content should be flanked by significant horizontal margins. 
- **Alignment:** Use a mix of centered headers and left-aligned body text to create a dynamic but formal structure.
- **Breakpoints:**
  - Mobile: < 768px (1 column, 20px margins)
  - Tablet: 768px - 1024px (6 columns, 40px margins)
  - Desktop: > 1024px (12 columns, fixed 1120px max-width)

## Elevation & Depth
In this design system, depth is conveyed through **Tonal Layers** and **Sharp Outlines** rather than soft shadows.

- **Surfaces:** There are only three levels of depth:
  1. **The Void (Base):** #0A0A0A.
  2. **The Crypt (Raised):** #1A1A1A with a 1px solid #FFFFFF (10% opacity) border.
  3. **The Artifact (Overlay):** #2E2E2E with a 1px solid #FFFFFF (20% opacity) border.
- **Shadows:** If used, they must be "Hard Shadows"—completely opaque, offset by 4px or 8px, with 0 blur, in black or the accent color, creating a brutalist, paper-cut effect.
- **Texture:** Subtle overlays of grain or a faint "black-on-black" spiderweb pattern may be applied to the base layer to prevent the UI from feeling digitally sterile.

## Shapes
Sharpness is a core brand pillar. All UI elements—buttons, cards, inputs, and images—must have a **0px border radius**. 

The absence of curves communicates a lack of "softness" and a commitment to a rigid, gothic discipline. Visual interest should be generated through line-work and framing rather than corner smoothing.

## Components
- **Buttons:** Rectangular with 1px solid white borders. Hover states should invert the colors (White background, Black text) or apply the Deep Indigo accent as a hard drop shadow.
- **Inputs:** Minimalist bottom-border only. When focused, the border color shifts to the accent color or thickens by 1px.
- **Cards:** No background fill; defined by a 1px #2E2E2E border. The card title should be in the Serif font.
- **Chips/Tags:** Monospaced Geist font, enclosed in a small rectangular box with a thin border. No fill.
- **Images:** All images should be desaturated or treated with a high-contrast black-and-white filter. Use a "frame-within-a-frame" styling where images are inset within a slightly larger bordered container.
- **Dividers:** Use thin, 1px horizontal lines. Occasionally, use a small, centered icon (a raven silhouette or a crosshair) to break the line.
- **Cursors:** Custom circular cursor with a crosshair, shifting to an "X" or a needle point on interactive elements.
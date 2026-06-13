---
name: EduConnect AI
description: Canvas Grading AI assistant
colors:
  light:
    bg-main: "#F4F7FA"
    bg-card: "#FFFFFF"
    bg-nested: "#FDFEFE"
    text-primary: "#0F172A"
    text-secondary: "#334155"
    text-muted: "#64748B"
    brand-primary: "#4F46E5"
    brand-secondary: "#EC4899"
    brand-accent: "#06B6D4"
  dark:
    bg-main: "#020617"
    bg-card: "#0F172A"
    bg-nested: "#1E293B"
    text-primary: "#F8FAFC"
    text-secondary: "#E2E8F0"
    text-muted: "#94A3B8"
    brand-primary: "#6366F1"
    brand-secondary: "#F472B6"
    brand-accent: "#22D3EE"
typography:
  display:
    fontFamily: "'Space Grotesk', sans-serif"
    fontWeight: 900
    letterSpacing: "tighter"
  body:
    fontFamily: "'Plus Jakarta Sans', sans-serif"
rounded:
  card: "2.5rem"
  nested: "1rem"
spacing:
  nested-pad: "1.5rem"
components:
  ui-card:
    backgroundColor: "{colors.light.bg-card}"
    rounded: "{rounded.card}"
  ui-nested-block:
    backgroundColor: "{colors.light.bg-nested}"
    rounded: "{rounded.nested}"
---

# Design System: EduConnect AI

## 1. Overview

**Creative North Star: "The Vibrant Command Center"**

This product is an instructional work surface, not a playful learning toy. The metaphor is structured, decisive, and productivity-oriented rather than flashy or decorative. Teachers using grading flows need confidence and speed, so the interface must feel precise and calm under load, never overly energetic or experimental. We want it to feel deeply premium with proper, smooth animations that enhance workflow rather than distract.

**Key Characteristics:**
- **Decisive and Productivity-Oriented**: Data is clear, and the interface stays out of the way.
- **Precise and Calm Under Load**: High-contrast colors are used strictly for meaning, avoiding cognitive fatigue.
- **Tactile and Chunky**: Substantial geometry (like 2.5rem corner rounding) makes components feel touchable and controlled, not toy-like.

---

## 2. Colors

The palette uses a crisp, high-contrast Slate foundation with controlled, vibrant "pop" accents (Indigo, Pink, Cyan) reserved for focused action and data visualization.

### Light Mode Palette
*   **Background Main** (`#F4F7FA`): Neutral light-blue tint backing the workspace.
*   **Background Card** (`#FFFFFF`): Primary container backdrop.
*   **Background Nested** (`#FDFEFE`): Offset container for internal items.
*   **Brand Primary (Indigo 600)** (`#4F46E5`): The primary action color, directing attention to critical grading workflows.
*   **Brand Secondary (Pink 500)** (`#EC4899`): Highlight accent for visualization elements.
*   **Brand Accent (Cyan 500)** (`#06B6D4`): Dynamic focus states and vibrant accents.

### Dark Mode Palette (Class `.dark`)
*   **Background Main** (`#020617`): Sleek pitch black/slate base.
*   **Background Card** (`#0F172A`): Deep slate card containers.
*   **Background Nested** (`#1E293B`): Highlighted slate internal blocks.
*   **Brand Primary (Indigo 500)** (`#6366F1`): Dynamic high-contrast action accent.
*   **Brand Secondary (Pink 400)** (`#F472B6`): Micro-highlighting.
*   **Brand Accent (Cyan 400)** (`#22D3EE`): Soft-glow focus indicators.

### Status Indicators
*   **Success**: Green (`#16A34A` / `#34D399`) — for validated/fully graded items.
*   **Warning**: Yellow/Amber (`#D97706` / `#FBBF24`) — for pending reviews.
*   **Danger**: Red (`#DC2626` / `#F87171`) — for validation errors.
*   **Info**: Blue (`#2563EB` / `#60A5FA`) — for tips and details.

### Named Rules
**The Controlled Pop Rule.** The bold accents (Indigo, Pink, Cyan) are used deliberately as utility signals, not background decorations. They guide the eye rather than overwhelming it.

---

## 3. Typography

*   **Display Font**: `Space Grotesk` (Black 900 weight)
*   **Body Font**: `Plus Jakarta Sans` (Regular to Bold weights)

### Hierarchy
*   **Display** (Black/900, tracking-tighter): Page headers and critical data points.
*   **Body** (Regular/Medium): Student submissions, explanations, and grading feedback.
*   **Label** (Black, uppercase, tracking-widest, text-[10px]): Used aggressively for metadata and form labels across the platform to enforce high-contrast structure.

### Named Rules
**The Utilitarian Label Rule.** All labels and muted text must be highly tracked, uppercase, and structurally distinct to serve as strong anchor points for dense data without competing with primary content.

---

## 4. Elevation & Shadows

Depth is conveyed through aggressive, expansive shadows against flat cards, creating a tangible sense of layering without muddiness.

### Shadow Vocabulary
*   **Aggressive Shadows** (`shadow-xl`): `0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)`
    *   Used to lift massive `.ui-card` blocks off the canvas, giving them substantial presence and authority.

### Named Rules
**The Floating Work-Surface Rule.** Core structural blocks float above the base layer with pronounced shadow, clarifying what is "active content" versus "backdrop."

---

## 5. Components

Components prioritize a premium, substantial feel over minimal airiness.

### Cards / Containers (`.ui-card`)
*   **Corner Style**: `2.5rem` (`40px`) rounding.
*   **Border**: `2px solid Slate 200` (Light) or `rgba(255, 255, 255, 0.08)` (Dark).
*   **Shadow Strategy**: Massive (`shadow-xl`) to lift the card.
*   **Character**: Tactile, chunky, and substantial. The mass feels controlled, giving a sense of authority to the content inside.

### Nested Blocks (`.ui-nested-block`)
*   **Corner Style**: `1rem` (`16px`) rounding.
*   **Background**: Slightly offset nested background (`#FDFEFE` / `#1E293B`).
*   **Border**: `2px solid Slate 200` (Light) or `rgba(255, 255, 255, 0.08)` (Dark).
*   **Character**: Clear, contained subsections for specific data points or form groups.

### Inputs / Fields
*   **Style**: 2px borders, bold text, aggressive differentiation on focus.
*   **Focus**: Sharp border shift to Brand Primary (`#4F46E5` / `#6366F1`) with an aggressive glow (`shadow-[0_0_20px_rgba(8,145,178,0.15)]` and `ring-4`).

---

## 6. Interactions & Animations

*   **Transitions**: Smooth transitions (`duration-300`) on theme switches, background updates, and hover states.
*   **Entrance Animations**: `slideUp` is applied to page entries and card displays to establish a polished, dynamic feel:
    *   Keyframe: `from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); }`
    *   Transition Curve: `cubic-bezier(0.16, 1, 0.3, 1)` (smooth deceleration).

---

## 7. Do's and Don'ts

### Do:
- **Do** use the `.ui-card` with its chunky 2.5rem border radius to group large, independent workflows.
- **Do** keep animations smooth, quick, and purposeful (like `slideUp`), enforcing a premium feel.
- **Do** rely on the tight Space Grotesk headers to establish hierarchy instantly.
- **Do** use dark mode mappings to preserve readability and brand consistency.

### Don't:
- **Don't** use overly saturated gradients or glassmorphism as a default background treatment. That's the "AI slop" we are actively rejecting.
- **Don't** use identical, endless card grids if the information hierarchy demands varied sizing and emphasis.
- **Don't** let vibrant accents bleed into the body text or large background areas. Keep them strictly as "pops" for interaction and data visualization.

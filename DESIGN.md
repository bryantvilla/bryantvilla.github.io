# Design

## Approved direction

Dark, restrained, technical. The user confirmed backend/platform positioning and delegated selection between two generated previews. The first preview, a split hero with a conceptual identity-system diagram, is the implementation reference. Scope is the complete responsive portfolio and its downloadable resume.

## Composition

Text navigation and resume access at the top. Large, left-aligned introduction beside a concept diagram of request, identity, and access. Professional work follows immediately as two expandable, spacious rows. Engineering tools, background and education, an undergraduate archive, and contact follow. The real portrait is used in the background section.

## Visual inventory

- Preserve the split hero and strong type hierarchy from the selected preview.
- Build the concept diagram as semantic, accessible SVG, not a rasterized interface or a representation of UKG's architecture.
- Use wide professional contribution disclosures, not a grid of student demos.
- Keep the primary action in muted sage and the secondary action understated.
- Carry verified portfolio copy into the layout; generated preview copy is not a factual source.

## Color and type

Restrained color strategy: olive-tinted charcoal surfaces, warm off-white text, muted secondary text, and pale sage accents. Use OKLCH semantic variables. Provide an optional light theme with equivalent contrast. The dark theme is the default.

Manrope is the primary family, selected for readable body text and a distinctive, compact large-heading shape. Use a local font with a system sans-serif fallback. Body measure is at most 65ch, with 1.65 line height. Headlines use fluid sizing and tight tracking; no gradient text or decorative monospace.

## Interaction and responsive behavior

All content is available in static HTML. Native details/summary elements expose contribution details and the undergraduate archive. Top navigation wraps into a compact second row on narrow screens. The hero stacks on mobile and the concept drawing scales without horizontal overflow. Keep the existing contact endpoint with native form validation. Respect reduced motion; transitions use opacity and transform only.

## Validation

Inspect mobile, tablet, and wide desktop in both themes. Verify navigation, keyboard disclosures, contact validation without submitting messages, theme persistence, local assets, no-JavaScript content access, and the printable resume. Refresh the social sharing preview from the finished design.

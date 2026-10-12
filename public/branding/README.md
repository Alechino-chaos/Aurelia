# Aurelia icon

Created with the built-in imagegen tool. The final asset uses an opaque forest-green background and a champagne-gold A formed from folded book pages. The opaque background keeps the mark consistent on light and dark desktops.

- `aurelia.png`: original generated artwork.
- `aurelia.ico`: Windows icon with 16, 24, 32, 48, 64, 128 and 256 px frames.
- `aurelia-32.png`: toolbar and favicon asset.

Run `./scripts/prepare-icon.ps1` from the project root to regenerate the ICO and small PNG from the original. This step only converts formats and sizes.

Generation prompt:

> Use case: logo-brand. Create one finished Windows desktop application icon for Aurelia, an elegant, stately academic PDF reader. Square 1024x1024 composition. A deep midnight forest-green rounded-square tile, with transparent outside corners, fills nearly the entire canvas. Center a bold, highly refined champagne-gold capital A monogram whose two tapering architectural strokes subtly evoke two open book pages; a single graceful curved crossbar suggests a turning page. Restrained luxury, intellectual, timeless, confidently proportioned. Crisp clean vector-like edges and mostly flat colors with only very subtle gold tonal variation. Strong silhouette legible at 32px. Generous balanced inner margins. Only the monogram, no wordmark, no text labels, no extra sparkles, no decorative border, no mockup, no surrounding scene, no drop shadow outside tile. This is a production app icon, not a presentation.

Final refinement prompt:

> Precise production app-icon refinement. Preserve the elegant champagne gold A / open-book monogram, its silhouette, center placement, and large scale. Replace ALL background with a completely opaque, uniform, flat very dark forest green #082F28, including every corner and every gap surrounding and within the A. Full-bleed SQUARE canvas, no rounded tile needed. No transparency anywhere, no black patches, no edge shading, no vignettes, no halo, no textures in the background. Preserve the gold monogram's subtle dimensional paper fold shading. No words, no extra decorations. Result is the final elegant stately Aurelia application icon.

# README visual assets

- `aurelia-cover.png`: the Aurelia cover, generated with the built-in imagegen tool at 2172 × 724 px. It contains the brand name and existing tagline, not an application screenshot.
- `aurelia-reader.png`: an actual application screenshot showing the built-in synthetic PDF. It contains no private paper or conversation. The current app interface is in Chinese.
- `aurelia-reading-journey-en.png`: the English version of the selected three-stage feature illustration, embedded in the README with an expandable text alternative.
- `icons/inline/*.svg`: small, unboxed Lucide icons for README navigation, the contents list, section headings, and privacy notes. They use a shared muted green stroke and the same [Lucide license](icons/LICENSE). The layout is inspired by MMYOLO's icon-led navigation and headings, while preserving Aurelia's palette.

The cover layout takes inspiration from [MMYOLO's README](https://github.com/open-mmlab/mmyolo). The illustrations and visual identity were made specifically for Aurelia.

## English feature illustration

Tool: built-in image_gen, text-localization edit of the selected Chinese design draft. Only the final English illustration is included in this repository. It preserves the selected layout, palette, iconography, and paper illustration.

```text
Use case: text-localization. Edit the supplied Aurelia README feature illustration into English. Preserve its exact composition, aspect ratio, warm ivory paper, forest green text, champagne-gold numbers and thin rules, three icons, bottom-right curved paper leaves, generous negative space, and refined editorial serif typography. Change ALL Chinese writing to the following exact English copy, with tasteful font-size adjustment ONLY as needed to fit, no clipped or overlapping letters. Retain existing eyebrow "THE READING EXPERIENCE". Main heading: "From reading to understanding." on one line if possible, comfortably inset from edges. Three column headings: "Read closely", "Ask thoughtfully", "Keep your insights". First column body in two lines: "Clear pages. Precise selections." / "Follow the flow of the paper." Second column body: "Translate passages. Ask questions." / "Keep the source in sight." Third column body: "Highlight, annotate, and save." / "Pick up where you left off." Footer: "LOCAL READING  ·  YOUR OWN AI  ·  SAVED BY PAPER". Keep 01, 02, 03 unchanged. No Chinese characters remaining. No new elements, no redesign, no icons replaced, no watermark. The output is an English language variant of the same chosen asset, not a new concept.
```

## Cover generation prompt

Tool: built-in image_gen. Opaque background. Final prompt:

```text
Use case: logo-brand. Create a finished ultra-wide GitHub README cover banner for "Aurelia", an elegant academic PDF reading desktop application. Aspect ratio 3:1, landscape, approximately 1800 by 600. Sophisticated editorial identity, restrained and architectural, elegant academic publisher rather than futuristic AI. Background solid very pale celadon green #EDF3E9, subtle tactile paper texture. Generous empty space. On the left half: very large impeccably typeset deep forest-green high-contrast literary serif wordmark, exact text "Aurelia". Under it smaller clean sans-serif exact text "A quiet space for deep reading." with spacious leading. A thin short champagne gold rule separates wordmark and tagline. On the right half: a single sculptural open book with gently rising overlapping paper leaves suggesting the letter A, ivory and soft sage paper with extremely restrained champagne gold edges. Quiet dimensional paper sculpture, delicate ambient shadows, elevated and graceful, no shiny plastic or excessive gold. Small dark green page shapes and very fine curved reading lines can complement the sculpture sparingly. Clean flat full-bleed pale green rectangle, no outer margins. Text must be fully legible at GitHub column width. Keep all essential contents inset 7% from edges. No extra text, no badges, no UI mockups, no screenshot, no planets, no sparkles, no robots, no circuits, no gradient blobs, no watermark. The title and sculpture balance each other with plenty of breathing room.
```

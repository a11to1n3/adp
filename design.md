# Design: Anh-Duy Pham’s research website

The shared system for the academic homepage and research articles. Preserve the
user’s factual content, recorded data, code samples and interactive experiments.

## System

- Genre: editorial, academic.
- Homepage: short identity and contact block, two selected works, then the biography and research record.
- Articles: readable long documents with working scientific demonstrations.
- Theme: custom, plain, compact, readable, academic, personal.
- One shared visual system across the homepage and article routes.

## Tokens

`assets/css/tokens.css` is the source of truth.

- Near-white paper and dark neutral text; conventional blue links.
- Paired dark tokens under `.dark`, with the same hue relationships.
- Source Sans 3 at 400 and 600 for body text and headings.
- Monospace is reserved for code and numerical measurements.
- Root container: 960px. Article prose: 70ch at most.
- Body: 16–17px. Homepage name: 34px. Article title: 32px.
- Academic section headings: 24px; content determines spacing.
- Square, flat surfaces. Use spacing and occasional rules rather than cards.
- Preserve the natural portrait and original research figures.

## Controls

- Use plain underlined links for navigation through research material.
- Buttons have a 44px minimum target and visible, immediate focus rings.
- Shared theme and mobile navigation controls work identically on every page.
- Simulation controls retain their existing ids, data, ranges and behavior.
- Scientific legends use both labels and colour.

## Motion

- No entrance animation, decorative loops or automatic simulation playback.
- Playback has explicit play/pause and reset controls.
- Respect reduced motion and preserve readable content without scripting.

## Content

- Keep the opening biography paragraph verbatim.
- State job availability once in that opening; other sections record actual work.
- Display email as `duyanhpham(at)outlook.com`; keep valid mailto destinations.
- Do not add metrics, affiliations, claims, logos or testimonials.
- Keep all biography paragraphs verbatim. Present the first paragraph in About; make the remaining background expandable.
- Show two selected works, three recent news items, and three selected publications by default. Preserve the remaining entries in native `details` elements.
- Give Experience and Education equal columns on desktop, stacking on mobile. Put Doctoral Researcher positions under Experience and degrees under Education. Show the two latest roles, with all earlier roles continuing in newest-first order in one disclosure; for overlapping end dates, use the later start date first.
- Consolidate skills and research interests into one expandable block. Keep Python, C++ and PyTorch visible in its summary.
- Present the blog as a compact list of titles, dates and descriptions.

## Exports

- `assets/css/tokens.css`: visual tokens.
- `assets/css/base.css`: shared primitives.
- `assets/css/portfolio.css`: navigation and homepage layouts.
- `assets/css/article.css`: article typography, figures and experiment controls.
- `assets/js/site.js`: shared theme, year and mobile navigation behavior.

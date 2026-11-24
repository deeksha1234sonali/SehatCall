# SehatCall — working notes for future sessions

Project-specific things that are not obvious from the code and that cost time to
rediscover. Add to this only when something would genuinely bite the next
session again.

## Environment

- **Node is not installed on this machine.** `node --check file.js` fails. To
  syntax-check JavaScript, load the page in the browser instead — the browser
  reports parse errors there. Python 3 *is* available (`python`), as is `curl`.
- The project runs with no build step. `python -m http.server 8000` from the
  project root is the intended preview server.

## Shell quirks (`cmd /C`)

- `cmd` treats `&` as a command separator, so chaining `curl ... & curl ...`
  breaks — the second half gets run as a command and you get
  `Input redirection is not supported`. Use `for %f in (...) do @curl ...`
  or run one command per call.
- Inline `python -c "..."` with nested quotes fails (`unterminated string
  literal`). Write a small `.py` file and run that instead.
- `findstr` filters containing quotes fail the same way (`Cannot open result"`).

## Browser verification quirks

These shaped how this project was verified, and will again:

- **Scripts inside an `<iframe>` do not execute** in the preview host. A
  same-origin iframe-based harness silently renders nothing, and a
  `load`-event listener can miss the event entirely if the frame loads first.
  Verify in the top-level document.
- **Long pages return only a screenshot**, with no accessibility tree. Short
  pages return the full tree. To read results out of a long page, have it write
  the result to `localStorage` and read it back from a separate one-line page —
  that worked when the direct tree did not.
- **`interact_in_browser` rejects the `Tab` key** (`Invalid parameters`), so
  keyboard traversal to a form field is not available. Clicking needs pixel
  coordinates, which means a screenshot you can actually see. Prefer a module-
  level harness plus rendered-DOM assertions over blind coordinate guessing.
- Writing the outcome into `document.title` is a useful fallback: the root web
  area's name appears in the tree even when the rest is truncated.

## Project conventions worth not breaking

- `design-tokens.css` is the only file allowed to contain a hex colour.
  `css/app.css` must stay token-only; a static check for raw `#ffffff` / `#000000`
  is cheap and caught a real stray value once.
- Dark mode is driven by `data-theme="dark"` on `<html>`, **not** a
  `prefers-color-scheme` media query. Do not reintroduce the media query: a
  manual toggle and a media query cannot both own the same tokens without
  declaring the palette twice, and the copies drift.
- Every page needs an inline `<head>` script that applies the saved theme and
  text size before first paint, and must link `/design-tokens.css` and
  `/css/app.css` with a **leading slash** (relative hrefs 404 on the preview
  host).
- `js/api.js` is the only module that touches storage. Pages must not read
  `localStorage` or call `fetch` directly, or the `USE_BACKEND` swap breaks.
- All type sizes are `rem` on purpose: the sidebar text-size control works by
  setting `--font-scale` on `<html>`. A `px` font size will not scale.

## Bugs found here that are easy to reintroduce

- Calling `UI.wirePasswordToggle()` twice attaches two handlers, and the second
  immediately undoes the first — the toggle appears dead.
- Two properties with the same key in a JS object literal (`status:` twice) —
  the later one silently wins and you lose the earlier element reference.
- Icons injected with `innerHTML` have no intrinsic size: an `<svg>` with no
  width/height renders at 300x150 and wrecks the layout. The `.icon` rule in
  `css/app.css` handles this; anything new needs a size from a parent selector.

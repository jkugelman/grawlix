# UI components

The shared UI vocabulary: what already exists, so you build with it instead of rebuilding it. Read this before writing a new component, builder, or CSS class.

This is the catalogue, not the rulebook. The architectural rules — builder vs. lifecycle component, dialog contracts, where a builder belongs — live in [`CLAUDE.md`](../CLAUDE.md) § *Component architecture*; the layering is in [`design.md`](design.md#code-structure).

## Before you build one

Three habits catch nearly everything this page exists to prevent:

**Grep the name you're about to give it** — not what it will look like. [`site/css/app.css`](../site/css/app.css) labels its clusters in plain English (`/* Segmented control */`, `/* Split button */`, `/* Toggle switch */`), so the concept name is usually the hit. Searching by appearance instead ("what paints an active button with the accent color?") lands on a neighbour and reads as a negative result.

**Read the whole module you're extending.** Generic builders are collocated in [`components.js`](../site/src/ui/components.js) on purpose, so when you're adding a case to something there, what you're about to write is often already a few lines up.

**A near-miss is not a negative result.** Turning up a related-but-different component means you're in the right neighbourhood — keep looking rather than concluding nothing exists.

## `ui/components.js`

Generic, layer-agnostic builders. Anything reusable across surfaces belongs here; a builder that knows about wordlists, rules, or tools lives with its consumer instead. This table is exhaustive — [`tests/unit/components-doc.test.js`](../tests/unit/components-doc.test.js) fails if an export is missing from it or a row names something that no longer exists.

| Export | What it gives you |
| --- | --- |
| `buildSegCtrlHTML(id, options, activeValue)` | A segmented control — a joined row of mutually exclusive buttons. Reach for this for any small either/or or three-way pick (All \| One, dark/light/auto). |
| `setSegCtrlActive(container, target)` | Moves the active button, by value or by element. Always use this instead of toggling `.active` yourself; it keeps `aria-pressed` in step. |
| `buildOutputFormatControlsHTML(fmt)` | The Spaces / Punctuation / Accents / Comments checkbox grid used wherever a wordlist is written out. |
| `readOutputFormatControls(container)` | Reads that grid back into a `fmt` object. |
| `wireOutputFormatControls(container, onChange)` | Fires `onChange` whenever that grid changes. |
| `buildBadgeHTML(severity, { title })` | The small colored status dot, `.badge[data-severity]`, with an optional tooltip and matching `aria-label`. |
| `buildClearableInputHTML(inputHTML, hasValue)` | Wraps an `<input>` you've already built with an ✕ clear button. |
| `syncClearButton(input)` | Shows or hides one clear button. Call after setting `input.value` from code, which fires no `input` event. |
| `mountClearableInputs()` | Installs the delegated input/click listeners that drive every clear button. Called once from `boot()`. |
| `buildTextInputHTML(param, value, toolKey, wiring)` | A clearable monospace text input for a tool param, with placeholder and help wiring. |
| `buildParamHTML(param, value, toolKey, wiring)` | Renders one tool-row param, dispatching on `param.type`: `checkbox`, `match`, `segmented`, `number`, `range`, or text. **Add new control types here** rather than in a tool. |
| `positionPopover(el, anchor, opts)` | Places a fixed-position element beside an anchor, flipping above/below and clamping to the viewport. |
| `PopupHelp` | Class. A help popover bound to an anchor's focus, dismissed on blur or Escape and suppressed on narrow viewports. `show()` / `hide()` / `destroy()`. |
| `buildSplitBtn(mainLabel, mainOnclick, menuItems, opts)` | A primary action button with an attached ▾ menu of secondary actions. |
| `buildMoreMenuHTML(menuItems, opts)` | A menu with no primary action — trigger is a ⋮, a named icon, or a text label with a caret. |
| `toggleSplitMenu(event)` | The open/close handler both of the above wire up. Closes any other open menu first. |
| `buildUrlInputHTML(id, placeholder)` | A URL field with a leading globe icon. |
| `buildEditHintHTML(extraClass, onclick)` | The ✏️ that fades in on hover to mean "click to edit". |
| `buildTrashIconHTML()` | The trash `<svg>`. |
| `buildDragHandleHTML()` | The ≡ drag grip. |
| `makeReorderable(container, opts)` | Pointer-based drag-to-reorder: ghost, drop line, and edge auto-scroll, working on touch as well as mouse. Pair with `buildDragHandleHTML`. |

## Shared helpers elsewhere

Small, stable, cross-cutting — reuse rather than reimplement:

- **Dialogs** — [`ui/dialogs/dialog.js`](../site/src/ui/dialogs/dialog.js): `createDialog(id, opts)` builds the element and delegates dismiss clicks; `showDialog(el, onClose?)` opens it and handles focus. Never hand-wire backdrop close, `tabIndex`, or post-`showModal()` focus. The full contract, including promise-returning dialogs, is in [`CLAUDE.md`](../CLAUDE.md) § *Component architecture*.
- **Icons** — [`ui/icons.js`](../site/src/ui/icons.js): `buildIconHTML(descriptor, name, seed)` renders a wordlist/publisher icon from its stored descriptor; `getWordlistIcon(wordlist)` is the usual call site. Never store the generated markup.
- **Score badges** — [`model/score-display.js`](../site/src/model/score-display.js): `buildScoreBadgeHTML(score)` and `buildScoreCellHTML(wlEntry, preview)`.
- **Toasts** — [`ui/toasts.js`](../site/src/ui/toasts.js): `showToast`, `showActionToast`, `showUndoToast`.
- **Text** — [`core/util.js`](../site/src/core/util.js): `esc` (escape for interpolation into HTML — use it on every interpolated value), `pluralize`, `plural`, `timeAgo`, `formatBytes`, `buildHelpHTML`.

## Shared CSS vocabulary

Classes emitted by the builders above. If you're styling one of these, the rule already exists — extend it rather than declaring a parallel one.

| Class | Comes from |
| --- | --- |
| `.seg-ctrl`, `.seg-btn` | `buildSegCtrlHTML` |
| `.split-btn`, `.split-btn-main`, `.split-btn-arrow`, `.split-btn-menu`, `.split-btn-menu-header` | `buildSplitBtn`, `buildMoreMenuHTML` |
| `.more-menu-btn`, `.more-menu-caret` | `buildMoreMenuHTML` |
| `.badge` | `buildBadgeHTML` |
| `.clearable-input`, `.clear-btn` | `buildClearableInputHTML` |
| `.of-flags`, `.of-flag` | `buildOutputFormatControlsHTML` |
| `.tool-row-param` | `buildParamHTML` |
| `.url-input-wrap`, `.url-input` | `buildUrlInputHTML` |
| `.edit-hint` | `buildEditHintHTML` |
| `.icon-trash` | `buildTrashIconHTML` |
| `.drag-handle` | `buildDragHandleHTML` |
| `.drag-ghost-layer`, `.drag-ghost`, `.drop-line` | `makeReorderable` |
| `.popup-help` | `PopupHelp` |
| `.score-badge` | `buildScoreBadgeHTML` |
| `.wordlist-icon` | `buildIconHTML` |
| `.toast` | `showToast` |

And the element-level chrome, which means a plain `<button>` or `<input>` needs no styling of its own:

| Selector | What it already covers |
| --- | --- |
| `button` | Padding, radius, border, hover, `:disabled`. Variants: `button.primary` (accent fill), `button.danger` (red fill). |
| `input`, `select`, `textarea` | Shared field chrome and focus ring. Checkboxes, radios, and ranges are deliberately excluded. |
| `.sr-only` | Visually hidden, still read by screen readers. |
| `.menu-header`, `.menu-list` | Popup-menu scaffolding, shared by the score picker and the sort menu. |
| `.dialog-actions` | Right-aligned button row at the foot of a dialog. |
| `.shake` | One-shot shake, for rejecting invalid input. |
| `.no-rules` | The muted italic "nothing here yet" line. |

`app.css` is divided into banner-delimited sections (see [`style.md`](style.md#banner-comments)); skimming those headings is the fastest way to find where a family of rules lives.

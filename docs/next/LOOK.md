# The look

Every screen uses Field Notebook: warm and archival, like an old field journal.
Cream paper, hairline rules rather than filled panels, square corners, serif headings.
The Uploader, the Tagger and the sign-in share it through `packages/auth-ui`:

- `src/app/look.css`: the colour tokens for light and dark. The values live
  here and nowhere else.
- `tailwind.preset.ts`: the Tailwind theme built on those tokens: colours,
  fonts, the type scale, square corners. Each app's config uses it.
- `src/app/look.ts`: shared class strings: `bigPrimary`, `bigSecondary`,
  `quietLink`, `focusRing`, `press`.
- `src/app/Shell.tsx`, `src/app/Dialog.tsx`: the header and the dialog.

The start page, `apps/sparcd-home`, is plain HTML with no build step. It keeps its own
copy of the token values it uses, so update that copy whenever `look.css` changes.

Use these before writing new styles. A look test in each app and in auth-ui
fails on anything that breaks the rules marked **(checked)**.

## Colour

| token                    | for                                               |
| ------------------------ | ------------------------------------------------- |
| `paper`, `paperHover`    | the page                                          |
| `panel`, `panelHover`    | raised surfaces: header, cards, menus             |
| `ink`                    | main text, primary button fill                    |
| `inkSoft`                | secondary text                                    |
| `inkMute`                | hints and large text only, never body text        |
| `rule`                   | hairlines that separate regions                   |
| `ruleSoft`               | decorative rules, never the only separation       |
| `accent`, `accentSoft`   | links, focus ring, selected backgrounds           |
| `warn`, `ok`             | problems, success                                 |
| `mark`                   | the highlight on the active row, never under text |

- Dark mode swaps the values under `.dark` and keeps the names. Write
  `text-ink`, never a light or dark value.
- No hex colours in TS or TSX **(checked)**. A new colour is a new token in
  `look.css` (both themes) and the preset. Web workers are the exception: they
  have no DOM, so they write colour values directly into the image pixels they draw.
- The Tagger adds `frame` and `frameInk`, which stay dark in both themes, for the
  space around photos and for badges and labels drawn on photos.

## Type

- **Newsreader** (`font-display`): headings, the app name, scientific names
  in italic.
- **Inter Tight** (`font-body`): all UI text.
- **JetBrains Mono** (`font-mono`): data only. Values, IDs, timestamps,
  keys, coordinates. Never labels or prose.

The type scale is the only set of sizes **(checked)**. A size written as
`text-[20px]` or a stock Tailwind size like `text-sm` fails the test.

| class          | size | for                                                      |
| -------------- | ---- | -------------------------------------------------------- |
| `text-hero`    | 44px | the one big line on a finished screen                    |
| `text-title`   | 36px | page title, the app name on Home                         |
| `text-heading` | 28px | section heading                                          |
| `text-lead`    | 22px | big buttons, card titles, the line that matters most     |
| `text-body`    | 20px | body text, list rows, most buttons                       |
| `text-detail`  | 18px | secondary lines, table cells                             |
| `text-small`   | 14px | help text, menus, table headers, the sign-in form        |
| `text-chip`    | 12px | the header's connection chip and decorative ▾ ✓ glyphs   |
| `text-kicker`  | 11px | small uppercase labels above a field or section          |

- 14px is the smallest size for anything people read or click. Only two classes
  go below it:
  - `text-chip` is allowed only in `ConnectionChip.tsx` and `BrandSwitcher.tsx`
    **(checked)**. The chip shows status and isn't clicked. Its Logout button
    is `text-small`.
  - `text-kicker` always comes with `uppercase` **(checked)**, plus weight 600,
    tracking `0.16em` and `inkSoft`.
- Give each element one size class. Tailwind writes the scale in alphabetical
  order, so with two size classes the one later in the alphabet wins, not the
  one you meant. The shared button classes in `look.ts` already set a size.
- On phones, `look.css` sets inputs to 16px so iOS doesn't zoom on focus.
- To add a size, change the preset, this table and the look test together.

## Controls

- Corners are square: `rounded` is 0. Use `rounded-full` only for status dots.
- Main actions use `bigPrimary`, the second choice uses `bigSecondary`, and the
  way back uses `quietLink`.
- Hit targets are at least 32px tall.
- Every interactive element gets `focusRing`, which shows on `:focus-visible`
  only.
- Use hairline `rule` borders rather than filled dividers.
- Motion is short and stops when the system asks for reduced motion (`press`,
  `motion-reduce:`).

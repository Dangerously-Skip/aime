# Design systems — plan

**Status:** proposal. Nothing below is built. `492de26` fixed the blocker (the
installer no longer deletes what you create), so this is now possible.

## The ask

A non-technical user picks a look — from presets, or by describing one — and
everything AIME produces afterwards is consistent with it: decks, documents,
web artifacts. Roughly what open-design's template library does, except the
tokens have to reach three different renderers.

## What already exists

| Piece | Does | Wired to the app |
|---|---|---|
| `theme-factory` skill | Generates a token set from a URL, an adjective, a mood board | No |
| `brand-guidelines` skill | Holds the user's tokens; ships **unfilled** | No |
| `craft-web` / `craft-deck` / `craft-doc` | Medium rules — type scale, states, break control | No (loaded on demand by the model) |
| `ppt-plugin/brands/<name>/` | `brand_config.yaml` (palette/type) + `pptx_config.yaml` (layouts, optional template) | **Nothing reads it** |

The separation is already stated in `craft-web`: *"If a brand IS configured, its
tokens win on values; these still govern everything the brand does not specify."*
Craft = rules, brand = values. That is the right architecture and it was never
connected to anything.

Two things are missing, and only two: somewhere durable to keep a brand (now
fixed), and a UI that writes to it.

## Design

### 1. A brand is one token set, stored in user data

`~/.aime/brands/<id>/brand.json` — outside any directory the installer manages,
so it survives updates by construction rather than by the manifest logic.

```
{ id, name,
  colors:     { bg, surface, fg, muted, border, accent, success, warn, danger },
  typography: { display, body, mono, scale },
  spacing:    { unit, scale },
  voice:      "plain-spoken, no exclamation marks",   // prose, not tokens
  assets:     { logo?, deckTemplate? }                 // optional .pptx chassis
}
```

One set, deliberately small. The temptation is a token system per medium; that
guarantees drift, and drift is the thing the user is asking to avoid.

### 2. One resolver

`resolveBrand(settings, brands)` — same shape as `resolveSendRoute` and
`resolveSearchRoute`, for the same reason: every surface asks one function, and
a source-derived test stops a new one from resolving its own. Returns `null`
when no brand is chosen, and `null` is a first-class answer — craft rules alone
already produce good output.

### 3. Three adapters, one per medium

- **Deck** → writes `brands/<id>/{brand_config,pptx_config}.yaml` into the ppt
  plugin, reusing the mechanism that is already there. An optional `.pptx`
  becomes the chassis; without one, python-pptx's built-in layouts (as of
  `ccc047c`).
- **Web** → tokens injected into the `craft-web` context as CSS custom
  properties.
- **Doc/print** → same tokens, print rules from `craft-doc`.

Craft skills stay brand-agnostic. A brand supplies values; it never overrides
"ALL CAPS needs tracking" or "a list that can be empty always is".

### 4. The UI — Customize, not Settings

Settings is where credentials and toggles live. This is a creative choice with a
preview, which belongs in Customize.

- **A gallery of presets.** Six or so, each rendered as a real preview card —
  actual type, actual palette, on a miniature slide and a miniature page. Named
  for what they are ("Editorial", "Technical", "Warm", "Monochrome"), not for a
  company.
- **"Describe your own"** → a prompt box. `theme-factory` already accepts a URL,
  an adjective, or an image, so the agent-assisted path is mostly wiring: user
  types "like Stripe's docs but warmer", agent returns a token set, the UI shows
  the same preview cards, user accepts or nudges.
- **Import** — drop in a `.pptx` and read its theme colours and fonts, or a
  logo and derive a palette from it.
- Every brand editable afterwards through the same preview, never a YAML file.

### 5. When it applies

Default: **the selected brand applies to everything, silently.** That is what
"consistently produce themed content" means, and asking every time would be
noise.

`AskUserQuestion` at generation time only when the request is genuinely
ambiguous — an explicit "make this one look different", or more than one brand
configured and no default. The gate should be a real condition, not a prompt
that fires on every document; a question the user answers the same way fifty
times is a bug.

## Sequencing

1. Brand store + resolver + guard test — no UI, brand chosen in a JSON file.
   Proves the tokens reach all three renderers.
2. Deck adapter first: it is the one with an existing brand mechanism, and the
   one that just failed for you.
3. Customize UI with the preset gallery.
4. `theme-factory` wiring for "describe your own".
5. Web and doc adapters.

Each step is usable on its own. (1) and (2) together already give consistent
decks.

## Worth deciding before building

- **How many presets, and who designs them?** Six good ones beat twenty
  generated ones. This is the part that most needs taste rather than code, and
  it is the part I would want you to look at rather than me choosing.
- **Does a brand travel with a project?** A per-project override is obvious once
  brands exist, and cheap if designed in now — expensive if retrofitted.
- **Logo handling.** Deck templates want it placed; web artifacts usually do
  not. Probably out of scope for v1.

## What I would check, having been wrong repeatedly today

The eval harness is already the right shape: `deck-pitch`, `pdf-report` and
`pricing-tiers` span three media, so running one brief per medium under one
brand and eyeballing the three outputs together IS the "does it hold up" test.
That is worth doing before declaring any of this works.

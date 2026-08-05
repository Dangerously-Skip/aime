---
name: wireframe
description: Produce a low-fidelity wireframe — greybox blocks, sketch, annotated redlines, or a mobile flow. Use when the point is structure and layout rather than finished visuals: exploring options, agreeing an information hierarchy, or specifying a build. Not for anything meant to look finished (use craft-web or web-prototype), not for slides (use deck-html).
---

# Wireframes

Low fidelity on purpose. A wireframe answers "what goes where and why" before
anyone argues about a shade of blue.

## Use this when the fidelity is the point

Showing a polished mock too early gets you feedback on the colours instead of
the structure — people critique what looks finished. Grey boxes ask a different
question, and get a different answer.

Reach for it when:

- you are exploring more than one arrangement and want them compared fairly
- the deliverable is a spec for someone else to build
- the user is thinking out loud about a screen rather than asking for a page
- a decision about hierarchy needs settling first

If the user wants something that looks real, this is the wrong skill.

## The four modes

Each lives at `~/.claude/plugins/web-templates/wireframe-<mode>/example.html`,
standalone with its styles inline. Read the example, then copy its conventions.

| Mode | What it is | Reach for it when |
|---|---|---|
| `greybox` | Neutral grey blocks, image placeholders as a rectangle with a diagonal X, text as lorem bars, sharp borders | The default. Structure and hierarchy on a desktop screen |
| `sketch` | Hand-drawn feel | Very early. Signals "nothing here is decided" more loudly than greybox |
| `annotated` | Greybox plus numbered redlines and margin notes | Handing a spec to a developer — behaviour, states, edge cases |
| `mobile-flow` | Several phone screens side by side with flow arrows | A journey across screens, not one screen |

Pick `annotated` whenever the wireframe will outlive the conversation. An
un-annotated wireframe six months later is a picture of a decision nobody
recorded.

## What stays true whatever the mode

**No colour beyond the greys and one accent.** The accent marks annotations, not
emphasis. A wireframe that starts using colour to show importance has become a
bad mock.

**Real content, not lorem, wherever you know it.** "Search 12,480 invoices"
tells the reader something; "Lorem ipsum dolor" tells them nothing and hides
that the real string will not fit. Lorem bars are for text you genuinely do not
know yet.

**Every state that exists, not just the populated one.** Empty, loading and
error are structural, and a wireframe is exactly where they are cheapest to
discuss. This is the same rule `craft-web` applies to finished UI, and it
matters more here — the whole point is to find the missing screens.

**Say what you assumed.** A wireframe carries decisions its picture cannot
show: what happens on submit, what the empty state says, which element is
primary. Write them down beside it.

## Offering options

When the arrangement is genuinely open, produce two or three greyboxes rather
than one, name what each optimises for, and ask which to develop. Comparing
options in grey is cheap; comparing them once one is painted is not.

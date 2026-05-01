---
name: nib-ppt
description: Generate PowerPoint presentations from markdown
allowed-tools: Bash, Write, Read
---

# PowerPoint Generation

When the user asks to create a PowerPoint or presentation, follow these steps exactly.

## Step 1: Write markdown

Write a `.md` file where each slide header has the form
`## SLIDE <slide-type>: <Slide Title>`. Slides are separated by `---`.

`<slide-type>` is one of: `title`, `section`, `content`, `two_column`, `image`, `table`.
`<Slide Title>` is the actual title text the slide should display.

CRITICAL: do not write the literal word `type` after `## SLIDE`. The
word `type` in the template above is a placeholder for the slide type
(e.g. `title`, `content`). Writing `## SLIDE type: My Title` produces
broken output where the slide title shows as "My Title" but the slide
type defaults to `content`, and the markdown content below leaks
through unparsed. Always substitute both placeholders.

Example (substituting both placeholders):
```markdown
## SLIDE title: Presentation Title
<!-- subtitle: Optional Subtitle -->
---
## SLIDE section: Section Name
---
## SLIDE content: Slide Title

- First point
- Second point
- **Bold point**

---
## SLIDE two_column: Comparison

::: column-left
### Left Side
Content here
:::

::: column-right
### Right Side
Content here
:::

---
## SLIDE table: Data Overview

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value A  | Value B  | Value C  |
```

## Step 2: Generate the .pptx

```bash
bash ~/.claude/plugins/nib-ppt/generate_presentation.sh input.md output.pptx
```

The presentation opens automatically when done.

## Options

- `--skip-html-gen` — skip HTML-to-PNG conversion (faster for text-only changes)
- `--no-open` — don't auto-open the result

## If dependencies are missing

```bash
pip3 install python-pptx pyyaml
```

## Rules

- Do NOT use python-pptx directly — always use the generate script
- Do NOT search for nib-ppt as a CLI tool — it is the shell script above
- Write the markdown first, then run the script

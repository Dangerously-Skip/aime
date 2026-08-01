---
name: powerpoint-control
description: Control Microsoft PowerPoint via AppleScript on macOS — open existing presentations, add/edit slides, change content on slides, apply templates, save as PPTX or PDF. Use this skill whenever the user wants to edit an existing PowerPoint file, automate PowerPoint tasks, or interact with an open PowerPoint on macOS. For *generating* new presentations from markdown, prefer the `a branded-ppt` plugin's `generate-ppt` skill which produces branded decks.
---

# PowerPoint Control (macOS AppleScript)

Automate Microsoft PowerPoint on macOS using AppleScript via `osascript`. Use the Bash tool.

## Prerequisites

- macOS
- Microsoft PowerPoint installed (`/Applications/Microsoft PowerPoint.app`)
- Automation permission granted to the calling process

## When to use this vs the deck generator

- **the `ppt` plugin's deck generator**: generating a brand-new PowerPoint from a markdown document using a configured brand template. This is the default for "make me a presentation".
- **This skill**: modifying an existing PowerPoint, reading slide content, quick tweaks to an open deck, automating a batch of edits across many decks.

## Common operations

### Open an existing presentation

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  activate
  open POSIX file "/Users/USERNAME/Documents/deck.pptx"
end tell
EOF
```

### Add a slide at the end

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  tell active presentation
    set slideCount to count of slides
    set newSlide to make new slide at after slide slideCount with properties {layout:slide layout text}
    set headerShape to item 1 of (shapes of newSlide whose placeholder format's placeholder type is title placeholder)
    set content of text frame of headerShape to "New slide title"
  end tell
end tell
EOF
```

### Change text on a specific slide

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  tell slide 3 of active presentation
    tell shape 2 -- content placeholder
      set content of text frame to "Updated body text"
    end tell
  end tell
end tell
EOF
```

### Read all text from a presentation

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  set outText to ""
  tell active presentation
    repeat with i from 1 to count of slides
      set outText to outText & "--- Slide " & i & " ---" & return
      repeat with s in shapes of slide i
        try
          set outText to outText & (content of text frame of s) & return
        end try
      end repeat
    end repeat
  end tell
  return outText
end tell
EOF
```

### Save as PDF

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  set pdfPath to "/Users/USERNAME/Desktop/deck-export.pdf"
  save active presentation in pdfPath as save as PDF
end tell
EOF
```

### Save as PPTX

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  set pptxPath to "/Users/USERNAME/Desktop/deck.pptx"
  save active presentation in pptxPath as save as default presentation
end tell
EOF
```

### Apply a template (use a different design)

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  tell active presentation
    apply template "/Users/USERNAME/Templates/your-template.potx"
  end tell
end tell
EOF
```

## Workflow: Batch text replacement across a deck

```bash
osascript <<'EOF'
tell application "Microsoft PowerPoint"
  tell active presentation
    repeat with s in every slide
      repeat with sh in every shape of s
        try
          if content of text frame of sh contains "OLD_TEXT" then
            set theText to content of text frame of sh
            set AppleScript's text item delimiters to "OLD_TEXT"
            set textParts to text items of theText
            set AppleScript's text item delimiters to "NEW_TEXT"
            set newText to textParts as string
            set AppleScript's text item delimiters to ""
            set content of text frame of sh to newText
          end if
        end try
      end repeat
    end repeat
  end tell
end tell
EOF
```

## Rules

- **Always activate first** — PowerPoint must be the frontmost app for some operations
- **Absolute paths** — no `~` shortcuts
- **Wrap fragile operations in `try` blocks** — not every shape has a text frame
- **Save explicitly** — PowerPoint doesn't auto-save AppleScript changes
- **Permission check** — macOS needs Automation permission for the calling app (Terminal, AIME, etc.) to control PowerPoint. First run will show a permission dialog.

## Layouts reference

Common values for `layout:` when making slides:
- `slide layout title` — title slide
- `slide layout text` — title + content
- `slide layout two column text` — title + two content columns
- `slide layout blank` — blank
- `slide layout title only` — title only
- `slide layout section header` — section divider

## When this skill doesn't fit

- Brand-new deck from scratch → use the `ppt` plugin's deck generator instead
- Non-macOS → this skill won't work; fall back to `python-pptx` library via Bash
- Complex animations / transitions → AppleScript can't reach those; do them in the UI

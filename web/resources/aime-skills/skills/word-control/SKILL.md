---
name: word-control
description: Control Microsoft Word via AppleScript on macOS — create documents, write content, apply formatting, insert tables, save as DOCX or PDF. Use this skill whenever the user wants to produce a Word document, edit an existing .docx, add content to an open Word document, or automate anything in Word. Also triggers on "make a Word doc", "open in Word", "save as DOCX".
---

# Word Control (macOS AppleScript)

Automate Microsoft Word on macOS using AppleScript via `osascript`. Use the Bash tool.

## Prerequisites

- macOS
- Microsoft Word installed (`/Applications/Microsoft Word.app`)
- This skill runs via `osascript` from the shell

## Common operations

### Create a new document with content

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  activate
  set newDoc to make new document
  tell newDoc
    set content of text object to "Your document content here.

Multiple paragraphs work naturally."
  end tell
end tell
EOF
```

### Save as DOCX

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  set theDoc to active document
  save as theDoc file name "/Users/USERNAME/Documents/output.docx" file format format document
end tell
EOF
```

### Save as PDF

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  set theDoc to active document
  save as theDoc file name "/Users/USERNAME/Documents/output.pdf" file format format PDF
end tell
EOF
```

### Set document title, heading, body style

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  set theDoc to active document
  tell theDoc
    -- Insert styled heading
    set theRange to text object
    set style of theRange to style theDoc "Heading 1"
    set content of theRange to "Document Title" & return
    -- Switch to body style
    make new paragraph at end of theRange with properties {style:style theDoc "Normal"}
  end tell
end tell
EOF
```

### Insert a table

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  set theDoc to active document
  tell theDoc
    set theTable to make new table at end of text object with properties {number of rows:3, number of columns:2}
    tell cell 1 of row 1 of theTable to set content of text object to "Header A"
    tell cell 2 of row 1 of theTable to set content of text object to "Header B"
    tell cell 1 of row 2 of theTable to set content of text object to "Row 1 A"
    tell cell 2 of row 2 of theTable to set content of text object to "Row 1 B"
  end tell
end tell
EOF
```

### Close without prompting

```bash
osascript -e 'tell application "Microsoft Word" to close active document saving no'
```

## Workflow patterns

### Generate a full document from markdown

1. Convert markdown to structured content (headings, paragraphs, lists)
2. Create new document
3. Walk the content tree, applying styles per element type
4. Save as user-specified path

### Edit an existing document

1. `osascript -e 'tell application "Microsoft Word" to open POSIX file "/path/to/file.docx"'`
2. Inspect current content via `content of text object of active document`
3. Apply edits using `find` / `replace` for targeted changes
4. Save in place

## Rules

- **Always activate Word first** — `tell application "Microsoft Word" to activate`
- **Absolute paths only** — AppleScript doesn't handle `~` expansion
- **Escape quotes** in content — use `\"` or heredocs for long strings
- **Check permissions first** — if the user hasn't granted accessibility/automation permission to Terminal/Electron, AppleScript will fail silently. Tell the user to check System Settings → Privacy & Security → Automation.
- **Don't use `do shell script` inside the AppleScript** — run the `osascript` from Bash directly.

## When this skill doesn't fit

- If the user wants a PPTX not DOCX → use `powerpoint-control` skill
- If the user wants a PDF from markdown → `python-docx` via Bash is often simpler than Word
- If the user is on Windows/Linux → this skill won't work, fall back to `python-docx` library

---
name: refresh-pptx
description: Reliable PowerPoint refresh workflow - force close, regenerate, reopen
allowed-tools: Bash
---

# Refresh PowerPoint

Handles the complete PowerPoint regeneration workflow:
1. Force close PowerPoint (even if not running)
2. Regenerate presentation from markdown
3. Verify it actually opened
4. If not open, force it open

## When to Use

- User requests PowerPoint regeneration after changes
- You've updated markdown content or visuals
- User says "the changes aren't showing up"
- You want to ensure a clean refresh

## Usage

```bash
# Force quit PowerPoint
osascript -e 'tell application "Microsoft PowerPoint" to quit' 2>/dev/null
sleep 1

# Regenerate
~/.claude/plugins/ppt/generate_presentation.sh presentation.md output.pptx

# Verify it opened, force open if not
sleep 2
open output.pptx
```

## Common Issues

- **"Changes still not showing"** — Check you're editing the right markdown file
- **"PowerPoint won't open"** — Check file permissions with `ls -la *.pptx`

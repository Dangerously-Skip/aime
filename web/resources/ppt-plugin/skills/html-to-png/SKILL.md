---
name: html-to-png
description: Convert HTML visuals to PNG images for PowerPoint slides
allowed-tools: Bash
---

# HTML to PNG

Convert HTML files (charts, metric cards, diagrams) to PNG images for PowerPoint presentations.

## Usage

```bash
python3 ~/.claude/plugins/nib-ppt/html_to_image.py \
    --template custom \
    --html visuals/my-chart.html \
    --output visuals/my-chart.png \
    --width 1600 \
    --height 800
```

## Parameters

- `--template custom` — Required for custom HTML files
- `--html <file>` — Path to HTML file to convert
- `--output <file>` — Path for output PNG
- `--width <pixels>` — Image width (default: 1600 recommended)
- `--height <pixels>` — Image height (default: 800 recommended)

## Common Mistakes

- **WRONG**: Using raw Playwright code instead of the script
- **WRONG**: Forgetting `--template custom` flag
- **CORRECT**: Using html_to_image.py with proper flags

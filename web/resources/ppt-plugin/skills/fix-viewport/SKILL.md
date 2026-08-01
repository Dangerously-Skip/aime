---
name: fix-viewport
description: Diagnose and fix image cropping/viewport width issues in PowerPoint slides
allowed-tools: Bash, Read, Grep
---

# Fix Viewport

Diagnoses and fixes viewport/cropping issues when HTML visuals are converted to PNG for PowerPoint. Common symptoms:
- Left or right side of visual is cut off
- Content appears zoomed in or scaled weirdly
- Data table or charts are partially missing

## Diagnostic Steps

1. Check HTML container width: `grep -A5 "container" visuals/my-chart.html | grep width`
2. Check viewport width: `grep "viewport.*width" ~/.claude/plugins/ppt/html_to_image.py`
3. Open HTML in browser: `open -a "Google Chrome" visuals/my-chart.html`

## The Fix

Regenerate PNG with viewport width >= content width:

```python
from playwright.sync_api import sync_playwright
import os

html_path = os.path.abspath('visuals/my-chart.html')
VIEWPORT_WIDTH = 1600  # content width + buffer

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': VIEWPORT_WIDTH, 'height': 900})
    page.goto(f'file://{html_path}', wait_until='networkidle')
    page.screenshot(path='visuals/my-chart.png', full_page=False)
    browser.close()
```

## Common Viewport Widths

| Layout | Recommended |
|--------|-------------|
| Single chart (900px) | 1000px |
| Chart + table (1420px) | 1600px |
| Three columns | 2000px |

Rule of thumb: Viewport width = content width + 100px buffer

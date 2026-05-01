# Fork Quickstart Guide

**Warning**: You're about to do something dangerously stupid with PowerPoint. Let's make sure the agent survives.

## 60-Second Setup

### 1. Install the Safety Equipment

```bash
# Python dependencies (your protective gear)
pip3 install python-pptx pyyaml playwright jinja2

# Playwright browser (the grounding wire)
playwright install chromium
```

### 2. Verify the Wiring

```bash
cd /path/to/fork

# Check that you have:
ls -la
# ├── generate_presentation.sh    ✓ The detonator
# ├── markdown_to_pptx.py         ✓ The reactor core
# ├── html_to_image.py            ✓ The voltage converter
# ├── pptx_config.example.yaml    ✓ Circuit diagram template
# └── brand_config.example.yaml   ✓ Voltage spec template
```

### 3. Create Your First Deck

Create `my-presentation.md`:

```markdown
## SLIDE title: Fork Quickstart
<!-- subtitle: My First Dangerous Presentation -->
<!-- authors: Brave Agent -->
<!-- date: 2024-01-05 -->

---

## SLIDE section: Getting Started

---

## SLIDE content: Why Fork?

Because manually editing PowerPoint is like:
- Performing surgery with oven mitts
- Debugging with your eyes closed
- **Sticking a fork in a power outlet**

Let agents handle the electricity.

---

## SLIDE two_column: Before vs After

::: column-left
### Before Fork
- 2 hours per deck
- Repetitive strain injury
- Existential dread
:::

::: column-right
### After Fork
- 30 seconds per deck
- Zero manual labor
- Pure automation bliss
:::
```

### 4. Push the Red Button

```bash
./generate_presentation.sh my-presentation.md my-first-deck.pptx
```

**What happens:**
1. ⚡ Fork reads your markdown
2. ⚡ Converts HTML visuals to images
3. ⚡ Maps content to PowerPoint layouts
4. ⚡ Generates the presentation
5. ⚡ Opens it automatically

**Time elapsed:** ~30 seconds
**Manual work:** Zero
**Electrical burns:** None (agents are immune)

## Adding Custom Visuals

### Create an HTML Visual

Create `visuals/metric-card.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: Arial, sans-serif;
        }
        .card {
            background: linear-gradient(135deg, #144a38, #000);
            border-left: 8px solid #82e578;
            padding: 48px;
            border-radius: 12px;
        }
        .value {
            font-size: 72px;
            font-weight: bold;
            color: #82e578;
            margin: 0;
        }
        .label {
            font-size: 24px;
            color: #fff;
            margin-top: 8px;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="value">127%</div>
        <div class="label">Productivity Increase</div>
    </div>
</body>
</html>
```

### Reference It in Markdown

```markdown
## SLIDE image: Performance Metrics
<!-- image: visuals/metric-card.png -->
```

### Generate

```bash
# Fork automatically converts HTML → PNG
./generate_presentation.sh my-presentation.md output.pptx
```

The agent:
1. Finds `metric-card.html`
2. Renders it in a headless browser
3. Captures as `metric-card.png`
4. Embeds in your slide

**You:** Write HTML
**Agent:** Handle the dangerous conversion
**Result:** Professional slides

## Configuration (Optional)

### Setup Your Brand

Copy the example configs:

```bash
cp pptx_config.example.yaml pptx_config.yaml
cp brand_config.example.yaml brand_config.yaml
```

Edit `brand_config.yaml` with your brand's voltage:

```yaml
colors:
  primary:
    brand_primary: "#your-color"    # Your hot wire
    brand_accent: "#your-accent"    # Your ground wire

typography:
  fonts:
    primary: "Your Font"
    fallback_sans: "Arial, sans-serif"
```

### Use a Custom Template

1. Create a brand directory and save your template: `brands/my-brand/template.pptx`
2. Update `pptx_config.yaml`:

```yaml
template: "brands/my-brand/template.pptx"

layouts:
  title_slide: 0          # Your title layout index
  section_header: 1       # Your section layout index
  title_and_content: 2    # Your content layout index
  two_content: 3          # Your two-column layout index
  image_slide: 4          # Your image layout index
```

**Finding layout indices:**

```python
from pptx import Presentation
prs = Presentation('brands/my-brand/template.pptx')
for i, layout in enumerate(prs.slide_layouts):
    print(f"{i}: {layout.name}")
```

## Common Workflows

### Workflow 1: Simple Deck (No Visuals)

```bash
# Just markdown → PowerPoint
echo "## SLIDE title: Quick Deck" > quick.md
./generate_presentation.sh quick.md quick.pptx
```

**Time:** 10 seconds

### Workflow 2: Deck with HTML Visuals

```bash
# 1. Create your markdown
vim presentation.md

# 2. Create HTML visuals in visuals/
vim visuals/chart.html
vim visuals/diagram.html

# 3. Generate everything at once
./generate_presentation.sh presentation.md output.pptx
```

**Time:** 30 seconds (including HTML→PNG conversion)

### Workflow 3: Iterative Editing

```bash
# First generation
./generate_presentation.sh deck.md output.pptx

# Edit markdown
vim deck.md

# Regenerate (skip HTML conversion for speed)
./generate_presentation.sh --skip-html-gen deck.md output.pptx
```

**Iteration time:** 5-10 seconds

### Workflow 4: Multi-Brand Generation

```bash
# Generate for Brand A
./generate_presentation.sh \
    -c configs/brand-a/pptx_config.yaml \
    -b configs/brand-a/brand_config.yaml \
    content.md brand-a-deck.pptx

# Generate for Brand B (same content, different brand)
./generate_presentation.sh \
    -c configs/brand-b/pptx_config.yaml \
    -b configs/brand-b/brand_config.yaml \
    content.md brand-b-deck.pptx
```

**Result:** Same content, two different branded decks

## Tips for Agents

### Do:
- ✅ Write markdown with clear slide boundaries (`---`)
- ✅ Use semantic HTML in visuals
- ✅ Keep file paths relative
- ✅ Test your HTML in a browser first
- ✅ Use the `--skip-html-gen` flag for faster iterations

### Don't:
- ❌ Manually edit the generated PowerPoint
- ❌ Use absolute file paths
- ❌ Set background colors in HTML (transparency is your friend)
- ❌ Forget to install Playwright
- ❌ Try to be a hero - let Fork handle the dangerous stuff

## Troubleshooting Speedrun

### "Command not found: playwright"
```bash
pip3 install playwright
playwright install chromium
```

### "Layout not found"
Your `pptx_config.yaml` indices don't match your template. Find correct indices:
```python
from pptx import Presentation
prs = Presentation('your_template.pptx')
for i, layout in enumerate(prs.slide_layouts):
    print(f"{i}: {layout.name}")
```

### "Image not found"
Check your image paths are relative to where you run the command:
```markdown
<!-- Good -->
<!-- image: visuals/chart.png -->

<!-- Bad -->
<!-- image: /absolute/path/chart.png -->
```

### "HTML rendering failed"
1. Open the HTML file in a browser - does it render?
2. Check for JavaScript errors (Fork doesn't execute JS)
3. Verify Playwright is installed: `playwright --version`

### "The deck looks ugly"
Fork generates based on your template. If it's ugly, your template is ugly. Fix the template, not Fork.

## Next Steps

1. **Read the README.md** - Full documentation with all the electrical metaphors
2. **Check examples/** - Sample presentations to fork (ha) and modify
3. **Customize brand_config.yaml** - Make it yours
4. **Build something dangerous** - Let agents handle the high voltage work

---

**Remember**: The best presentation is one you never had to manually format.

**Fork** - Because life's too short for PowerPoint.

⚡ **Fork around and find out**

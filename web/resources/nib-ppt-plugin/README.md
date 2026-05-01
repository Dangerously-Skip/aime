# Fork

**Fork around and find out - agents edition**

The perfect match for PowerPoints. And just like sticking a fork in a power outlet, you absolutely shouldn't do it yourself - let AI agents handle the dangerous work.

## What is Fork?

Fork is an AI-agent-powered tool that generates professional PowerPoint presentations from markdown and HTML. It's dangerous enough that only agents should try it, but smart enough to deliver shockingly good results.

- **Markdown-to-PowerPoint**: Write in markdown, get enterprise-ready slides
- **HTML Visualizations**: Rich, custom graphics rendered as high-quality images
- **LLM Visual Judge**: Built-in AI agent reviews slides for quality issues
- **Fully Configurable**: Customize templates, brands, and quality standards
- **Agent-First Design**: Built for AI agents to automate the tedious stuff
- **One Command**: Fork it and you're done

## Why "Fork"?

Three reasons:
1. **Power outlet fork** - The dangerously stupid thing only AI would try
2. **Git fork** - Clone, modify, make it yours
3. **Utensil fork** - Stick a fork in it, your presentation's done

## ⚡ Warning: High Voltage

This tool does things with PowerPoint that violate the Geneva Convention of slide design. Do not attempt manually. Let agents handle it - they don't feel pain when presentations go wrong.

## Quick Start

### Prerequisites

```bash
# Install Python dependencies
pip3 install python-pptx pyyaml playwright jinja2

# Install Playwright browsers (for the shocking visuals)
playwright install chromium
```

### Generate Your First Deck

```bash
# The nuclear option - one command to rule them all
./generate_presentation.sh presentation.md output.pptx

# What happens:
# 1. HTML visuals get electrocuted into PNG images
# 2. Markdown gets forked into PowerPoint layouts
# 3. Your deck emerges, perfectly formatted
# 4. No humans were harmed in the making
```

## 🔧 Built for Your Organization

Fork is **fully configurable** - no hard-coded assumptions about your brand, templates, or quality standards.

### What You Can Customize

1. **PowerPoint Templates** (`pptx_config.yaml`)
   - Use any PowerPoint template
   - Map Fork's slide types to your layouts
   - Support multiple templates for different contexts

2. **Brand Identity** (`brand_config.yaml`)
   - Your colors, fonts, and typography
   - Multiple brands (corporate, sub-brands, partners)
   - Theme variants (light, dark, high-contrast)

3. **Quality Standards** (`review-standards/*.md`)
   - Define "what good looks like" for your context
   - Board presentations, internal docs, sales decks
   - Department-specific or audience-specific standards

**See [CONFIGURATION.md](./CONFIGURATION.md) for complete customization guide.**

### Example: Multi-Brand Setup

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

No forks stuck in outlets - Fork adapts to you.

## ⚡ Features That Spark Joy

### Write Slides in Markdown

```markdown
## SLIDE title: Quarterly Results
<!-- subtitle: Q4 2024 -->

---

## SLIDE section: Financial Overview
<!-- The section divider - like a circuit breaker between topics -->

---

## SLIDE content: Key Metrics

Revenue increased by 47% YoY due to:
- Strategic market expansion
- Product innovation
- Not sticking forks in outlets

---

## SLIDE two_column: Before vs After

::: column-left
### Before Fork
- Manual PowerPoint hell
- Hours of formatting
- Soul-crushing tedium
:::

::: column-right
### After Fork
- Markdown bliss
- Seconds of generation
- Agents do the dangerous work
:::

---

## SLIDE image: Architecture Diagram
<!-- image: visuals/system-architecture.png -->
```

### Ground Your Visuals with HTML

Create rich visualizations that agents convert to images:

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        :root {
            --voltage-green: #82e578;
            --ground-dark: #144a38;
        }
        .metric-card {
            background: linear-gradient(135deg, var(--ground-dark), #000);
            border-left: 5px solid var(--voltage-green);
            padding: 32px;
            border-radius: 8px;
        }
        .metric-value {
            font-size: 64px;
            color: var(--voltage-green);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="metric-card">
        <div class="metric-value">47%</div>
        <div class="metric-label">Revenue Growth</div>
    </div>
</body>
</html>
```

Save as `visuals/revenue-metric.html` and Fork converts it to a PNG faster than you can say "electrical hazard."

## Directory Structure

```
fork/
├── markdown_to_pptx.py          # The core reactor
├── html_to_image.py             # Voltage converter for HTML
├── generate_presentation.sh     # The red button - push to detonate
├── brands/
│   └── nib/                     # Brand package (swap for your own)
│       ├── pptx_config.yaml     # Layout mapping (circuit diagram)
│       ├── brand_config.yaml    # Your brand's electrical specs
│       └── Presentation_Template.pptx  # The PowerPoint chassis
├── visuals/
│   ├── *.html                   # High voltage HTML
│   └── *.png                    # Safely grounded images
└── examples/
    └── sample_presentation.md   # Example of not dying
```

## Configuration

### PowerPoint Config (`pptx_config.yaml`)

Wire up your layouts:

```yaml
template: "brands/nib/Presentation_Template.pptx"

layouts:
  title_slide: 0          # The main breaker
  section_header: 1       # Circuit dividers
  title_and_content: 2    # Single-phase content
  two_content: 3          # Two-phase parallel circuits
  image_slide: 4          # Full voltage image

slide_type_defaults:
  title: title_slide
  section: section_header
  content: title_and_content
  two_column: two_content
  image: image_slide
```

### Brand Config (`brand_config.yaml`)

Your brand's electrical specifications:

```yaml
colors:
  primary:
    brand_green: "#144a38"     # Ground wire
    bright_green: "#82e578"    # Hot wire (high voltage)
    dark_green_1: "#13362a"    # Neutral 1
    dark_green_2: "#122a21"    # Neutral 2

  neutrals:
    gray_900: "#1a1a1a"        # Insulation (darkest)
    gray_100: "#f5f5f5"        # Insulation (lightest)

typography:
  fonts:
    primary: "Inter"            # The conductor
    serif: "Merriweather"       # The resistor
    fallback_sans: "Arial, Helvetica, sans-serif"
    fallback_serif: "Georgia, serif"

  headings:
    xxl: 54   # Maximum voltage
    xl: 36    # High voltage
    lg: 28    # Standard voltage
    md: 20    # Low voltage
    sm: 18    # Trickle charge
```

## Command Line Options

```bash
./generate_presentation.sh [OPTIONS] <markdown_file> <output_pptx>

OPTIONS:
    -c, --config FILE           PowerPoint config (default: pptx_config.yaml)
    -b, --brand-config FILE     Brand config (default: brand_config.yaml)
    -v, --visuals-dir DIR       HTML visuals directory (default: visuals)
    -s, --skip-html-gen         Skip HTML→PNG conversion (use cached)
    -n, --no-open               Don't open presentation after generation
    -h, --help                  Show this shocking documentation

EXAMPLES:
    # Basic - just fork it
    ./generate_presentation.sh deck.md output.pptx

    # Custom configs - bring your own voltage
    ./generate_presentation.sh -c custom.yaml -b brand.yaml deck.md output.pptx

    # Skip HTML generation - use the surge protector
    ./generate_presentation.sh --skip-html-gen deck.md output.pptx
```

## Advanced: Multi-Brand Wiring

Supporting multiple brands? Create separate electrical systems:

```
configs/
├── acme-corp/
│   ├── pptx_config.yaml       # ACME's circuit layout
│   ├── brand_config.yaml      # ACME's voltage specs
│   └── template.pptx          # ACME's chassis
├── globex/
│   ├── pptx_config.yaml       # Globex's wiring diagram
│   ├── brand_config.yaml      # Globex's amperage
│   └── template.pptx          # Globex's shell
└── default/
    └── ...                     # Standard electrical code

# Generate with specific brand voltage
./generate_presentation.sh \
    -c configs/acme-corp/pptx_config.yaml \
    -b configs/acme-corp/brand_config.yaml \
    acme-quarterly.md acme-q4.pptx
```

## LLM Visual Judge: Quality Assurance on Autopilot

Fork includes a built-in **visual-reviewer agent** - an LLM judge that automatically reviews your presentations for quality issues.

### Why You Need It

**Code review is NOT enough.** Many critical issues only appear when you actually LOOK at rendered slides:
- Duplicate titles (slide title vs image title)
- Poor space utilization (timid content, excessive whitespace)
- Text overlaps or truncation
- Rendering artifacts
- Professional appearance issues

### How to Use the Visual Judge

After generating a presentation, invoke the visual reviewer:

```bash
# Generate presentation
./generate_presentation.sh my-deck.md my-deck.pptx

# Convert to preview images
python3 pptx_to_images.py my-deck.pptx --output slide-previews/ --with-index

# In Claude Code, the visual-reviewer agent can now analyze the slides
# The agent will read VISUAL_REVIEW_CHECKLIST.md and systematically review each slide
```

The visual reviewer checks:
- ✅ **Space Utilization**: Bold, commanding visuals vs timid centered content
- ✅ **Visual Impact**: Professional board-ready quality
- ✅ **Content Clarity**: No duplicate information, readable text
- ✅ **Technical Quality**: Transparent backgrounds, brand consistency
- ✅ **Critical Issues**: Text overlaps, truncation, rendering problems

### What You Get

The LLM judge provides structured feedback:

```
## Visual Quality Assessment

### What's Working Well
- [Strengths identified]

### Critical Issues (Must Fix)
- [Issue with location and impact]

### Nice-to-Have Improvements
- [Suggestions for enhancement]

### Quality Rating
- Excellent / Good / Needs Work / Unacceptable

### Recommendations
1. [Specific action to take]
2. [Next improvement]
```

### The Visual Review Process

1. **Generate** your presentation with Fork
2. **Convert** to slide preview images using `pptx_to_images.py`
3. **Invoke** the visual-reviewer agent (available in `.claude/agents/`)
4. **Review** the structured feedback
5. **Iterate** on issues identified
6. **Repeat** until quality rating is "Excellent"

### Review Checklist

The agent follows the **VISUAL_REVIEW_CHECKLIST.md** framework, checking:

**Stage 1: HTML in Browser** (before PNG conversion)
- Text overlaps or floating labels
- Layout issues or misalignments
- Content fits within dimensions

**Stage 2: Standalone PNG Files** (after conversion)
- Rendering quality
- Transparent backgrounds
- Proper dimensions
- Sharp text and colors

**Stage 3: PowerPoint Slides** (final review)
- Image positioning
- No truncation
- No duplicate titles
- Professional appearance

### Success Criteria

A presentation passes when:
1. ✅ All visualizations are BOLD and COMMANDING
2. ✅ No duplicate titles
3. ✅ Excellent space utilization
4. ✅ Professional board-ready quality
5. ✅ Consistent branding
6. ✅ All text readable from distance
7. ✅ No rendering artifacts

**Remember**: You MUST actually LOOK at the slides. The LLM judge helps catch what code review alone cannot reveal.

## Best Practices

### 1. Let Agents Do the Dangerous Work
- Never manually edit generated presentations
- Fork handles the electrical engineering
- You just write markdown and HTML

### 2. Use Maximum Wattage for Visuals
- Utilize 90-95% of slide width
- Bold, commanding graphics
- No timid whitespace

### 3. Ground Your Brand Identity
- Define all colors in `brand_config.yaml`
- Use CSS variables in HTML (`--voltage-green`)
- Consistent styling across all slides

### 4. Insulate Against Errors
- Test templates before high-stakes presentations
- Use `.example.yaml` configs as reference wiring diagrams
- Version control your markdown sources

### 5. Circuit Breakers for Performance
- Cache generated PNGs (use `-s` flag to skip regeneration)
- Optimize HTML (less DOM = less resistance)
- Keep image dimensions reasonable (1200×700px recommended)

## Markdown Syntax Reference

```markdown
## SLIDE title: Main Title
<!-- subtitle: Optional subtitle -->
<!-- authors: Your Name -->
<!-- date: 2024-01-05 -->

---

## SLIDE section: Chapter Name
<!-- layout: Optional Layout Override -->

---

## SLIDE content: Content Title

Standard markdown works:
- **Bold** (high voltage)
- *Italic* (alternating current)
- `code` (grounded)
- [Links](https://example.com) (conductors)

---

## SLIDE two_column: Side by Side

::: column-left
Left side content
:::

::: column-right
Right side content
:::

---

## SLIDE image: Full Slide Visual
<!-- image: visuals/architecture.png -->

---

## SLIDE table: Data Tables

| Metric | Q3 | Q4 | Change |
|--------|----|----|--------|
| Revenue | $10M | $14.7M | +47% |
| Users | 100K | 150K | +50% |
```

## Troubleshooting

### "Layout not found" Error
**Cause**: Your template's circuit diagram doesn't match `pptx_config.yaml`

**Solution**:
```python
from pptx import Presentation
prs = Presentation('your_template.pptx')
for i, layout in enumerate(prs.slide_layouts):
    print(f"{i}: {layout.name}")
```

Update the layout indices in your config.

### Images Not Rendering
**Cause**: Playwright isn't installed or HTML has syntax errors

**Solution**:
```bash
playwright install chromium
# Check your HTML in a browser first
```

### Fonts Look Wrong
**Cause**: Fonts not installed on your system

**Solution**: Install the fonts specified in `brand_config.yaml` or update the config with fonts you have.

### The Deck Looks Terrible
**Cause**: You tried to manually edit it

**Solution**: Don't. Let Fork regenerate it. Agents don't judge your design choices.

## Who Should Use Fork?

- **AI Agents** building presentations autonomously
- **Engineers** who'd rather write markdown than wrestle PowerPoint
- **Teams** generating repetitive slide decks
- **Masochists** who enjoy living dangerously
- **Anyone** tired of manually adjusting text boxes at 2am

## Who Should NOT Use Fork?

- People allergic to automation
- PowerPoint purists who think Comic Sans is "professional"
- Anyone expecting AI to respect electrical safety codes
- Designers who need pixel-perfect manual control

## Contributing

Fork is agent-first, so:
1. Keep it dangerous (but functional)
2. Maintain the electrical theme in docs
3. Configuration over hardcoding
4. Test with multiple brands/templates
5. Document your circuit diagrams

## License

Internal tool. Don't fork without permission.

## Support

**Having issues?** Good. That means you're using it correctly.

For actual help:
- Check `QUICKSTART.md` for wiring instructions
- Review `examples/` for reference implementations
- Read the damn error messages (agents wrote them for you)

---

**Fork** - The perfect match for PowerPoints.

**Version**: 1.0.0
**Status**: ⚡ Dangerously operational
**Tagline**: Fork around and find out - agents edition

**Remember**: Never stick a fork in a PowerPoint without proper agent supervision.

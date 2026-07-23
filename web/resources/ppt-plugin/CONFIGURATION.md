# Fork Configuration Guide

Fork is designed to be **fully configurable** for any organization, brand, or presentation context. This guide explains every customization point.

## Configuration Philosophy

Fork separates:
1. **Structure** (PowerPoint layouts) - `pptx_config.yaml`
2. **Brand** (colors, fonts, styling) - `brand_config.yaml`
3. **Quality Standards** (what "good" looks like) - `review-standards/*.md`

This means you can:
- Use the same structure with different brands
- Use the same brand with different quality standards
- Mix and match as needed

## Configuration Files

### 1. PowerPoint Configuration (`pptx_config.yaml`)

**What it controls**: Mapping from Fork's slide types to your PowerPoint template's layouts.

**Location**: `pptx_config.yaml` (or specify with `-c` flag)

**Example**:
```yaml
template: "brands/your-brand/template.pptx"

layouts:
  title_slide: 0          # Index of your title layout
  section_header: 1       # Index of your section divider layout
  title_and_content: 2    # Index of your content layout
  two_content: 3          # Index of your two-column layout
  image_slide: 4          # Index of your full-image layout

slide_type_defaults:
  title: title_slide
  section: section_header
  content: title_and_content
  two_column: two_content
  image: image_slide
```

**How to customize**:

1. **Find your layout indices**:
   ```python
   from pptx import Presentation
   prs = Presentation('brands/your-brand/template.pptx')
   for i, layout in enumerate(prs.slide_layouts):
       print(f"{i}: {layout.name}")
   ```

2. **Update indices** in `pptx_config.yaml` to match your template

3. **Test** with a sample presentation:
   ```bash
   ./generate_presentation.sh -c pptx_config.yaml test.md test.pptx
   ```

**Common customizations**:
- Multiple templates for different contexts (board vs internal)
- Custom layout types (e.g., "comparison", "timeline", "agenda")
- Layout overrides per slide type

---

### 2. Brand Configuration (`brand_config.yaml`)

**What it controls**: Visual identity - colors, fonts, typography scale.

**Location**: `brand_config.yaml` (or specify with `-b` flag)

**Example**:
```yaml
colors:
  primary:
    brand_primary: "#your-primary-color"
    brand_accent: "#your-accent-color"
    brand_dark: "#your-dark-color"
    brand_light: "#your-light-color"

  neutrals:
    gray_900: "#1a1a1a"
    gray_700: "#4d4d4d"
    gray_500: "#808080"
    gray_300: "#cccccc"
    gray_100: "#f5f5f5"

  semantic:
    success: "#00cc66"
    warning: "#ffaa00"
    error: "#cc0000"
    info: "#0066cc"

typography:
  fonts:
    primary: "Your Sans Serif Font"
    serif: "Your Serif Font"
    mono: "Your Monospace Font"
    fallback_sans: "Arial, Helvetica, sans-serif"
    fallback_serif: "Georgia, serif"
    fallback_mono: "Courier New, monospace"

  headings:
    xxl: 54   # Extra-large titles
    xl: 36    # Large headings
    lg: 28    # Medium headings
    md: 20    # Small headings
    sm: 18    # Extra-small headings

  body:
    large: 16
    regular: 14
    small: 12
    caption: 10
```

**How to customize**:

1. **Copy example config**:
   ```bash
   cp brand_config.example.yaml my-company-brand.yaml
   ```

2. **Update colors** to match your brand guidelines

3. **Update fonts** to your company's typefaces

4. **Adjust type scale** based on your presentation context

5. **Test** with HTML visualizations:
   ```bash
   python3 html_to_image.py --brand-config my-company-brand.yaml \
       --html test.html --output test.png
   ```

**Common customizations**:
- Multiple brand configs (primary brand, sub-brands, partner brands)
- Context-specific color palettes (light theme, dark theme)
- Accessibility-focused palettes (high contrast)

---

### 3. Review Standards (`review-standards/*.md`)

**What they control**: Quality criteria for presentations - what "good" looks like.

**Location**: `review-standards/` directory

**Available standards**:
- `board-presentation-standards.md` - Formal, high-impact executive presentations
- `internal-docs-standards.md` - Practical, information-dense team documentation
- `sales-deck-standards.md` - Persuasive, customer-centric sales materials
- `custom-standards-template.md` - Template for creating your own

**How to customize**:

1. **Choose a starting point**:
   ```bash
   cp review-standards/board-presentation-standards.md \
      review-standards/my-company-standards.md
   ```

2. **Customize criteria**:
   - Space utilization requirements (width %, padding)
   - Text size minimums
   - Quality rating definitions
   - Success criteria

3. **Update visual-reviewer agent**:
   Edit `.claude/agents/visual-reviewer.md` to reference your standards:
   ```markdown
   1. **Read the checklist** - Always start by reading review-standards/my-company-standards.md
   ```

4. **Test** with real presentations:
   ```bash
   # Generate presentation
   ./generate_presentation.sh deck.md output.pptx

   # Convert to previews
   python3 pptx_to_images.py output.pptx --output slide-previews/

   # Review with your standards (in Claude Code)
   # Invoke visual-reviewer agent
   ```

**Common customizations**:
- Department-specific standards (engineering, sales, HR, finance)
- Audience-specific standards (executive, technical, customer)
- Context-specific standards (formal, casual, urgent)

---

## Multi-Configuration Workflows

### Scenario 1: Multiple Brands

**Structure**:
```
configs/
├── brand-a/
│   ├── pptx_config.yaml
│   ├── brand_config.yaml
│   └── template.pptx
├── brand-b/
│   ├── pptx_config.yaml
│   ├── brand_config.yaml
│   └── template.pptx
└── brand-c/
    ├── pptx_config.yaml
    ├── brand_config.yaml
    └── template.pptx
```

**Usage**:
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

### Scenario 2: Multiple Contexts

**Structure**:
```
configs/
├── board-presentations/
│   ├── pptx_config.yaml
│   └── brand_config.yaml
├── internal-docs/
│   ├── pptx_config.yaml
│   └── brand_config.yaml
└── customer-facing/
    ├── pptx_config.yaml
    └── brand_config.yaml

review-standards/
├── board-presentation-standards.md
├── internal-docs-standards.md
└── customer-facing-standards.md
```

**Usage**:
```bash
# Board presentation (formal, high-impact)
./generate_presentation.sh \
    -c configs/board-presentations/pptx_config.yaml \
    -b configs/board-presentations/brand_config.yaml \
    board-update.md board-q4.pptx
# Review with: review-standards/board-presentation-standards.md

# Internal documentation (practical, efficient)
./generate_presentation.sh \
    -c configs/internal-docs/pptx_config.yaml \
    -b configs/internal-docs/brand_config.yaml \
    tech-update.md tech-status.pptx
# Review with: review-standards/internal-docs-standards.md
```

### Scenario 3: Template Variants

**Structure**:
```
brands/my-brand/
├── formal-presentation.pptx       # Lots of whitespace, large text
├── dense-documentation.pptx       # Tighter spacing, smaller text
├── visual-storytelling.pptx       # Large images, minimal text
├── technical-report.pptx          # Code-friendly, monospace
├── formal-pptx-config.yaml        # Points to formal-presentation.pptx
├── dense-pptx-config.yaml         # Points to dense-documentation.pptx
├── visual-pptx-config.yaml        # Points to visual-storytelling.pptx
└── technical-pptx-config.yaml     # Points to technical-report.pptx
```

**Usage**: Choose template based on content density and audience.

---

## Advanced Configuration

### Custom HTML Templates

Fork's `html_to_image.py` supports custom HTML templates for visualizations.

**Location**: Create your own HTML files in `visuals/`

**Available variables** (from `brand_config.yaml`):
```html
<style>
  :root {
    /* Colors from brand_config.yaml */
    --color-brand-primary: {{ brand_primary }};
    --color-brand-accent: {{ brand_accent }};

    /* Fonts from brand_config.yaml */
    --font-primary: {{ font_primary }};
    --font-serif: {{ font_serif }};

    /* Typography scale from brand_config.yaml */
    --text-xxl: {{ heading_xxl }}pt;
    --text-xl: {{ heading_xl }}pt;
  }
}
</style>
```

**Example custom template**:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--font-primary), sans-serif;
      padding: 24px 12px;
      max-width: 1350px;
    }
    .metric-value {
      font-size: var(--text-xxl);
      color: var(--color-brand-accent);
    }
  </style>
</head>
<body>
  <div class="metric-value">47%</div>
  <div class="metric-label">Revenue Growth</div>
</body>
</html>
```

### Custom Slide Types

Add custom slide types by:

1. **Create layout in PowerPoint** template
2. **Add to `pptx_config.yaml`**:
   ```yaml
   layouts:
     custom_comparison: 5
     custom_timeline: 6

   slide_type_defaults:
     comparison: custom_comparison
     timeline: custom_timeline
   ```
3. **Use in markdown**:
   ```markdown
   ## SLIDE comparison: Before vs After
   <!-- Uses the custom_comparison layout -->
   ```

### Environment-Specific Configuration

Use environment variables for dynamic configuration:

```bash
# Development environment
export FORK_CONFIG=configs/dev/pptx_config.yaml
export FORK_BRAND=configs/dev/brand_config.yaml

# Production environment
export FORK_CONFIG=configs/prod/pptx_config.yaml
export FORK_BRAND=configs/prod/brand_config.yaml

# Generate using environment variables
./generate_presentation.sh -c $FORK_CONFIG -b $FORK_BRAND deck.md output.pptx
```

---

## Configuration Best Practices

### 1. Version Control Your Configs

```bash
git add pptx_config.yaml brand_config.yaml review-standards/
git commit -m "Update presentation standards for Q1 2025"
```

Track changes to understand how your standards evolve.

### 2. Document Your Choices

Add comments to config files:

```yaml
# Brand colors updated 2025-01-05 to match rebrand
colors:
  primary:
    brand_primary: "#144a38"  # New teal (was #0066cc blue)
```

### 3. Test Changes Incrementally

Don't change everything at once:

```bash
# Test brand changes first
./generate_presentation.sh -b new-brand.yaml test.md test.pptx

# Then test layout changes
./generate_presentation.sh -c new-layouts.yaml test.md test.pptx

# Then combine
./generate_presentation.sh -c new-layouts.yaml -b new-brand.yaml test.md test.pptx
```

### 4. Maintain Examples

Keep example presentations for each configuration:

```
examples/
├── board-presentation-example.md
├── internal-docs-example.md
├── sales-deck-example.md
└── technical-report-example.md
```

### 5. Share Configurations

If your organization uses Fork across teams, centralize configs:

```
shared-configs/
├── README.md                 # How to use these configs
├── corporate/                # Official corporate brand
├── product-teams/            # Product-specific brands
└── review-standards/         # Company-wide standards
```

---

## Troubleshooting Configuration

### "Layout not found" error

**Cause**: `pptx_config.yaml` indices don't match template.

**Fix**:
```python
from pptx import Presentation
prs = Presentation('your_template.pptx')
for i, layout in enumerate(prs.slide_layouts):
    print(f"{i}: {layout.name}")
```
Update indices in config.

### Colors not applying

**Cause**: `brand_config.yaml` not being used by HTML templates.

**Fix**: Verify HTML uses CSS variables like `var(--color-brand-primary)`.

### Review standards not followed

**Cause**: Visual-reviewer agent not reading correct standards file.

**Fix**: Update `.claude/agents/visual-reviewer.md` to reference correct file.

---

## Summary

Fork is designed to be **completely configurable**:

| What | Where | How |
|------|-------|-----|
| **PowerPoint Layouts** | `pptx_config.yaml` | Map slide types to template layouts |
| **Brand Identity** | `brand_config.yaml` | Define colors, fonts, typography |
| **Quality Standards** | `review-standards/*.md` | Define what "good" looks like |
| **Templates** | `brands/*/*.pptx` | Create custom PowerPoint templates |
| **Visual Styles** | `visuals/*.html` | Build custom HTML visualizations |

**No hard-coded assumptions** - Fork adapts to your needs, not the other way around.

---

**Fork** - Configurable for every organization, brand, and context.

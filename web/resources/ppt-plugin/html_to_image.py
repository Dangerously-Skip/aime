#!/usr/bin/env python3
"""
HTML to Image Converter for Brand Design Systems

Generates on-brand visuals from HTML/CSS using a configurable brand design system,
then converts them to images for insertion into PowerPoint.

Supports:
- Metrics cards with large numbers
- Infographics
- Process diagrams
- Custom visualizations

Usage:
    python3 html_to_image.py --template metrics_card --data data.yaml --output image.png
"""

import yaml
import argparse
from pathlib import Path
from jinja2 import Template
import base64

class MeshHTMLRenderer:
    """Renders HTML using brand configuration."""

    def __init__(self, brand_config_path='brand_config.yaml', transparent_bg=True):
        """Initialize with brand configuration.

        Args:
            brand_config_path: Path to brand config YAML
            transparent_bg: Use transparent background (default: True)
        """
        self.brand_config_path = Path(brand_config_path)
        self.transparent_bg = transparent_bg

        # Load brand config
        with open(self.brand_config_path, 'r') as f:
            self.brand = yaml.safe_load(f)

    def get_base_html_template(self):
        """Return base HTML template with Mesh Design System styles."""
        return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Visual</title>
    <style>
        /* Brand Design System - Embedded Styles */

        :root {
            /* Brand Colors */
            --color-brand-primary: {{ brand.colors.primary.brand_green }};
            --color-brand-accent: {{ brand.colors.primary.bright_green }};
            --color-brand-dark-1: {{ brand.colors.primary.dark_green_1 }};
            --color-brand-dark-2: {{ brand.colors.primary.dark_green_2 }};

            /* Neutrals */
            --color-black: {{ brand.colors.neutrals.black }};
            --color-gray-900: {{ brand.colors.neutrals.gray_900 }};
            --color-gray-700: {{ brand.colors.neutrals.gray_700 }};
            --color-gray-500: {{ brand.colors.neutrals.gray_500 }};
            --color-gray-300: {{ brand.colors.neutrals.gray_300 }};
            --color-gray-100: {{ brand.colors.neutrals.gray_100 }};
            --color-white: {{ brand.colors.neutrals.white }};

            /* Functional */
            --color-error: {{ brand.colors.functional.error }};
            --color-warning: {{ brand.colors.functional.warning }};
            --color-info: {{ brand.colors.functional.info }};
            --color-success: {{ brand.colors.functional.success }};

            /* Typography */
            --font-primary: "{{ brand.typography.fonts.primary }}", {{ brand.typography.fonts.fallback_sans }};
            --font-serif: "{{ brand.typography.fonts.serif }}", {{ brand.typography.fonts.fallback_serif }};

            /* Spacing */
            --spacing-xs: {{ brand.spacing.gaps.xs }}px;
            --spacing-sm: {{ brand.spacing.gaps.sm }}px;
            --spacing-md: {{ brand.spacing.gaps.md }}px;
            --spacing-lg: {{ brand.spacing.gaps.lg }}px;
            --spacing-xl: {{ brand.spacing.gaps.xl }}px;
            --spacing-xxl: {{ brand.spacing.gaps.xxl }}px;

            /* Border */
            --border-radius: {{ brand.components.borders.radius }}px;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--font-primary);
            color: var(--color-gray-900);
            background: {{ 'transparent' if transparent else 'var(--color-white)' }};
            padding: var(--spacing-xl);
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        /* Typography Classes */
        .heading-xxl {
            font-size: 54px;
            font-weight: 700;
            line-height: 1.2;
        }

        .heading-xl {
            font-size: 36px;
            font-weight: 700;
            line-height: 1.2;
        }

        .heading-lg {
            font-size: 28px;
            font-weight: 700;
            line-height: 1.3;
        }

        .body-regular {
            font-size: 16px;
            line-height: 1.5;
        }

        .body-small {
            font-size: 14px;
            line-height: 1.5;
        }

        /* Color Classes */
        .text-brand { color: var(--color-brand-primary); }
        .text-bright { color: var(--color-brand-accent); }
        .text-gray { color: var(--color-gray-700); }

        .bg-brand { background-color: var(--color-brand-primary); }
        .bg-bright { background-color: var(--color-brand-accent); }
        .bg-light { background-color: var(--color-gray-100); }

        /* Layout Classes */
        .grid {
            display: grid;
            gap: var(--spacing-md);
        }

        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }

        .flex {
            display: flex;
            gap: var(--spacing-md);
        }

        .flex-center {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* Card Component */
        .card {
            background: var(--color-white);
            border: 1px solid var(--color-gray-300);
            border-radius: var(--border-radius);
            padding: var(--spacing-lg);
        }

        .card-brand {
            background: var(--color-brand-primary);
            color: var(--color-white);
            border: none;
        }

        /* Metrics Component */
        .metric-card {
            text-align: center;
            padding: var(--spacing-xl);
        }

        .metric-value {
            font-size: 72px;
            font-weight: 700;
            color: var(--color-brand-primary);
            line-height: 1;
            margin-bottom: var(--spacing-sm);
        }

        .metric-label {
            font-size: 18px;
            color: var(--color-gray-700);
            font-weight: 500;
        }

        /* Process Flow Component */
        .process-flow {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
        }

        .process-step {
            flex: 1;
            text-align: center;
            padding: var(--spacing-lg);
            background: var(--color-gray-100);
            border-radius: var(--border-radius);
        }

        .process-arrow {
            font-size: 32px;
            color: var(--color-brand-primary);
        }

        /* Utility Classes */
        .text-center { text-align: center; }
        .text-left { text-align: left; }
        .text-right { text-align: right; }

        .mt-xs { margin-top: var(--spacing-xs); }
        .mt-sm { margin-top: var(--spacing-sm); }
        .mt-md { margin-top: var(--spacing-md); }
        .mt-lg { margin-top: var(--spacing-lg); }

        .mb-xs { margin-bottom: var(--spacing-xs); }
        .mb-sm { margin-bottom: var(--spacing-sm); }
        .mb-md { margin-bottom: var(--spacing-md); }
        .mb-lg { margin-bottom: var(--spacing-lg); }
    </style>
</head>
<body>
    {{ content }}
</body>
</html>
"""

    def render_metrics_card(self, data):
        """Render a metrics card with large numbers."""
        content_template = """
        <div class="container">
            <div class="grid grid-{{ columns }}">
                {% for metric in metrics %}
                <div class="metric-card">
                    <div class="metric-value">{{ metric.value }}</div>
                    <div class="metric-label">{{ metric.label }}</div>
                </div>
                {% endfor %}
            </div>
        </div>
        """

        # Determine grid columns based on number of metrics
        columns = min(len(data.get('metrics', [])), 4)

        template = Template(content_template)
        content = template.render(
            metrics=data.get('metrics', []),
            columns=columns
        )

        base_template = Template(self.get_base_html_template())
        return base_template.render(brand=self.brand, content=content, transparent=self.transparent_bg)

    def render_process_flow(self, data):
        """Render a process flow diagram."""
        content_template = """
        <div class="container">
            <div class="process-flow">
                {% for step in steps %}
                <div class="process-step">
                    <div class="heading-lg mb-sm">{{ step.title }}</div>
                    <div class="body-small">{{ step.description }}</div>
                </div>
                {% if not loop.last %}
                <div class="process-arrow">→</div>
                {% endif %}
                {% endfor %}
            </div>
        </div>
        """

        template = Template(content_template)
        content = template.render(steps=data.get('steps', []))

        base_template = Template(self.get_base_html_template())
        return base_template.render(brand=self.brand, content=content, transparent=self.transparent_bg)

    def render_custom(self, html_content):
        """Render custom HTML with Mesh styles applied."""
        base_template = Template(self.get_base_html_template())
        return base_template.render(brand=self.brand, content=html_content)

    def save_html(self, html_content, output_path):
        """Save HTML to file."""
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"✓ Saved HTML: {output_path}")


def html_to_image_playwright(html_path, output_path, width=1920, height=1080, transparent=True):
    """Convert HTML to PNG using Playwright (requires: pip install playwright).

    Args:
        html_path: Path to HTML file
        output_path: Output PNG path
        width: Viewport width
        height: Viewport height
        transparent: Use transparent background (default: True)
    """
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.goto(f'file://{html_path.absolute()}')

            # Inject CSS to scale content if it exceeds viewport height
            page.evaluate('''() => {
                const bodyHeight = document.body.scrollHeight;
                const viewportHeight = window.innerHeight;
                if (bodyHeight > viewportHeight) {
                    const scale = viewportHeight / bodyHeight;
                    document.body.style.transform = `scale(${scale})`;
                    document.body.style.transformOrigin = 'top left';
                    document.body.style.width = `${100 / scale}%`;
                }
            }''')

            page.screenshot(path=str(output_path), full_page=False, omit_background=transparent)
            browser.close()

        print(f"✓ Converted to image: {output_path}")
        return True
    except ImportError:
        print("⚠ Playwright not installed. Install with: pip install playwright && playwright install chromium")
        return False


def html_to_image_selenium(html_path, output_path, width=1920, height=1080):
    """Convert HTML to PNG using Selenium (requires: pip install selenium)."""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument(f'--window-size={width},{height}')

        driver = webdriver.Chrome(options=chrome_options)
        driver.get(f'file://{html_path.absolute()}')
        driver.save_screenshot(str(output_path))
        driver.quit()

        print(f"✓ Converted to image: {output_path}")
        return True
    except ImportError:
        print("⚠ Selenium not installed. Install with: pip install selenium")
        return False
    except Exception as e:
        print(f"⚠ Selenium error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Generate on-brand images from HTML using brand configuration')
    parser.add_argument('--template', choices=['metrics', 'process', 'custom'], default='metrics',
                       help='Template type to use')
    parser.add_argument('--data', type=str, help='YAML data file for template')
    parser.add_argument('--html', type=str, help='Custom HTML file (for custom template)')
    parser.add_argument('--output', type=str, required=True, help='Output image path')
    parser.add_argument('--html-output', type=str, help='Also save HTML to this path')
    parser.add_argument('--width', type=int, default=1920, help='Image width')
    parser.add_argument('--height', type=int, default=1080, help='Image height')
    parser.add_argument('--brand-config', type=str, default='brand_config.yaml',
                       help='Brand configuration file')
    parser.add_argument('--transparent', type=bool, default=True,
                       help='Use transparent background (default: True)')

    args = parser.parse_args()

    # Initialize renderer
    renderer = MeshHTMLRenderer(brand_config_path=args.brand_config, transparent_bg=args.transparent)

    # Generate HTML based on template type
    if args.template == 'metrics':
        if not args.data:
            print("Error: --data required for metrics template")
            return

        with open(args.data, 'r') as f:
            data = yaml.safe_load(f)

        html_content = renderer.render_metrics_card(data)

    elif args.template == 'process':
        if not args.data:
            print("Error: --data required for process template")
            return

        with open(args.data, 'r') as f:
            data = yaml.safe_load(f)

        html_content = renderer.render_process_flow(data)

    elif args.template == 'custom':
        if not args.html:
            print("Error: --html required for custom template")
            return

        with open(args.html, 'r') as f:
            html_content = renderer.render_custom(f.read())

    # Save HTML if requested
    if args.html_output:
        renderer.save_html(html_content, Path(args.html_output))
    else:
        # Save to temp file
        import tempfile
        temp_html = Path(tempfile.gettempdir()) / Path(args.output).with_suffix('.html').name
        renderer.save_html(html_content, temp_html)

    # Convert to image
    html_path = Path(args.html_output) if args.html_output else temp_html
    output_path = Path(args.output)

    # Try Playwright first, then Selenium
    success = html_to_image_playwright(html_path, output_path, args.width, args.height, args.transparent)
    if not success:
        # Selenium doesn't support transparent backgrounds natively
        if args.transparent:
            print("⚠ Selenium doesn't support transparent backgrounds. Trying with white background...")
        success = html_to_image_selenium(html_path, output_path, args.width, args.height)

    if not success:
        print("\n⚠ Could not convert HTML to image. Please install either:")
        print("  - Playwright: pip install playwright && playwright install chromium")
        print("  - Selenium: pip install selenium (requires Chrome/Chromium)")
        print(f"\nHTML saved to: {html_path}")
        print("You can open it in a browser and take a screenshot manually.")


if __name__ == '__main__':
    main()

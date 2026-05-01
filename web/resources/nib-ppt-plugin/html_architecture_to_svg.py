#!/usr/bin/env python3
"""
Convert HTML architecture diagrams to clean SVG with automatic logo embedding.

This script:
1. Renders HTML using Playwright
2. Extracts all element positions, styles, and content
3. Generates clean SVG with:
   - Rectangles for boxes
   - Text elements for labels
   - Paths for arrows
   - Image elements for logos (automatic)
4. Output can be converted to editable PowerPoint shapes
"""

import sys
import json
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright
import html


def extract_layout_info(html_path: str, width: int = 2100, height: int = 1225):
    """
    Extract layout information from rendered HTML.

    Returns a structure containing all elements with their positions, styles, and content.
    """
    html_path = Path(html_path).resolve()

    print(f"Analyzing: {html_path.name}")
    print(f"Viewport: {width}x{height}")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': width, 'height': height})

        # Load HTML file
        page.goto(f'file://{html_path}')

        # Wait for rendering
        page.wait_for_timeout(1000)

        # Extract layout information using JavaScript
        layout_data = page.evaluate("""
            () => {
                const elements = [];

                // Helper to get computed position and style
                function getElementInfo(el) {
                    const rect = el.getBoundingClientRect();
                    const computed = window.getComputedStyle(el);

                    return {
                        tagName: el.tagName.toLowerCase(),
                        className: el.className,
                        id: el.id,
                        text: el.textContent ? el.textContent.trim() : '',
                        x: rect.left,
                        y: rect.top,
                        width: rect.width,
                        height: rect.height,
                        backgroundColor: computed.backgroundColor,
                        color: computed.color,
                        borderColor: computed.borderColor,
                        borderWidth: computed.borderWidth,
                        borderRadius: computed.borderRadius,
                        fontSize: computed.fontSize,
                        fontWeight: computed.fontWeight,
                        fontFamily: computed.fontFamily,
                        textAlign: computed.textAlign,
                        display: computed.display,
                        position: computed.position
                    };
                }

                // Find all boxes/containers (divs with borders or backgrounds)
                document.querySelectorAll('div').forEach(el => {
                    const computed = window.getComputedStyle(el);
                    const hasBorder = computed.borderWidth !== '0px';
                    const hasBackground = computed.backgroundColor !== 'rgba(0, 0, 0, 0)';

                    if (hasBorder || hasBackground) {
                        elements.push({
                            type: 'box',
                            ...getElementInfo(el)
                        });
                    }
                });

                // Find all text elements - capture ALL text labels including title/subtitle
                document.querySelectorAll('h1, h2, p.page-subtitle, .section-label, .box-title, .storage-layer-title, .producer-label, .consumer-box-title, .col-header, .db-label, .stage-title, .security-title, .storage-title, .orch-title, .orch-label, .data-producers-label, .data-consumers-label, .consumer-title, .item-box, .benefits-box, .footer-text, .immuta-text, .iam-badge').forEach(el => {
                    elements.push({
                        type: 'text',
                        ...getElementInfo(el)
                    });
                });

                // Find all images/logos
                document.querySelectorAll('img').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    elements.push({
                        type: 'image',
                        src: el.src,
                        x: rect.left,
                        y: rect.top,
                        width: rect.width,
                        height: rect.height
                    });
                });

                // Find all SVG elements (for database cylinders, arrows, etc.)
                document.querySelectorAll('svg').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    elements.push({
                        type: 'svg',
                        innerHTML: el.innerHTML,
                        x: rect.left,
                        y: rect.top,
                        width: rect.width,
                        height: rect.height,
                        viewBox: el.getAttribute('viewBox')
                    });
                });

                return {
                    elements: elements,
                    documentWidth: document.documentElement.scrollWidth,
                    documentHeight: document.documentElement.scrollHeight,
                    bodyWidth: document.body.offsetWidth,
                    bodyHeight: document.body.offsetHeight
                };
            }
        """)

        browser.close()

    return layout_data


def generate_svg(layout_data, output_path: str):
    """
    Generate clean SVG from layout data.
    """
    output_path = Path(output_path)

    # Use body dimensions if available (respects overflow:hidden)
    # Otherwise fall back to document dimensions
    width = layout_data.get('bodyWidth') or layout_data['documentWidth']
    height = layout_data.get('bodyHeight') or layout_data['documentHeight']

    print(f"Generating SVG: {width}x{height}")

    # Start SVG
    svg_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
        '  <!-- Generated from HTML architecture diagram -->',
        ''
    ]

    # Helper to convert rgba to hex
    def rgba_to_hex(rgba_str):
        try:
            if rgba_str.startswith('rgba'):
                # Extract values
                values = rgba_str.replace('rgba(', '').replace(')', '').split(',')
                # Handle malformed values by taking only the first part before any space
                r = int(values[0].strip().split()[0])
                g = int(values[1].strip().split()[0])
                b = int(values[2].strip().split()[0])
                return f'#{r:02x}{g:02x}{b:02x}'
            elif rgba_str.startswith('rgb'):
                values = rgba_str.replace('rgb(', '').replace(')', '').split(',')
                # Handle malformed values by taking only the first part before any space
                r = int(values[0].strip().split()[0])
                g = int(values[1].strip().split()[0])
                b = int(values[2].strip().split()[0])
                return f'#{r:02x}{g:02x}{b:02x}'
        except (ValueError, IndexError) as e:
            print(f"Warning: Could not parse color '{rgba_str}', using default black")
            return '#000000'
        return rgba_str

    # Sort elements by type for proper layering
    boxes = [el for el in layout_data['elements'] if el['type'] == 'box']
    texts = [el for el in layout_data['elements'] if el['type'] == 'text']
    images = [el for el in layout_data['elements'] if el['type'] == 'image']
    svgs = [el for el in layout_data['elements'] if el['type'] == 'svg']

    print(f"  - {len(boxes)} boxes")
    print(f"  - {len(texts)} text elements")
    print(f"  - {len(images)} images/logos")
    print(f"  - {len(svgs)} SVG elements")

    # Draw boxes first (background layer)
    svg_lines.append('  <!-- Boxes/Containers -->')
    for box in boxes:
        if box['width'] > 1 and box['height'] > 1:  # Skip tiny elements
            # Check for transparency BEFORE converting to hex
            bg_color_raw = box['backgroundColor']
            is_transparent = bg_color_raw == 'rgba(0, 0, 0, 0)' or bg_color_raw == 'transparent'

            bg_color = rgba_to_hex(bg_color_raw)
            border_color = rgba_to_hex(box['borderColor'])
            border_width = box['borderWidth'].replace('px', '') if 'px' in box['borderWidth'] else '0'

            fill = 'none' if is_transparent else bg_color

            svg_lines.append(
                f'  <rect x="{box["x"]:.1f}" y="{box["y"]:.1f}" '
                f'width="{box["width"]:.1f}" height="{box["height"]:.1f}" '
                f'fill="{fill}" stroke="{border_color}" stroke-width="{border_width}"/>'
            )

    # Draw embedded SVG elements (database cylinders, arrows)
    svg_lines.append('')
    svg_lines.append('  <!-- SVG Elements (cylinders, arrows) -->')
    for svg_el in svgs:
        svg_lines.append(f'  <g transform="translate({svg_el["x"]:.1f}, {svg_el["y"]:.1f})">')
        svg_lines.append(f'    <svg width="{svg_el["width"]:.1f}" height="{svg_el["height"]:.1f}" viewBox="{svg_el["viewBox"]}">')
        svg_lines.append(f'      {svg_el["innerHTML"]}')
        svg_lines.append('    </svg>')
        svg_lines.append('  </g>')

    # DON'T draw images in SVG - we'll add them separately to PowerPoint
    # Save image data to JSON for later use
    svg_lines.append('')
    svg_lines.append('  <!-- Images will be added separately to PowerPoint -->')
    svg_lines.append(f'  <!-- {len(images)} images found -->')

    # Draw text last (top layer)
    svg_lines.append('')
    svg_lines.append('  <!-- Text Labels -->')
    for text in texts:
        if text['text'] and text['width'] > 1:  # Skip empty or tiny text
            color = rgba_to_hex(text['color'])
            font_size = text['fontSize'].replace('px', '') if 'px' in text['fontSize'] else '12'
            font_weight = text['fontWeight']

            # Center text in box
            text_x = text['x'] + text['width'] / 2
            text_y = text['y'] + text['height'] / 2

            # Escape XML entities
            escaped_text = html.escape(text["text"])

            svg_lines.append(
                f'  <text x="{text_x:.1f}" y="{text_y:.1f}" '
                f'font-family="Arial, sans-serif" font-size="{font_size}" '
                f'font-weight="{font_weight}" fill="{color}" '
                f'text-anchor="middle" dominant-baseline="middle">'
                f'{escaped_text}</text>'
            )

    # Close SVG
    svg_lines.append('</svg>')

    # Write SVG to file
    svg_content = '\n'.join(svg_lines)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)

    print(f"✓ SVG saved: {output_path}")

    # Save image data to JSON
    import json
    json_path = output_path.with_suffix('.images.json')
    image_data = {
        'svg_width': width,
        'svg_height': height,
        'images': images
    }
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(image_data, f, indent=2)

    print(f"✓ Image data saved: {json_path}")
    print(f"  ({len(images)} images to be added to PowerPoint)")

    return output_path


def main():
    parser = argparse.ArgumentParser(description='Convert HTML architecture to clean SVG')
    parser.add_argument('html_file', help='Input HTML file')
    parser.add_argument('--output', '-o', required=True, help='Output SVG file')
    parser.add_argument('--width', type=int, default=2100, help='Viewport width (default: 2100)')
    parser.add_argument('--height', type=int, default=1225, help='Viewport height (default: 1225)')

    args = parser.parse_args()

    # Extract layout
    layout_data = extract_layout_info(args.html_file, args.width, args.height)

    # Generate SVG
    generate_svg(layout_data, args.output)

    print("\n✓ Conversion complete!")
    print(f"Next step: Convert to PowerPoint with editable shapes:")
    print(f"  python3 scripts/svg_to_pptx_shapes.py {args.output} --output output.pptx")


if __name__ == '__main__':
    main()

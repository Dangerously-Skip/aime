#!/usr/bin/env python3
"""
Convert SVG to editable PowerPoint shapes using svg2pptx.

This creates native PowerPoint shapes that can be edited directly in PowerPoint.
"""

import sys
import argparse
from pathlib import Path
from svg2pptx import svg_to_pptx


def convert_svg_to_pptx(svg_path: str, output_path: str):
    """
    Convert SVG to PowerPoint with editable shapes.

    Args:
        svg_path: Path to SVG file
        output_path: Path to save PPTX
    """
    svg_path = Path(svg_path).resolve()
    output_path = Path(output_path).resolve()

    if not svg_path.exists():
        print(f"Error: SVG file not found: {svg_path}")
        sys.exit(1)

    print(f"Converting SVG to PowerPoint shapes: {svg_path.name}")
    print(f"Output: {output_path}")

    try:
        # Use svg2pptx to convert SVG to PowerPoint shapes
        # This creates native editable shapes
        svg_to_pptx(str(svg_path), str(output_path))
        print(f"✓ Conversion complete!")

    except Exception as e:
        print(f"Error during conversion: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"✓ PowerPoint saved: {output_path}")
    print(f"\nAll shapes are now editable in PowerPoint!")
    print("You can:")
    print("  - Move, resize, and recolor shapes")
    print("  - Edit text directly")
    print("  - Ungroup and modify individual elements")

    return output_path


def main():
    parser = argparse.ArgumentParser(description='Convert SVG to editable PowerPoint shapes')
    parser.add_argument('svg_file', help='Input SVG file')
    parser.add_argument('--output', '-o', required=True, help='Output PPTX file')

    args = parser.parse_args()

    convert_svg_to_pptx(args.svg_file, args.output)


if __name__ == '__main__':
    main()

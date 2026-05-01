#!/usr/bin/env python3
"""
Convert PowerPoint slides to images for AI feedback.

This script converts a PowerPoint presentation to individual slide images
that can be shown to an AI model for visual feedback and iteration.

Usage:
    python3 pptx_to_images.py presentation.pptx --output slides/

Dependencies:
    pip3 install python-pptx Pillow pdf2image
    # Also requires: brew install poppler (for pdf2image)
"""

import argparse
import subprocess
import os
from pathlib import Path
from PIL import Image

def pptx_to_pdf(pptx_path, pdf_path):
    """Convert PowerPoint to PDF."""
    pptx_abs = str(Path(pptx_path).absolute())
    pdf_abs = str(Path(pdf_path).absolute())

    # Try method 1: comtypes (Windows) or unoconv
    try:
        result = subprocess.run(
            ['unoconv', '-f', 'pdf', '-o', pdf_abs, pptx_abs],
            capture_output=True, timeout=120
        )
        if result.returncode == 0 and Path(pdf_abs).exists():
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Try method 2: LibreOffice soffice
    for soffice_path in ['/Applications/LibreOffice.app/Contents/MacOS/soffice',
                         '/usr/local/bin/soffice',
                         '/opt/homebrew/bin/soffice',
                         'soffice']:
        try:
            result = subprocess.run([
                soffice_path,
                '--headless',
                '--convert-to', 'pdf',
                '--outdir', str(Path(pdf_abs).parent),
                pptx_abs
            ], capture_output=True, timeout=120, text=True)

            expected_pdf = Path(pdf_abs).parent / f"{Path(pptx_abs).stem}.pdf"
            if expected_pdf.exists():
                if expected_pdf != Path(pdf_abs):
                    expected_pdf.rename(pdf_abs)
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

    # Try method 3: Python automator for macOS - simple export
    try:
        script = f'''
tell application "Microsoft PowerPoint"
    open POSIX file "{pptx_abs}"
    set theDoc to active presentation
    export theDoc to POSIX file "{pdf_abs}" as save as PDF
    close theDoc saving no
end tell
'''
        result = subprocess.run(
            ['osascript', '-'],
            input=script,
            capture_output=True,
            text=True,
            timeout=60
        )
        if Path(pdf_abs).exists():
            return True
        print(f"  Method 3 failed: {result.stderr.strip()}")
    except Exception as e:
        print(f"  Method 3 exception: {e}")

    # Try method 4: Direct file write without variables
    try:
        result = subprocess.run([
            'osascript',
            '-e', 'tell application "Microsoft PowerPoint"',
            '-e', f'set pptxFile to open POSIX file "{pptx_abs}"',
            '-e', f'export pptxFile to POSIX file "{pdf_abs}" as save as PDF',
            '-e', 'close pptxFile saving no',
            '-e', 'end tell'
        ], capture_output=True, text=True, timeout=60)

        if Path(pdf_abs).exists():
            return True
        print(f"  Method 4 failed: {result.stderr.strip()}")
    except Exception as e:
        print(f"  Method 4 exception: {e}")

    return False

def pdf_to_images(pdf_path, output_dir, dpi=150):
    """Convert PDF to images."""
    try:
        from pdf2image import convert_from_path

        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        images = convert_from_path(pdf_path, dpi=dpi)

        image_paths = []
        for i, image in enumerate(images, 1):
            image_path = output_dir / f"slide-{i:02d}.png"
            image.save(image_path, 'PNG')
            image_paths.append(image_path)
            print(f"  ✓ Slide {i:2d} → {image_path}")

        return image_paths

    except ImportError:
        print("Error: pdf2image not installed. Run: pip3 install pdf2image")
        print("Also requires: brew install poppler")
        return []

def convert_pptx_to_images(pptx_path, output_dir='slides', dpi=150):
    """Convert PowerPoint presentation to individual slide images."""
    pptx_path = Path(pptx_path)
    output_dir = Path(output_dir)

    if not pptx_path.exists():
        print(f"Error: File not found: {pptx_path}")
        return []

    print(f"\nConverting: {pptx_path}")
    print(f"Output directory: {output_dir}\n")

    # Step 1: Convert PPTX to PDF
    pdf_path = pptx_path.with_suffix('.pdf')
    print("Step 1: Converting PPTX to PDF...")

    if pptx_to_pdf(pptx_path, pdf_path):
        print(f"  ✓ Created: {pdf_path}\n")
    else:
        print("  ✗ Could not convert to PDF")
        print("  Please install LibreOffice or use macOS with PowerPoint")
        return []

    # Step 2: Convert PDF to images
    print("Step 2: Converting PDF to images...")
    image_paths = pdf_to_images(pdf_path, output_dir, dpi)

    if image_paths:
        print(f"\n✓ Generated {len(image_paths)} slide images in {output_dir}/")

    # Clean up PDF
    if pdf_path.exists():
        pdf_path.unlink()

    return image_paths

def create_markdown_index(image_paths, output_file='slide_index.md'):
    """Create a markdown index of all slide images."""
    with open(output_file, 'w') as f:
        f.write("# Slide Preview\n\n")

        for i, image_path in enumerate(image_paths, 1):
            rel_path = Path(image_path).name
            f.write(f"## Slide {i}\n\n")
            f.write(f"![Slide {i}]({rel_path})\n\n")
            f.write("---\n\n")

    print(f"✓ Created index: {output_file}")

def main():
    parser = argparse.ArgumentParser(
        description='Convert PowerPoint presentation to images for AI feedback',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s presentation.pptx
  %(prog)s presentation.pptx --output my-slides/ --dpi 200
  %(prog)s presentation.pptx --with-index

Notes:
  - Requires LibreOffice or Microsoft PowerPoint (macOS)
  - Install: pip3 install pdf2image Pillow
  - macOS: brew install poppler
        """
    )

    parser.add_argument('pptx', help='PowerPoint file to convert')
    parser.add_argument('--output', default='slide-previews',
                        help='Output directory for images (default: slide-previews/)')
    parser.add_argument('--dpi', type=int, default=150,
                        help='Image resolution (default: 150)')
    parser.add_argument('--with-index', action='store_true',
                        help='Create markdown index of images')

    args = parser.parse_args()

    # Convert to images
    image_paths = convert_pptx_to_images(args.pptx, args.output, args.dpi)

    # Create index if requested
    if args.with_index and image_paths:
        output_dir = Path(args.output)
        create_markdown_index(
            image_paths,
            output_dir / 'slide_index.md'
        )

if __name__ == '__main__':
    main()

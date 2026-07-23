#!/bin/bash

# PowerPoint Presentation Generation Script
# Automates the end-to-end workflow from markdown to PowerPoint

set -e  # Exit on error

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${SCRIPT_DIR}/brands/nib/pptx_config.yaml"
BRAND_CONFIG="${SCRIPT_DIR}/brands/nib/brand_config.yaml"
VISUALS_DIR="visuals"
SKIP_HTML_GENERATION=false
OPEN_RESULT=true

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS] <markdown_file> <output_pptx>

Generates a PowerPoint presentation from markdown with embedded visuals.

OPTIONS:
    -c, --config FILE           PowerPoint config file (default: pptx_config.yaml)
    -b, --brand-config FILE     Brand config file (default: brand_config.yaml)
    -v, --visuals-dir DIR       Directory containing HTML visuals (default: visuals)
    -s, --skip-html-gen         Skip HTML to image generation step
    -n, --no-open               Don't open the presentation when done
    -h, --help                  Show this help message

EXAMPLES:
    # Generate presentation with default settings
    $0 presentation.md output.pptx

    # Use custom config files
    $0 -c custom_config.yaml -b my_brand.yaml presentation.md output.pptx

    # Skip HTML generation (use existing PNGs)
    $0 --skip-html-gen presentation.md output.pptx

EOF
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--config)
            CONFIG="$2"
            shift 2
            ;;
        -b|--brand-config)
            BRAND_CONFIG="$2"
            shift 2
            ;;
        -v|--visuals-dir)
            VISUALS_DIR="$2"
            shift 2
            ;;
        -s|--skip-html-gen)
            SKIP_HTML_GENERATION=true
            shift
            ;;
        -n|--no-open)
            OPEN_RESULT=false
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo "Unknown option: $1"
            usage
            ;;
        *)
            break
            ;;
    esac
done

# Check required arguments
if [ $# -lt 2 ]; then
    echo "Error: Missing required arguments"
    usage
fi

MARKDOWN_FILE="$1"
OUTPUT_PPTX="$2"

# Validate inputs
if [ ! -f "$MARKDOWN_FILE" ]; then
    echo -e "${YELLOW}Error: Markdown file not found: $MARKDOWN_FILE${NC}"
    exit 1
fi

if [ ! -f "$CONFIG" ]; then
    echo -e "${YELLOW}Error: Config file not found: $CONFIG${NC}"
    exit 1
fi

if [ ! -f "$BRAND_CONFIG" ]; then
    echo -e "${YELLOW}Warning: Brand config not found: $BRAND_CONFIG${NC}"
    echo "Continuing without brand configuration..."
fi

# Step 1: Generate images from HTML (if not skipped)
if [ "$SKIP_HTML_GENERATION" = false ] && [ -d "$VISUALS_DIR" ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Step 1: Generating images from HTML...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    HTML_COUNT=$(find "$VISUALS_DIR" -name "*.html" -type f 2>/dev/null | wc -l)

    if [ "$HTML_COUNT" -eq 0 ]; then
        echo -e "${YELLOW}No HTML files found in $VISUALS_DIR${NC}"
    else
        echo "Found $HTML_COUNT HTML files to convert..."

        for html in "$VISUALS_DIR"/*.html; do
            [ -f "$html" ] || continue
            png="${html%.html}.png"
            filename=$(basename "$html")

            echo -ne "  Converting $filename... "

            if python3 "${SCRIPT_DIR}/html_to_image.py" \
                --template custom \
                --html "$html" \
                --output "$png" \
                --width 1200 \
                --height 700 \
                --brand-config "$BRAND_CONFIG" 2>&1 | grep -q "Converted\|Successfully"; then
                echo -e "${GREEN}✓${NC}"
            else
                echo -e "${YELLOW}✗ (failed)${NC}"
            fi
        done
        echo ""
    fi
else
    if [ "$SKIP_HTML_GENERATION" = true ]; then
        echo -e "${YELLOW}Skipping HTML to image generation (--skip-html-gen)${NC}"
    fi
fi

# Step 2: Convert markdown to PowerPoint
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 2: Converting markdown to PowerPoint...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

python3 "${SCRIPT_DIR}/markdown_to_pptx.py" \
    --config "$CONFIG" \
    --output "$OUTPUT_PPTX" \
    "$MARKDOWN_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Presentation generated successfully!${NC}"
    echo ""

    # Display file info
    if [ -f "$OUTPUT_PPTX" ]; then
        FILE_SIZE=$(ls -lh "$OUTPUT_PPTX" | awk '{print $5}')
        echo -e "${BLUE}Output:${NC} $OUTPUT_PPTX"
        echo -e "${BLUE}Size:${NC} $FILE_SIZE"

        # Count slides (approximate based on file structure)
        # Note: This is a rough estimate, actual slide count may vary
        echo ""

        # Step 3: Open the result
        if [ "$OPEN_RESULT" = true ]; then
            echo -e "${GREEN}Opening presentation...${NC}"
            if command -v open &> /dev/null; then
                open "$OUTPUT_PPTX"
            elif command -v xdg-open &> /dev/null; then
                xdg-open "$OUTPUT_PPTX"
            elif command -v start &> /dev/null; then
                start "$OUTPUT_PPTX"
            else
                echo -e "${YELLOW}Could not auto-open presentation (no open command found)${NC}"
            fi
        fi
    fi
else
    echo -e "${YELLOW}✗ Presentation generation failed${NC}"
    exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Done!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

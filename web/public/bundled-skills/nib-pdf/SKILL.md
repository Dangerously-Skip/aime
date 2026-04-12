# nib-pdf

Generate professional PDF documents from natural language descriptions using Python.

## Usage

Ask Claude to create a PDF document:
- "Create a PDF report summarizing the project status"
- "Generate an invoice PDF for client XYZ"
- "Make a PDF with charts from this data"

## Implementation

Use the `fpdf2` Python library to generate PDFs. Install with `pip install fpdf2` before generating.

### Basic template

```python
from fpdf import FPDF

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.add_page()

# Title
pdf.set_font("Helvetica", "B", 24)
pdf.cell(0, 15, "Document Title", new_x="LMARGIN", new_y="NEXT", align="C")
pdf.ln(5)

# Subtitle / date
pdf.set_font("Helvetica", "", 12)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 8, "Generated on 2026-04-13", new_x="LMARGIN", new_y="NEXT", align="C")
pdf.set_text_color(0, 0, 0)
pdf.ln(10)

# Section heading
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 10, "Section 1: Overview", new_x="LMARGIN", new_y="NEXT")
pdf.ln(3)

# Body text
pdf.set_font("Helvetica", "", 11)
pdf.multi_cell(0, 6, "Body text goes here. Use multi_cell for wrapping paragraphs.")
pdf.ln(5)

# Table
pdf.set_font("Helvetica", "B", 11)
col_widths = [60, 40, 40, 50]
headers = ["Item", "Quantity", "Price", "Total"]
for w, h in zip(col_widths, headers):
    pdf.cell(w, 8, h, border=1, align="C")
pdf.ln()
pdf.set_font("Helvetica", "", 10)
for row in data:
    for w, val in zip(col_widths, row):
        pdf.cell(w, 7, str(val), border=1)
    pdf.ln()

pdf.output("output.pdf")
```

### Tips

- Use `pdf.set_font("Helvetica", ...)` — Helvetica is built-in, no font files needed
- For colored sections: `pdf.set_fill_color(r, g, b)` then `pdf.cell(..., fill=True)`
- For images: `pdf.image("path.png", x, y, w)` — supports PNG and JPEG
- For page numbers: override `footer()` method on FPDF subclass
- Maximum page width for A4: 190mm (210mm minus 10mm margins each side)
- Use `pdf.add_page(orientation="L")` for landscape pages

## Capabilities

- Creates .pdf files with professional layouts
- Supports tables, headers, images, and multi-column layouts
- Color themes and branding
- Page numbers and headers/footers
- Charts via matplotlib saved as PNG then embedded

# PowerPoint Visual Review Checklist

## Why Visual Review Matters

**CRITICAL:** Code review is NOT enough. Many issues only appear when you actually LOOK at the rendered slides:
- Duplicate titles (title in both slide and image)
- Poor space utilization (content too small, excessive white space)
- Timid centered content (should be bold and full-width)
- Text overlaps or truncation
- Rendering artifacts

## Review Process

### Stage 1: HTML in Browser (Before PNG Conversion)
Check raw HTML visualizations for:
- [ ] Text overlaps or floating labels
- [ ] Layout issues or misalignments
- [ ] Content fits within intended dimensions
- [ ] All elements visible (not cut off)

### Stage 2: Standalone PNG Files
After converting HTML → PNG, verify:
- [ ] Rendering quality (no artifacts)
- [ ] Transparent backgrounds preserved
- [ ] Proper dimensions (1200x700 or specified size)
- [ ] Text is sharp and readable
- [ ] Colors match brand guidelines

### Stage 3: PowerPoint Slides (Final Review)
When images are embedded in slides, check:
- [ ] Image positioning (not truncated at bottom)
- [ ] Fits within slide bounds
- [ ] No duplicate titles (slide title vs image title)
- [ ] Proper spacing from slide edges
- [ ] Professional appearance

## Quality Checklist

For each visualization, ask:

### Space Utilization
- [ ] **Bold or timid?** Content should fill available space
- [ ] **Full-width usage?** Not overly centered with excessive margins
- [ ] **Appropriate padding?** 12-24px typically sufficient
- [ ] **No excessive white space?** Content should be substantial

### Visual Impact
- [ ] **Commanding presence?** Large enough to read from back of room
- [ ] **Clear hierarchy?** Important elements stand out
- [ ] **Professional quality?** Board-ready appearance
- [ ] **Brand consistency?** Colors, fonts, spacing match guidelines

### Content Clarity
- [ ] **No duplicate information?** Slide title ≠ image title
- [ ] **Readable text sizes?** Minimum 14-16pt for body text
- [ ] **Clear labels?** All elements properly labeled
- [ ] **Logical flow?** Information organized clearly

### Technical Quality
- [ ] **Transparent backgrounds?** PNG transparency preserved
- [ ] **Consistent branding?** Uses design system colors/fonts
- [ ] **No rendering issues?** Text sharp, images crisp
- [ ] **Proper dimensions?** Matches slide requirements

## Common Issues and Fixes

### Issue: Content too small, excessive white space
**Fix:** Reduce padding (48px → 24px/12px), increase max-width (1400px → 1350px)

### Issue: Duplicate titles
**Fix:** Remove title from HTML if slide already has title

### Issue: Text truncated at bottom
**Fix:** Adjust image height in PowerPoint positioning (top=1.5", height=slide_height-1.8")

### Issue: Poor rendering quality
**Fix:** Use Playwright instead of basic screenshot tools

## Tools

- **HTML → PNG:** `html_to_image.py --template custom --html file.html --output file.png`
- **Visual Review:** `/pptx preview presentation.pptx` or `/pptx review presentation.pptx`
- **Browser Check:** Open HTML files directly in browser before conversion

## Success Criteria

A presentation passes visual review when:
1. ✅ All visualizations are BOLD and COMMANDING (not timid)
2. ✅ No duplicate titles between slides and images
3. ✅ Excellent space utilization (minimal wasted white space)
4. ✅ Professional board-ready quality
5. ✅ Consistent branding throughout
6. ✅ All text readable from distance
7. ✅ Transparent backgrounds preserved
8. ✅ No truncation or rendering artifacts

## Remember

**You MUST actually LOOK at the slides** - not just review code or dimensions. Visual inspection catches issues that specs alone cannot reveal.

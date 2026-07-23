# Fork Review Standards

Review standards define "what good looks like" for your presentations. Fork is **fully configurable** - you can define your own quality criteria based on your context and audience.

## Why Configurable Standards?

Different presentation contexts require different quality standards:

- **Board Presentations**: Formal, commanding, maximum visual impact
- **Internal Documentation**: Clear, informative, efficient
- **Sales Decks**: Persuasive, visually engaging, story-driven
- **Technical Reports**: Detailed, precise, data-focused
- **Training Materials**: Educational, step-by-step, accessible

Fork includes example standards for common contexts, but you should **customize them** to match your organization's needs.

## How Review Standards Work

1. **Define Standards**: Create a markdown file describing your quality criteria
2. **Configure Agent**: Point the visual-reviewer agent to your standards file
3. **Generate & Review**: Fork uses your standards to judge presentation quality
4. **Iterate**: Refine presentations based on feedback

## Directory Structure

```
review-standards/
├── README.md                          # This file
├── board-presentation-standards.md   # Formal executive presentations
├── internal-docs-standards.md        # Internal team documentation
├── sales-deck-standards.md           # Customer-facing sales materials
└── custom-standards-template.md      # Template for creating your own
```

## Configuration Points

### 1. Quality Criteria

Define what makes a "good" presentation in your context:

**Example - Board Presentation**:
- Bold, commanding visuals (90-95% width utilization)
- Professional board-ready quality
- Minimum 14-16pt text for readability from distance
- Conservative, formal design

**Example - Internal Documentation**:
- Clear, efficient information density
- 70-85% width utilization (allows for notes/annotations)
- Minimum 12pt text
- Practical, functional design

### 2. Review Stages

Customize which stages to review based on your workflow:

**Standard 3-Stage Review**:
1. HTML in browser (before PNG conversion)
2. Standalone PNG files (after conversion)
3. PowerPoint slides (final review)

**Fast 2-Stage Review** (for quick iterations):
1. Standalone PNG files
2. PowerPoint slides

**Comprehensive 4-Stage Review** (for critical presentations):
1. HTML in browser
2. PNG files
3. PowerPoint slides
4. Projected on screen (actual presentation environment)

### 3. Success Metrics

Define measurable criteria for "passing" quality:

**Configurable Metrics**:
- Space utilization percentage (e.g., 90-95% vs 70-85%)
- Minimum text sizes (e.g., 14pt vs 12pt vs 10pt)
- Maximum slides per minute (pacing)
- Contrast ratios (WCAG AA vs AAA)
- Brand compliance requirements

### 4. Quality Ratings

Customize rating levels and what they mean:

**Default Scale**:
- **Excellent**: Ready for high-stakes presentation
- **Good**: Minor improvements would help
- **Needs Work**: Significant issues to address
- **Unacceptable**: Major rework required

**Custom Scale Example**:
- **Production Ready**: Approved for external use
- **Review Ready**: Ready for stakeholder review
- **Draft**: Needs iteration
- **Prototype**: Early concept only

## Using Custom Standards

### Method 1: Use Existing Standards

```bash
# Generate presentation
./generate_presentation.sh deck.md output.pptx

# Convert to previews
python3 pptx_to_images.py output.pptx --output slide-previews/

# In visual-reviewer agent configuration, reference the appropriate standard:
# .claude/agents/visual-reviewer.md -> update to read your chosen standard
```

### Method 2: Create Custom Standards

1. **Copy the template**:
   ```bash
   cp review-standards/custom-standards-template.md review-standards/my-company-standards.md
   ```

2. **Customize criteria**:
   - Edit space utilization requirements
   - Define your quality metrics
   - Set success criteria
   - Add company-specific guidelines

3. **Update agent configuration**:
   Edit `.claude/agents/visual-reviewer.md` to reference your standards file:
   ```markdown
   1. **Read the checklist** - Always start by reading review-standards/my-company-standards.md
   ```

### Method 3: Context-Specific Standards

Create multiple standards for different contexts:

```
review-standards/
├── board-presentation-standards.md      # For executives
├── customer-demo-standards.md           # For sales
├── internal-training-standards.md       # For training
└── technical-documentation-standards.md # For engineers
```

Point the agent to the appropriate standard based on the presentation type.

## Example: Board vs Internal Standards Comparison

| Criterion | Board Presentation | Internal Documentation |
|-----------|-------------------|------------------------|
| **Space Usage** | 90-95% width | 70-85% width |
| **Text Size** | 14-16pt minimum | 12-14pt minimum |
| **Formality** | Highly formal | Practical/functional |
| **Visual Impact** | Commanding, bold | Clear, efficient |
| **Pacing** | Slow (2-3 min/slide) | Fast (30-60 sec/slide) |
| **Brand Compliance** | Strict adherence | Flexible interpretation |

## Customization Examples

### Example 1: Relaxed Internal Standards

```markdown
### Space Utilization
- [ ] **Efficient usage?** 70-85% width is fine (allows for notes)
- [ ] **Appropriate padding?** 24-48px for comfortable reading
- [ ] **Balanced whitespace?** Content vs breathing room

### Text Size
- [ ] **Readable on laptop?** Minimum 12pt for body text
- [ ] **Headers clear?** 18pt+ for section headers
```

### Example 2: High-Stakes Sales Deck

```markdown
### Persuasive Impact
- [ ] **Compelling visuals?** Images that tell a story
- [ ] **Clear value proposition?** Benefit-focused messaging
- [ ] **Call-to-action visible?** Next steps obvious
- [ ] **Customer-centric?** "You" language vs "We" language

### Brand Excellence
- [ ] **Perfect brand compliance?** Zero deviations from brand guide
- [ ] **Premium appearance?** High-end, polished visuals
- [ ] **Consistent quality?** Every slide magazine-worthy
```

### Example 3: Technical Documentation

```markdown
### Technical Accuracy
- [ ] **Data precise?** Numbers verified and sourced
- [ ] **Diagrams accurate?** Technical details correct
- [ ] **Code readable?** Syntax highlighting, proper formatting
- [ ] **References included?** Links to docs and resources

### Information Density
- [ ] **Detailed enough?** Sufficient technical depth
- [ ] **Scannable?** Headers, bullets, clear structure
- [ ] **Progressive disclosure?** Complex info broken into steps
```

## Best Practices for Custom Standards

### 1. Start with an Example

Don't create standards from scratch. Copy an existing standard that's close to your needs and modify it.

### 2. Be Specific and Measurable

**Good**: "Minimum 14pt for body text"
**Bad**: "Text should be readable"

**Good**: "90-95% width utilization"
**Bad**: "Use most of the space"

### 3. Include Context

Explain **why** a standard exists:
```markdown
- [ ] **Minimum 14pt text?** Board members view from 10+ feet away
```

### 4. Provide Fixes

For each criterion, include how to fix common issues:
```markdown
### Issue: Text too small for distant viewing
**Fix:** Increase font size to 14pt minimum, use bold for emphasis
```

### 5. Version Your Standards

As your organization's needs evolve, update your standards:
```markdown
# My Company Presentation Standards
**Version**: 2.1
**Last Updated**: 2025-01-05
**Changes**: Increased minimum text size from 12pt to 14pt based on feedback
```

## Integration with Fork Workflow

```bash
# 1. Choose or create review standards
cp review-standards/board-presentation-standards.md review-standards/my-standards.md
vim review-standards/my-standards.md  # Customize

# 2. Update visual-reviewer agent
vim .claude/agents/visual-reviewer.md  # Point to my-standards.md

# 3. Generate presentation
./generate_presentation.sh deck.md output.pptx

# 4. Create previews for review
python3 pptx_to_images.py output.pptx --output slide-previews/

# 5. Review with your custom standards
# The visual-reviewer agent uses your my-standards.md file

# 6. Iterate based on feedback
vim deck.md  # Fix issues
./generate_presentation.sh deck.md output.pptx  # Regenerate

# 7. Repeat until quality passes
```

## Contributing Standards

If you create review standards for a specific domain (healthcare, finance, education, etc.), consider sharing them as examples for others to build from.

---

**Remember**: There is no one-size-fits-all standard. Fork is designed to be flexible - define what "good" means for your context and audience.

**Fork** - Configurable quality standards for every situation.

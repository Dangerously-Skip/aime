# Fork Installation Guide

**Warning**: You're about to wire up something dangerously powerful.

## System Requirements

- **Python 3.8+** (the power source)
- **pip3** (the circuit breaker)
- **macOS, Linux, or Windows** (any electrical grid)
- **PowerPoint 2016+** (for viewing results)

## Installation Steps

### 1. Clone the Repository

```bash
cd ~/Code
git clone <fork-repo-url> fork
cd fork
```

### 2. Install Python Dependencies

```bash
# Install the safety equipment
pip3 install python-pptx pyyaml playwright jinja2

# Verify installation
python3 -c "import pptx; import yaml; import playwright; print('✓ Dependencies installed')"
```

### 3. Install Playwright Browser

```bash
# Install Chromium (the rendering engine)
playwright install chromium

# Verify installation
playwright --version
```

### 4. Set Up Configuration

```bash
# Copy example configs
cp pptx_config.example.yaml pptx_config.yaml
cp brand_config.example.yaml brand_config.yaml

# Optional: Customize for your brand
vim brand_config.yaml
```

### 5. Make Scripts Executable

```bash
chmod +x generate_presentation.sh
chmod +x html_to_image.py
chmod +x markdown_to_pptx.py
```

### 6. Test Installation

```bash
# Create test presentation
cat > test.md << 'EOF'
## SLIDE title: Fork Installation Test
<!-- subtitle: It Works! -->

---

## SLIDE content: Success

If you can see this slide, Fork is properly wired up and ready to:
- Generate presentations
- Convert HTML to images
- Handle dangerous PowerPoint operations

**Status**: ⚡ Operational
EOF

# Generate test presentation
./generate_presentation.sh test.md test-output.pptx

# If it opens in PowerPoint, you're good to go!
```

## Optional: Global Installation

To make Fork available from anywhere on your system:

### Option 1: Add to PATH

```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export PATH="$HOME/Code/fork:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Now you can run from anywhere
cd ~/Documents
generate_presentation.sh my-deck.md my-deck.pptx
```

### Option 2: Create Symlinks

```bash
# Link to /usr/local/bin
sudo ln -s ~/Code/fork/generate_presentation.sh /usr/local/bin/fork-generate
sudo ln -s ~/Code/fork/html_to_image.py /usr/local/bin/fork-html2img

# Use globally
cd ~/Documents
fork-generate my-deck.md my-deck.pptx
```

### Option 3: Claude Code Integration

Create a CLAUDE.md in your global config:

```bash
# Create global instructions
cat > ~/.claude/CLAUDE.md << 'EOF'
# Fork Integration

When users request PowerPoint generation, use Fork:
- **Location**: ~/Code/fork
- **Command**: ~/Code/fork/generate_presentation.sh input.md output.pptx
- **Docs**: ~/Code/fork/README.md

Fork handles all dangerous PowerPoint operations automatically.
EOF
```

Now agents automatically know about Fork in all projects.

## Verification

Run this checklist to ensure everything works:

```bash
# ✓ Python dependencies
python3 -c "import pptx, yaml, playwright; print('✓ Python packages')"

# ✓ Playwright browser
playwright --version

# ✓ Scripts executable
ls -l generate_presentation.sh | grep -q 'x' && echo '✓ Scripts executable'

# ✓ Brand config exists
[ -d brands/default ] && echo '✓ brands/default/'
[ -f brands/default/pptx_config.yaml ] && echo '✓ pptx_config.yaml'
[ -f brands/default/brand_config.yaml ] && echo '✓ brand_config.yaml'

# ✓ Directories exist
[ -d visuals ] && echo '✓ visuals/'

# ✓ Can generate test presentation
./generate_presentation.sh test.md test.pptx && echo '✓ Generation works'
```

All checks should pass before using Fork in production.

## Troubleshooting Installation

### "pip3: command not found"

Install Python 3:

```bash
# macOS
brew install python3

# Ubuntu/Debian
sudo apt-get install python3-pip

# Windows
# Download from python.org
```

### "playwright: command not found"

Install Playwright:

```bash
pip3 install playwright
playwright install chromium
```

### "Permission denied" when running scripts

Make scripts executable:

```bash
chmod +x generate_presentation.sh
chmod +x html_to_image.py
chmod +x markdown_to_pptx.py
```

### "No module named 'pptx'"

Install python-pptx:

```bash
pip3 install python-pptx
```

### "Template not found"

Create a templates directory and add a PowerPoint template:

```bash
# The default default brand is pre-configured in brands/default/
# To add your own brand:
mkdir -p brands/my-brand
cp /path/to/your/template.pptx brands/my-brand/
cp pptx_config.example.yaml brands/my-brand/pptx_config.yaml
cp brand_config.example.yaml brands/my-brand/brand_config.yaml

# Update the configs with your template path and layout indices
```

### macOS: "PowerPoint can't open the file"

The file was generated successfully but macOS security is blocking it:

```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine output.pptx
```

### Linux: No PowerPoint

Install LibreOffice Impress:

```bash
sudo apt-get install libreoffice-impress

# Open presentations with:
libreoffice --impress presentation.pptx
```

## Upgrading

### Update Dependencies

```bash
pip3 install --upgrade python-pptx pyyaml playwright jinja2
playwright install chromium
```

### Update Fork

```bash
cd ~/Code/fork
git pull origin main

# Re-verify installation
./generate_presentation.sh test.md test.pptx
```

## Uninstallation

If you need to remove Fork (but why would you?):

```bash
# Remove Fork directory
rm -rf ~/Code/fork

# Remove Python packages (if not used elsewhere)
pip3 uninstall python-pptx pyyaml playwright jinja2

# Remove global symlinks (if created)
sudo rm /usr/local/bin/fork-generate
sudo rm /usr/local/bin/fork-html2img

# Remove global config (if created)
rm ~/.claude/CLAUDE.md  # Only if it only contains Fork instructions
```

## Next Steps

Once installed:

1. **Read QUICKSTART.md** - 60-second guide to first presentation
2. **Read README.md** - Full documentation with all features
3. **Check examples/** - Sample presentations to learn from
4. **Customize brand_config.yaml** - Make it match your brand
5. **Fork around** - Generate your first dangerous presentation

---

**Fork** - Because life's too short to manually format slides.

⚡ **Installed? Now go fork around and find out.**

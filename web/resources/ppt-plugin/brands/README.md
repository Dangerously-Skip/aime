# Brand Configurations

Each subdirectory contains a complete brand package for generating presentations:

```
brands/
├── default/                          # default Health Funds (default)
│   ├── brand_config.yaml         # Colors, typography, spacing
│   ├── pptx_config.yaml          # Template layout mappings
│   └── Presentation_Template.pptx # PowerPoint template
└── your-brand/                   # Create your own
    ├── brand_config.yaml
    ├── pptx_config.yaml
    └── your-template.pptx
```

## Adding a New Brand

1. Create a directory: `brands/my-company/`
2. Copy the example configs from the repo root:
   - `cp pptx_config.example.yaml brands/my-company/pptx_config.yaml`
   - `cp brand_config.example.yaml brands/my-company/brand_config.yaml`
3. Add your PowerPoint template: `brands/my-company/template.pptx`
4. Edit the configs to match your brand and template layout indices
5. Generate with:
   ```bash
   ./generate_presentation.sh \
       -c brands/my-company/pptx_config.yaml \
       -b brands/my-company/brand_config.yaml \
       input.md output.pptx
   ```

## Finding Layout Indices

Open your template in PowerPoint and check the slide master layouts. The index is the zero-based position of each layout in the master. Update `pptx_config.yaml` accordingly.

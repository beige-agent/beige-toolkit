# markdown-pdf Plugin

Convert markdown files to PDF with full feature support.

## Quick Start

```bash
# Basic conversion
markdown-pdf generate <markdownPath> <pdfPath>

# With custom options
markdown-pdf generate <markdownPath> <pdfPath> --options '<json>'
```

## Usage

### Basic Conversion

Convert a markdown file to PDF:

```bash
markdown-pdf generate /workspace/report.md /workspace/report.pdf
```

### Custom Page Format

Use different paper sizes:

```bash
markdown-pdf generate /workspace/report.md /workspace/report.pdf \
  --options '{"format": "Letter"}'
```

Supported formats: A4, Letter, Legal, Tabloid, Ledger

### Custom Margins

Adjust page margins:

```bash
markdown-pdf generate /workspace/report.md /workspace/report.pdf \
  --options '{"margins": {"top": "1cm", "bottom": "1cm", "left": "1.5cm", "right": "1.5cm"}}'
```

### With Header and Footer

Add page numbers and metadata:

```bash
markdown-pdf generate /workspace/report.md /workspace/report.pdf \
  --options '{"displayHeaderFooter": true}'
```

## Path Resolution

The plugin automatically handles path translation:

- **Sandbox paths**: `/workspace/file.md` → host workspace directory
- **Relative paths**: Resolved against current working directory
- **Absolute paths**: Used as-is (if outside `/workspace`)

### Examples

```bash
# Sandbox path
markdown-pdf generate /workspace/docs/README.md /workspace/docs/README.pdf

# Relative path (from current directory)
markdown-pdf generate notes.md notes.pdf

# Absolute path
markdown-pdf generate /home/user/document.md /home/user/document.pdf
```

## Image Support

Local images are automatically embedded:

```markdown
# markdown.md
![Local Image](./images/photo.png)
![Remote Image](https://example.com/image.jpg)
```

Both local and remote images work out of the box.

## Table Support

Tables are rendered with proper formatting:

```markdown
| Column 1 | Column 2 |
|----------|----------|
| Data 1   | Data 2   |
| Data 3   | Data 4   |
```

## Configuration

Configure default settings in `plugins.markdown-pdf.config`:

```yaml
format: A4
margins:
  top: 2cm
  right: 2cm
  bottom: 2cm
  left: 2cm
displayHeaderFooter: false
printBackground: true
```

## Common Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | string | A4 | Paper format (A4, Letter, Legal, etc.) |
| `margins` | object | 2cm each | Page margins (top, right, bottom, left) |
| `displayHeaderFooter` | boolean | false | Show header/footer with page numbers |
| `printBackground` | boolean | true | Include background graphics and colors |

## Tips

- Use relative paths for images in markdown files
- Large images may increase PDF file size
- Hyperlinks remain clickable in the PDF
- Code blocks are rendered with syntax highlighting
- Tables preserve formatting from markdown

## Troubleshooting

### Image Not Found

If images aren't showing:
- Check that image paths are relative to the markdown file
- Ensure images exist at the specified paths
- Use absolute paths if relative paths fail

### PDF Generation Fails

If conversion fails:
- Check that the markdown file is valid
- Verify write permissions for the output PDF path
- Ensure puppeteer can run headless Chrome on your system

# markdown-pdf Plugin

Convert markdown files to PDF with support for hyperlinks, tables, and local images.

## Features

- ✅ Full markdown support (headers, lists, bold, italic, code blocks, etc.)
- ✅ Hyperlink preservation
- ✅ Table rendering
- ✅ Local image support (with workspace path resolution)
- ✅ Customizable page format and margins
- ✅ Background graphics support

## Commands

```bash
# Convert markdown to PDF
markdown-pdf generate <markdownPath> <pdfPath>

# Convert with custom options
markdown-pdf generate <markdownPath> <pdfPath> --options '{"format": "Letter", "margins": {"top": "1cm"}}'
```

## Path Resolution

The plugin automatically resolves workspace paths:

- `/workspace/file.md` → resolves to the actual host workspace directory
- Relative paths → resolved against current working directory
- Absolute paths outside `/workspace` → used as-is

## Configuration

Default configuration in `plugins.markdown-pdf.config`:

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

## Examples

```bash
# Convert a simple markdown file
markdown-pdf generate /workspace/README.md /workspace/README.pdf

# Convert with custom options
markdown-pdf generate /workspace/docs/report.md /workspace/docs/report.pdf \
  --options '{"format": "Letter", "margins": {"top": "1cm", "bottom": "1cm"}}'

# Convert a markdown file with images
markdown-pdf generate /workspace/travel-notes/japan.md /workspace/travel-notes/japan.pdf
```

## Dependencies

- **markdown-pdf**: Core PDF generation library
- **marked**: Markdown parser (for preprocessing)
- **puppeteer**: Headless Chrome for PDF rendering

## Notes

- Local images are automatically embedded in the PDF
- Hyperlinks remain clickable in the PDF
- Tables are rendered with proper formatting
- Code blocks are rendered with syntax highlighting

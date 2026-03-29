# image tool

The `image` tool analyzes local image files using a vision-capable LLM.

## When to use

- You need to understand the content of an image file on disk
- Your current model does not support vision input

## Commands

```
image analyze <path>
image analyze <path> --prompt "your question"
```

## analyze — read and describe an image

Provide an absolute or relative path to a JPEG, PNG, GIF, or WebP file.

```
image analyze /path/to/screenshot.png
image analyze ./diagram.jpg --prompt "What does this architecture diagram show?"
image analyze ~/Downloads/chart.png --prompt "Summarize the data in this chart"
```

The tool returns a plain-text description. Use `--prompt` to ask a focused question instead of getting a general description.

## Notes

- Supported image formats: JPEG, PNG, GIF, WebP
- The tool uses configured Beige providers — no separate API key is required
- OAuth-authenticated providers (e.g. Anthropic via browser login) work automatically

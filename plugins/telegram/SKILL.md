# Telegram Plugin

You have access to Telegram messaging via the `telegram` tool.

## Path Resolution

All file paths for `sendPhoto`, `sendAlbum`, and `sendDocument` are resolved automatically:

- `/workspace/photo.jpg` → rebased to the real host workspace root
- `media/outbound/report.pdf` → resolved relative to the workspace root
- `/absolute/host/path/file.jpg` → used as-is
- `https://example.com/img.jpg` → sent by URL, no local file I/O

## Sending Messages

```bash
telegram sendMessage <chatId> <text>
telegram sendMessage <chatId> --thread <threadId> <text>
```

Messages longer than 4096 characters are split automatically.

```bash
telegram sendMessage 123456789 "Build completed successfully!"
telegram sendMessage -1001234567890 --thread 42 "Deployment finished."
```

## Sending a Single Photo

Accepts JPEG, PNG, WebP, or GIF. **Do not use for SVGs** — use `sendDocument` instead.

```bash
telegram sendPhoto <chatId> <photoPath> [caption]
telegram sendPhoto <chatId> --thread <threadId> <photoPath> [caption]
```

```bash
telegram sendPhoto 123456789 media/outbound/chart.png "Q1 results"
telegram sendPhoto 123456789 /workspace/screenshot.jpg
telegram sendPhoto 123456789 https://example.com/banner.jpg "Check this out"
```

## Sending Multiple Photos as an Album

Use `sendAlbum` to send several photos as a **single grouped album** — the user sees a grid of images in one message, not 20 separate ones.

```bash
telegram sendAlbum <chatId> <path1> <path2> [...pathN] [--caption <text>]
telegram sendAlbum <chatId> --thread <threadId> <path1> <path2> [...pathN] [--caption <text>]
```

- Albums larger than 10 photos are **automatically split** into consecutive batches of ≤10.
- `--caption` applies to the first photo only (Telegram's restriction). Put it **after** all paths.
- Each file must be a raster image (same rules as `sendPhoto`).

```bash
# 3-photo album
telegram sendAlbum 123456789 photo1.jpg photo2.jpg photo3.jpg

# With caption
telegram sendAlbum 123456789 photo1.jpg photo2.jpg photo3.jpg --caption "Holiday snaps 🌴"

# 12 photos → auto-split into two batches (10 + 2)
telegram sendAlbum 123456789 p01.jpg p02.jpg p03.jpg p04.jpg p05.jpg p06.jpg p07.jpg p08.jpg p09.jpg p10.jpg p11.jpg p12.jpg

# To a forum thread
telegram sendAlbum -1001234567890 --thread 5 img1.png img2.png --caption "Results"
```

## Sending a File (Document)

Use for any non-photo file: PDFs, ZIPs, SVGs, spreadsheets, etc. Delivered as a file attachment without Telegram processing the content.

```bash
telegram sendDocument <chatId> <filePath> [caption]
telegram sendDocument <chatId> --thread <threadId> <filePath> [caption]
```

```bash
telegram sendDocument 123456789 media/outbound/report.pdf "Monthly report"
telegram sendDocument 123456789 /workspace/export.zip
telegram sendDocument 123456789 https://example.com/data.csv "Latest dataset"
```

## Notes

- `chatId` is a numeric Telegram chat ID — positive for users, negative for groups/channels.
- `--thread` is only relevant in Telegram groups with forum topics enabled.
- For `sendPhoto` and `sendAlbum`: files must be real raster images. SVG files saved with a `.jpg` extension will be rejected with a clear error — send them via `sendDocument` instead.

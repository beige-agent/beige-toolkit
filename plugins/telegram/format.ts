/**
 * Telegram MarkdownV2 formatting and entity-aware message splitting.
 *
 * This module converts LLM Markdown output into Telegram MarkdownV2 and splits
 * long messages into chunks that never break mid-entity. Every chunk is
 * guaranteed to have balanced formatting — open entities are closed at chunk
 * boundaries and reopened in the next chunk.
 *
 * Exported:
 *   - markdownToTelegramV2(text)         → MarkdownV2 string
 *   - splitFormattedMessage(text, limit)  → string[]  (entity-aware chunks)
 *   - formatAndSplit(text, limit)         → string[]  (convert + split in one call)
 *
 * Internal helpers (exported for testing):
 *   - escapeV2(s)        — escape MarkdownV2 special chars in plain text
 *   - escapeV2Code(s)    — escape chars inside code spans / blocks
 */

// ── Escaping helpers ─────────────────────────────────────────────────────────

/**
 * Escape all characters that have special meaning in Telegram MarkdownV2
 * outside entities.
 * Reference: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeV2(s: string): string {
  // eslint-disable-next-line no-useless-escape
  return s.replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}

/**
 * Escape characters that must be escaped inside MarkdownV2 code spans and
 * fenced code blocks. Inside code only backtick and backslash need escaping.
 */
export function escapeV2Code(s: string): string {
  return s.replace(/[`\\]/g, "\\$&");
}

// ── Markdown → MarkdownV2 conversion ─────────────────────────────────────────

/**
 * Convert LLM Markdown output to Telegram MarkdownV2.
 *
 * This is a **line-based, stateful parser** rather than a regex-only approach.
 * It processes the input line by line, tracking code-block state, so that:
 *
 *  - Fenced code blocks are always properly opened and closed (even if the LLM
 *    forgot the closing ```). This prevents the "Can't find end of PreCode
 *    entity" error that plagued pure-regex approaches.
 *  - Inline formatting (bold, italic, strikethrough, inline code, links) is
 *    parsed per-line with paired-delimiter matching, so unmatched markers are
 *    escaped as literals rather than creating dangling MarkdownV2 entities.
 *  - Headings, blockquotes, horizontal rules, and list items are handled at
 *    line level.
 *
 * Safety guarantee: every formatting marker we emit is properly paired.
 * Anything we can't confidently parse stays as escaped literal text.
 */
export function markdownToTelegramV2(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Code block fence detection ──────────────────────────────────────
    // Match opening/closing fences: ``` optionally followed by a language tag
    const fenceMatch = line.match(/^(`{3,})(\w*)\s*$/);

    if (fenceMatch) {
      if (!inCodeBlock) {
        // Opening fence
        inCodeBlock = true;
        codeLang = fenceMatch[2] || "";
        codeLines = [];
        continue;
      } else {
        // Closing fence — emit the code block
        emitCodeBlock(out, codeLang, codeLines);
        inCodeBlock = false;
        codeLang = "";
        codeLines = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // ── Block-level elements (outside code blocks) ──────────────────────

    // Horizontal rules: ---, ***, ___
    if (/^[\s]*[-*_]{3,}[\s]*$/.test(line)) {
      out.push("—————");
      continue;
    }

    // Headings → bold
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      out.push(`**${convertInlineFormatting(headingMatch[1])}**`);
      continue;
    }

    // Blockquotes: > text → >text (V2 blockquote)
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      out.push(`>${convertInlineFormatting(bqMatch[1])}`);
      continue;
    }

    // Unordered list items: - item or * item → • item
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      const indent = ulMatch[1];
      out.push(`${escapeV2(indent)}• ${convertInlineFormatting(ulMatch[2])}`);
      continue;
    }

    // Ordered list items: 1. item → 1\. item (escaped dot)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const indent = olMatch[1];
      out.push(
        `${escapeV2(indent)}${olMatch[2]}\\. ${convertInlineFormatting(olMatch[3])}`
      );
      continue;
    }

    // Regular line — convert inline formatting
    out.push(convertInlineFormatting(line));
  }

  // ── Handle unclosed code block (LLM forgot closing ```) ───────────────
  // Close it gracefully so we never produce an unclosed PreCode entity.
  if (inCodeBlock) {
    emitCodeBlock(out, codeLang, codeLines);
  }

  return out.join("\n");
}

/** Emit a properly fenced code block into the output array. */
function emitCodeBlock(out: string[], lang: string, lines: string[]): void {
  const safe = escapeV2Code(lines.join("\n"));
  out.push(
    lang ? `\`\`\`${lang}\n${safe}\n\`\`\`` : `\`\`\`\n${safe}\n\`\`\``
  );
}

// ── Inline formatting ────────────────────────────────────────────────────────

/**
 * Parse and convert inline Markdown formatting within a single line to
 * MarkdownV2.
 *
 * Uses a left-to-right scan to find paired delimiters. Unmatched delimiters
 * are escaped as literals — this guarantees every entity we emit is properly
 * closed.
 *
 * Supported: **bold**, *italic*, ~~strikethrough~~, `inline code`,
 *            [text](url), __bold__ (→ **), _italic_
 */
function convertInlineFormatting(line: string): string {
  // Tokenise the line: code spans and links first (suppress inner formatting),
  // then plain text runs.
  const tokens: Array<{ type: "text" | "code" | "link"; value: string }> = [];
  let pos = 0;

  while (pos < line.length) {
    // ── Inline code: `...` ────────────────────────────────────────────
    if (line[pos] === "`") {
      const end = line.indexOf("`", pos + 1);
      if (end !== -1) {
        tokens.push({ type: "code", value: line.slice(pos + 1, end) });
        pos = end + 1;
        continue;
      }
    }

    // ── Link: [text](url) ─────────────────────────────────────────────
    if (line[pos] === "[") {
      const closeBracket = line.indexOf("]", pos + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === "(") {
        // Find matching closing paren, accounting for nested parens in URLs
        let depth = 1;
        let j = closeBracket + 2;
        while (j < line.length && depth > 0) {
          if (line[j] === "(") depth++;
          else if (line[j] === ")") depth--;
          j++;
        }
        if (depth === 0) {
          const closeParen = j - 1;
          const linkText = line.slice(pos + 1, closeBracket);
          const url = line.slice(closeBracket + 2, closeParen);
          tokens.push({
            type: "link",
            value: `[${escapeV2(linkText)}](${url.replace(/[)\\]/g, "\\$&")})`,
          });
          pos = closeParen + 1;
          continue;
        }
      }
    }

    // ── Plain text character ──────────────────────────────────────────
    const ch = line[pos];
    const last = tokens[tokens.length - 1];
    if (last && last.type === "text") {
      last.value += ch;
    } else {
      tokens.push({ type: "text", value: ch });
    }
    pos++;
  }

  // Process each token
  const parts: string[] = [];
  for (const tok of tokens) {
    if (tok.type === "code") {
      parts.push(`\`${escapeV2Code(tok.value)}\``);
    } else if (tok.type === "link") {
      parts.push(tok.value);
    } else {
      parts.push(formatTextRun(tok.value));
    }
  }
  return parts.join("");
}

/**
 * Format a plain text run (no code spans or links) with bold, italic, and
 * strikethrough. Uses paired-delimiter matching to ensure every opened
 * entity is closed. Unmatched delimiters are escaped.
 */
function formatTextRun(text: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < text.length) {
    // ── Bold+Italic: ***text*** ─────────────────────────────────────
    if (text.startsWith("***", i)) {
      const end = text.indexOf("***", i + 3);
      if (end !== -1) {
        result.push(`***${escapeV2(text.slice(i + 3, end))}***`);
        i = end + 3;
        continue;
      }
    }

    // ── Bold: **text** ──────────────────────────────────────────────
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        result.push(`**${escapeV2(text.slice(i + 2, end))}**`);
        i = end + 2;
        continue;
      }
    }

    // ── Bold: __text__ (convert to ** for consistency) ──────────────
    if (text.startsWith("__", i)) {
      const end = text.indexOf("__", i + 2);
      if (end !== -1) {
        result.push(`**${escapeV2(text.slice(i + 2, end))}**`);
        i = end + 2;
        continue;
      }
    }

    // ── Strikethrough: ~~text~~ → ~text~ (V2 uses single tilde) ────
    if (text.startsWith("~~", i)) {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        result.push(`~${escapeV2(text.slice(i + 2, end))}~`);
        i = end + 2;
        continue;
      }
    }

    // ── Italic: *text* (single star, not adjacent to *) ────────────
    if (
      text[i] === "*" &&
      (i === 0 || text[i - 1] !== "*") &&
      (i + 1 >= text.length || text[i + 1] !== "*")
    ) {
      let end = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (
          text[j] === "*" &&
          (j + 1 >= text.length || text[j + 1] !== "*") &&
          (j === 0 || text[j - 1] !== "*")
        ) {
          end = j;
          break;
        }
      }
      if (end !== -1) {
        result.push(`_${escapeV2(text.slice(i + 1, end))}_`);
        i = end + 1;
        continue;
      }
    }

    // ── Italic: _text_ (word-boundary underscore) ──────────────────
    if (
      text[i] === "_" &&
      (i === 0 || text[i - 1] !== "_") &&
      i + 1 < text.length &&
      text[i + 1] !== "_" &&
      (i === 0 || !/[a-zA-Z0-9]/.test(text[i - 1]))
    ) {
      let end = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (
          text[j] === "_" &&
          (j + 1 >= text.length || text[j + 1] !== "_") &&
          (j === 0 || text[j - 1] !== "_")
        ) {
          if (j + 1 >= text.length || !/[a-zA-Z0-9]/.test(text[j + 1])) {
            end = j;
            break;
          }
        }
      }
      if (end !== -1) {
        result.push(`_${escapeV2(text.slice(i + 1, end))}_`);
        i = end + 1;
        continue;
      }
    }

    // ── Plain character — escape it ─────────────────────────────────
    result.push(escapeV2(text[i]));
    i++;
  }

  return result.join("");
}

// ── Entity-aware message splitting ───────────────────────────────────────────

/**
 * Formatting entities we track across chunk boundaries.
 *
 * When we split a message mid-entity, the current chunk gets closing markers
 * appended and the next chunk gets opening markers prepended — so every chunk
 * is self-contained valid MarkdownV2.
 */
type InlineEntity = "bold" | "italic" | "strikethrough";

interface FormattingState {
  /** Stack of currently open inline entities (outermost first). */
  inlineStack: InlineEntity[];
  /** Whether we're inside a fenced code block. */
  inCodeBlock: boolean;
  /** Language tag for the current code block (empty string if none). */
  codeLang: string;
}

/** MarkdownV2 opening markers for each inline entity type. */
const ENTITY_OPEN: Record<InlineEntity, string> = {
  bold: "**",
  italic: "_",
  strikethrough: "~",
};

/** MarkdownV2 closing markers (same as opening for these types). */
const ENTITY_CLOSE: Record<InlineEntity, string> = {
  bold: "**",
  italic: "_",
  strikethrough: "~",
};

/**
 * Generate the closing sequence for all currently open entities.
 * Entities are closed in reverse order (innermost first).
 */
function closeEntities(state: FormattingState): string {
  let closing = "";
  // Close inline entities innermost-first
  for (let i = state.inlineStack.length - 1; i >= 0; i--) {
    closing += ENTITY_CLOSE[state.inlineStack[i]];
  }
  // Close code block if open
  if (state.inCodeBlock) {
    closing += "\n```";
  }
  return closing;
}

/**
 * Generate the opening sequence to restore all currently open entities.
 * Entities are reopened in original order (outermost first).
 */
function reopenEntities(state: FormattingState): string {
  let opening = "";
  // Reopen code block if it was open
  if (state.inCodeBlock) {
    opening += state.codeLang ? `\`\`\`${state.codeLang}\n` : "```\n";
  }
  // Reopen inline entities outermost-first
  for (const entity of state.inlineStack) {
    opening += ENTITY_OPEN[entity];
  }
  return opening;
}

/**
 * Scan a line of MarkdownV2 output and update the formatting state.
 *
 * This tracks which entities are open so we know what to close/reopen at
 * chunk boundaries. It handles escaped characters (prefixed with \) by
 * skipping them — they're literals, not formatting markers.
 */
function updateStateForLine(line: string, state: FormattingState): void {
  // Code block fences: if we see ``` at the start of a line, toggle state.
  // In the MarkdownV2 output from markdownToTelegramV2, code blocks always
  // start with ```lang\n or ```\n and end with \n```.
  const trimmed = line.trim();
  if (trimmed.startsWith("```")) {
    if (!state.inCodeBlock) {
      state.inCodeBlock = true;
      // Extract language tag: ```typescript → "typescript"
      state.codeLang = trimmed.slice(3).trim();
    } else {
      state.inCodeBlock = false;
      state.codeLang = "";
    }
    return;
  }

  // Inside code blocks, no inline formatting is active
  if (state.inCodeBlock) return;

  // Scan the line character by character for inline formatting markers
  let i = 0;
  while (i < line.length) {
    // Skip escaped characters
    if (line[i] === "\\" && i + 1 < line.length) {
      i += 2;
      continue;
    }

    // Bold: **
    if (line[i] === "*" && line[i + 1] === "*" && line[i + 2] !== "*") {
      const topInline = state.inlineStack[state.inlineStack.length - 1];
      if (topInline === "bold") {
        state.inlineStack.pop();
      } else {
        state.inlineStack.push("bold");
      }
      i += 2;
      continue;
    }

    // Bold+Italic: *** — push both bold and italic
    if (line[i] === "*" && line[i + 1] === "*" && line[i + 2] === "*") {
      const topInline = state.inlineStack[state.inlineStack.length - 1];
      const secondInline = state.inlineStack[state.inlineStack.length - 2];
      if (topInline === "italic" && secondInline === "bold") {
        state.inlineStack.pop(); // italic
        state.inlineStack.pop(); // bold
      } else {
        state.inlineStack.push("bold");
        state.inlineStack.push("italic");
      }
      i += 3;
      continue;
    }

    // Strikethrough: ~ (single in V2)
    if (line[i] === "~") {
      const topInline = state.inlineStack[state.inlineStack.length - 1];
      if (topInline === "strikethrough") {
        state.inlineStack.pop();
      } else {
        state.inlineStack.push("strikethrough");
      }
      i += 1;
      continue;
    }

    // Italic: _ (single in V2)
    if (line[i] === "_") {
      const topInline = state.inlineStack[state.inlineStack.length - 1];
      if (topInline === "italic") {
        state.inlineStack.pop();
      } else {
        state.inlineStack.push("italic");
      }
      i += 1;
      continue;
    }

    // Inline code: ` — skip to closing backtick (no nesting inside code spans)
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end !== -1) {
        i = end + 1;
      } else {
        i += 1;
      }
      continue;
    }

    i++;
  }
}

/**
 * Split a MarkdownV2-formatted message into chunks that respect Telegram's
 * max message length, while ensuring every chunk has balanced formatting.
 *
 * Strategy:
 *  1. Reserve 200 characters of headroom (for closing/reopening markers).
 *  2. Split at newline boundaries. When the accumulated chunk approaches
 *     `maxLength - 200`, find the nearest newline to split at.
 *  3. At each split point, close all open entities (code blocks, bold,
 *     italic, etc.) at the end of the current chunk.
 *  4. Reopen them at the start of the next chunk.
 *
 * This guarantees that every chunk is valid MarkdownV2 with no unclosed
 * entities, and that formatting that spans the boundary appears in both
 * the ending and the beginning of adjacent chunks.
 *
 * @param text      MarkdownV2-formatted text (output of markdownToTelegramV2)
 * @param maxLength Telegram's per-message character limit (default 4096)
 * @returns         Array of self-contained MarkdownV2 chunks
 */
export function splitFormattedMessage(
  text: string,
  maxLength: number = 4096
): string[] {
  if (text.length <= maxLength) return [text];

  // Reserve space for closing/reopening entity markers at boundaries.
  // Cap the headroom so it never exceeds half the limit (for small maxLength in tests).
  const HEADROOM = Math.min(200, Math.floor(maxLength / 4));
  const softLimit = maxLength - HEADROOM;

  const lines = text.split("\n");
  const chunks: string[] = [];

  // Formatting state tracks what's open across the entire message
  const state: FormattingState = {
    inlineStack: [],
    inCodeBlock: false,
    codeLang: "",
  };

  // Current chunk being built
  let currentLines: string[] = [];
  let currentLength = 0;

  // The prefix to prepend to the next chunk (reopening markers from previous split)
  let reopenPrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Would adding this line (plus newline separator) exceed the soft limit?
    const addedLength = currentLength === 0 ? line.length : line.length + 1;

    if (currentLength + addedLength > softLimit && currentLines.length > 0) {
      // ── Split here: flush the current chunk ───────────────────────
      let chunk = currentLines.join("\n");

      // Close any open entities
      const closing = closeEntities(state);
      chunk += closing;

      // Verify the chunk fits within the hard limit (it should, given the
      // 200-char headroom, but clamp as a safety net)
      if (chunk.length > maxLength) {
        chunks.push(chunk.slice(0, maxLength));
      } else {
        chunks.push(chunk);
      }

      // Prepare the reopening prefix for the next chunk
      reopenPrefix = reopenEntities(state);

      // Reset accumulator
      currentLines = [];
      currentLength = 0;
    }

    // If a single line alone exceeds the soft limit, hard-split it
    // into pieces that fit. Each piece gets close/reopen treatment.
    if (line.length > softLimit) {
      // Flush any accumulated content first
      if (currentLines.length > 0) {
        let chunk = currentLines.join("\n");
        const closing = closeEntities(state);
        chunk += closing;
        chunks.push(chunk.length > maxLength ? chunk.slice(0, maxLength) : chunk);
        reopenPrefix = reopenEntities(state);
        currentLines = [];
        currentLength = 0;
      }

      // Hard-split the oversized line
      let remaining = line;
      while (remaining.length > 0) {
        const prefix = reopenPrefix || "";
        const availableSpace = Math.max(1, softLimit - prefix.length);
        const piece = remaining.slice(0, availableSpace);
        remaining = remaining.slice(availableSpace);

        // Update state for the piece we're about to emit
        updateStateForLine(piece, state);

        let chunk = prefix + piece;
        if (remaining.length > 0) {
          // More pieces to come — close entities
          chunk += closeEntities(state);
          reopenPrefix = reopenEntities(state);
        } else {
          // Last piece — don't close, let the normal flow handle it
          reopenPrefix = "";
          // Add as the start of the next accumulator instead of emitting
          currentLines.push(chunk);
          currentLength = chunk.length;
          break;
        }
        chunks.push(chunk.length > maxLength ? chunk.slice(0, maxLength) : chunk);
      }
      continue;
    }

    // If this is the first line of a new chunk and we have a reopen prefix
    if (currentLines.length === 0 && reopenPrefix) {
      currentLines.push(reopenPrefix + line);
      currentLength = reopenPrefix.length + line.length;
      reopenPrefix = "";
    } else {
      currentLines.push(line);
      currentLength += addedLength;
    }

    // Update formatting state for this line
    updateStateForLine(line, state);
  }

  // Flush remaining content
  if (currentLines.length > 0) {
    let chunk = currentLines.join("\n");
    // Close any entities that are still open at the end of the message
    // (shouldn't happen if markdownToTelegramV2 did its job, but be safe)
    const closing = closeEntities(state);
    if (closing) {
      chunk += closing;
    }
    chunks.push(chunk);
  }

  return chunks;
}

// ── Convenience: convert and split in one call ───────────────────────────────

/**
 * Convert LLM Markdown to MarkdownV2 and split into Telegram-safe chunks.
 *
 * This is the main entry point for preparing agent responses for Telegram.
 * Equivalent to `splitFormattedMessage(markdownToTelegramV2(text), maxLength)`.
 *
 * @param text      Raw Markdown from the LLM
 * @param maxLength Telegram's per-message character limit (default 4096)
 * @returns         Array of self-contained MarkdownV2 chunks
 */
export function formatAndSplit(
  text: string,
  maxLength: number = 4096
): string[] {
  const v2 = markdownToTelegramV2(text || "(empty response)");
  return splitFormattedMessage(v2, maxLength);
}

// ── HTML helpers (for bot command messages) ───────────────────────────────────

/**
 * Escape the three characters that are special in Telegram HTML mode.
 * Used only for hand-crafted bot command messages (status, compact, etc.).
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Plain text splitting (fallback) ──────────────────────────────────────────

/**
 * Simple line-based splitter for plain text (no entity tracking needed).
 * Used as fallback when MarkdownV2 formatting fails.
 */
export function splitPlainText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current);
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        current = "";
      } else {
        current = line;
      }
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── UI helpers ───────────────────────────────────────────────────────────────

/**
 * Render a compact ASCII progress bar for context window usage.
 * e.g. "▓▓▓▓▓▓░░░░" for ~60% used.
 */
export function contextBar(used: number, total: number, width = 10): string {
  const ratio = Math.min(used / total, 1);
  const filled = Math.round(ratio * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Format a tool call into a compact human-readable label for verbose mode
 * notifications.
 */
export function formatToolCall(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case "exec": {
      const cmd = String(params.command ?? "");
      return `exec: ${cmd.length > 80 ? cmd.slice(0, 77) + "…" : cmd}`;
    }
    case "read":
      return `read: ${String(params.path ?? "")}`;
    case "write": {
      const path = String(params.path ?? "");
      const bytes = params.bytes != null ? ` (${params.bytes} bytes)` : "";
      return `write: ${path}${bytes}`;
    }
    case "patch":
      return `patch: ${String(params.path ?? "")}`;
    default: {
      // Some tools (e.g. git) use purely positional/flag args with no
      // key=value pairs, so the parsed params object is empty. Fall back
      // to the raw _args array injected by the runner for a useful label.
      const kv = Object.fromEntries(
        Object.entries(params).filter(([k]) => k !== "_args")
      );
      if (Object.keys(kv).length > 0) {
        return `${toolName}: ${JSON.stringify(kv).slice(0, 80)}`;
      }
      const rawArgs = Array.isArray(params._args) ? params._args : [];
      const cmd = rawArgs.join(" ");
      return `${toolName}: ${cmd.length > 80 ? cmd.slice(0, 77) + "…" : cmd || "(no args)"}`;
    }
  }
}

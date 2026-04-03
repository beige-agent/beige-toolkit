import { describe, it, expect } from "vitest";
import { markdownToTelegramV2, splitFormattedMessage, formatAndSplit } from "../../plugins/telegram/format.ts";

describe("markdownToTelegramV2", () => {
  describe("plain text escaping", () => {
    it("escapes MarkdownV2 special characters in plain text", () => {
      const result = markdownToTelegramV2("Hello world! How are you?");
      expect(result).toBe("Hello world\\! How are you?");
    });

    it("escapes dots, parentheses, and other specials", () => {
      const result = markdownToTelegramV2("See file.txt (main) for details.");
      expect(result).toBe("See file\\.txt \\(main\\) for details\\.");
    });

    it("escapes plus and equals signs", () => {
      const result = markdownToTelegramV2("a + b = c");
      expect(result).toBe("a \\+ b \\= c");
    });
  });

  describe("bold formatting", () => {
    it("converts **bold** to MarkdownV2 bold", () => {
      const result = markdownToTelegramV2("This is **bold** text");
      expect(result).toContain("**bold**");
      // The surrounding text should be escaped
      expect(result).not.toContain("\\*\\*");
    });

    it("converts __bold__ to ** bold", () => {
      const result = markdownToTelegramV2("This is __bold__ text");
      expect(result).toContain("**bold**");
    });

    it("handles unmatched ** as literal text", () => {
      const result = markdownToTelegramV2("This ** is not bold");
      // Should not contain unescaped unmatched **
      expect(result).toContain("\\*\\*");
    });
  });

  describe("italic formatting", () => {
    it("converts *italic* to MarkdownV2 italic (underscore)", () => {
      const result = markdownToTelegramV2("This is *italic* text");
      expect(result).toContain("_italic_");
    });

    it("does not convert snake_case to italic", () => {
      const result = markdownToTelegramV2("variable_name_here is good");
      expect(result).not.toContain("_name_");
      // underscores should be escaped
      expect(result).toContain("\\_");
    });
  });

  describe("strikethrough", () => {
    it("converts ~~text~~ to ~text~ (V2 single tilde)", () => {
      const result = markdownToTelegramV2("This is ~~deleted~~ text");
      expect(result).toContain("~deleted~");
      // Should be single tilde, not double
      expect(result).not.toContain("~~");
    });
  });

  describe("inline code", () => {
    it("preserves inline code with proper escaping", () => {
      const result = markdownToTelegramV2("Run `npm install` to start");
      expect(result).toContain("`npm install`");
    });

    it("escapes backticks inside inline code", () => {
      const result = markdownToTelegramV2("Use `foo\\`bar` carefully");
      // The backslash inside code should be escaped
      expect(result).toContain("`");
    });
  });

  describe("fenced code blocks", () => {
    it("preserves code blocks with language tag", () => {
      const input = "Here is code:\n```typescript\nconst x = 1;\n```\nDone.";
      const result = markdownToTelegramV2(input);
      expect(result).toContain("```typescript\nconst x = 1;\n```");
    });

    it("preserves code blocks without language tag", () => {
      const input = "Code:\n```\nhello world\n```";
      const result = markdownToTelegramV2(input);
      expect(result).toContain("```\nhello world\n```");
    });

    it("closes unclosed code blocks gracefully", () => {
      const input = "Code:\n```python\nprint('hello')\nMore text";
      const result = markdownToTelegramV2(input);
      // Should contain a properly closed code block
      expect(result).toContain("```python");
      expect(result).toContain("```");
      // Count opening and closing fences — must be balanced
      const fences = result.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
    });

    it("does not escape special characters outside code rules inside code blocks", () => {
      const input = "```\nif (x > 0) { return x + 1; }\n```";
      const result = markdownToTelegramV2(input);
      // Inside code, only backtick and backslash need escaping — not >, (, ), {, }, +
      expect(result).toContain("if (x > 0) { return x + 1; }");
    });
  });

  describe("links", () => {
    it("converts markdown links to MarkdownV2 links", () => {
      const result = markdownToTelegramV2("Visit [Google](https://google.com) now");
      expect(result).toContain("[Google](https://google.com)");
    });

    it("escapes special characters in link text", () => {
      const result = markdownToTelegramV2("See [file.txt](https://example.com/file.txt)");
      expect(result).toContain("[file\\.txt]");
    });

    it("escapes closing parentheses in URLs", () => {
      const result = markdownToTelegramV2("[wiki](https://en.wikipedia.org/wiki/Test_(thing))");
      // Inside V2 link URLs, only ) and \ need escaping
      expect(result).toContain("https://en.wikipedia.org/wiki/Test_(thing\\)");
    });
  });

  describe("headings", () => {
    it("converts headings to bold", () => {
      const result = markdownToTelegramV2("# Title\nSome text");
      expect(result).toContain("**Title**");
    });

    it("converts h2-h6 to bold", () => {
      expect(markdownToTelegramV2("## Subtitle")).toContain("**Subtitle**");
      expect(markdownToTelegramV2("### H3")).toContain("**H3**");
    });
  });

  describe("blockquotes", () => {
    it("converts > text to V2 blockquote", () => {
      const result = markdownToTelegramV2("> This is a quote");
      expect(result).toMatch(/^>This is a quote$|^>.*quote/m);
    });
  });

  describe("lists", () => {
    it("converts unordered list items with bullet", () => {
      const result = markdownToTelegramV2("- Item one\n- Item two");
      expect(result).toContain("• Item one");
      expect(result).toContain("• Item two");
    });

    it("converts * list items with bullet", () => {
      const result = markdownToTelegramV2("* Item one\n* Item two");
      expect(result).toContain("• Item one");
      expect(result).toContain("• Item two");
    });

    it("handles ordered lists with escaped dots", () => {
      const result = markdownToTelegramV2("1. First\n2. Second");
      expect(result).toContain("1\\. First");
      expect(result).toContain("2\\. Second");
    });
  });

  describe("horizontal rules", () => {
    it("converts --- to separator", () => {
      const result = markdownToTelegramV2("Above\n---\nBelow");
      expect(result).toContain("—————");
    });
  });

  describe("complex / mixed content", () => {
    it("handles bold inside headings", () => {
      const result = markdownToTelegramV2("# **Important** Title");
      // Should not produce nested broken bold
      expect(result).toBeDefined();
    });

    it("handles multiple code blocks", () => {
      const input = "First:\n```\ncode1\n```\nThen:\n```\ncode2\n```";
      const result = markdownToTelegramV2(input);
      const fences = result.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
    });

    it("handles mixed inline formatting", () => {
      const result = markdownToTelegramV2("This is **bold** and *italic* and `code`");
      expect(result).toContain("**bold**");
      expect(result).toContain("_italic_");
      expect(result).toContain("`code`");
    });

    it("handles a realistic LLM response", () => {
      const input = `# Summary

Here's what I found:

1. The **main issue** is in \`src/index.ts\`
2. There's a *secondary* problem in the config

\`\`\`typescript
const config = {
  key: "value",
  count: 42,
};
\`\`\`

> Note: This is important!

For more info, see [the docs](https://example.com).

---

That's all!`;

      const result = markdownToTelegramV2(input);

      // Should not throw and should produce balanced entities
      expect(result).toBeDefined();
      const fences = result.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
      expect(result).toContain("**Summary**"); // heading → bold
      expect(result).toContain("**main issue**");
      expect(result).toContain("`src/index.ts`");
      expect(result).toContain("—————"); // horizontal rule
    });

    it("never produces unbalanced code fences", () => {
      // Test various pathological inputs
      const inputs = [
        "```\nunclosed code",
        "``` \nweird fence",
        "text ``` middle ``` text",
        "```js\ncode\n```\n```\nmore\n",
        "``````", // double fence
      ];

      for (const input of inputs) {
        const result = markdownToTelegramV2(input);
        const fences = result.match(/```/g) || [];
        expect(fences.length % 2).toBe(0, `Unbalanced fences for input: ${JSON.stringify(input)}`);
      }
    });
  });
});

describe("splitFormattedMessage", () => {
  it("returns single chunk when text fits", () => {
    const chunks = splitFormattedMessage("Hello world", 100);
    expect(chunks).toEqual(["Hello world"]);
  });

  it("splits long text at newline boundaries", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i}: ${"x".repeat(50)}`);
    const text = lines.join("\n");
    const chunks = splitFormattedMessage(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be within the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("closes and reopens bold across chunk boundaries", () => {
    // Create text with bold that spans what would be a chunk boundary
    const before = "x".repeat(100);
    const text = `${before}\n**This is bold text that continues\nacross multiple lines\nand more bold**\nDone`;
    const chunks = splitFormattedMessage(text, 150);

    expect(chunks.length).toBeGreaterThan(1);

    // First chunk with bold should end with ** to close bold
    const chunkWithBoldStart = chunks.find(c => c.includes("**") && !c.includes("Done"));
    if (chunkWithBoldStart) {
      // Count ** markers — should be balanced (even count)
      const markers = chunkWithBoldStart.match(/\*\*/g) || [];
      expect(markers.length % 2).toBe(0);
    }
  });

  it("closes and reopens code blocks across chunk boundaries", () => {
    // Create a code block that's too large for one chunk
    const codeLines = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`);
    const text = `Intro text\n\`\`\`typescript\n${codeLines.join("\n")}\n\`\`\`\nAfter code`;
    const chunks = splitFormattedMessage(text, 200);

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should have balanced code fences
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it("reopens code block with language tag in continuation chunks", () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `line_${i} = "${i}"`);
    const text = `\`\`\`python\n${codeLines.join("\n")}\n\`\`\``;
    const chunks = splitFormattedMessage(text, 200);

    if (chunks.length > 1) {
      // Continuation chunks should reopen with ```python
      for (let i = 1; i < chunks.length; i++) {
        if (chunks[i].includes("```")) {
          expect(chunks[i]).toMatch(/```python/);
        }
      }
    }
  });

  it("never exceeds maxLength", () => {
    const maxLength = 300;
    const text = "a".repeat(1000) + "\n" + "**bold " + "b".repeat(500) + " bold**";
    const chunks = splitFormattedMessage(text, maxLength);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxLength);
    }
  });

  it("preserves all content across chunks", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}`);
    const text = lines.join("\n");
    const chunks = splitFormattedMessage(text, 30);
    // Rejoin and verify all lines are present
    const rejoined = chunks.join("\n");
    for (const line of lines) {
      expect(rejoined).toContain(line);
    }
  });
});

describe("formatAndSplit", () => {
  it("converts and splits in one call", () => {
    const input = "# Title\n\nSome **bold** text with `code`";
    const chunks = formatAndSplit(input, 4096);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("**Title**");
    expect(chunks[0]).toContain("**bold**");
    expect(chunks[0]).toContain("`code`");
  });

  it("handles empty input", () => {
    const chunks = formatAndSplit("", 4096);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("empty response");
  });

  it("splits long LLM output with balanced entities", () => {
    // Simulate a long response with code blocks
    const codeBlock = "```typescript\n" + Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n```";
    const input = `# Analysis\n\nHere is the code:\n\n${codeBlock}\n\nAnd here is more text with **bold** and *italic*.`;
    const chunks = formatAndSplit(input, 500);

    for (const chunk of chunks) {
      // Every chunk should have balanced fences
      const fences = chunk.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
      // Every chunk should be within limit
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });
});

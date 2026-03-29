import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PluginContext,
  PluginRegistrar,
  PluginTool,
  ChannelAdapter,
  PluginSkill,
  HookName,
  HookHandler,
} from "@matthias-hausberger/beige";

// We can't import grammy in tests without a real token, so we mock the module
const handlers: Record<string, Function> = {};
const mockBotApi = {
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  deleteMyCommands: vi.fn().mockResolvedValue(undefined),
  setMyCommands: vi.fn().mockResolvedValue(undefined),
  sendPhoto: vi.fn().mockResolvedValue({ message_id: 1 }),
  setMessageReaction: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  getFile: vi.fn().mockResolvedValue({ file_path: "photos/file_123.jpg" }),
};
const mockBotInstance = {
  use: vi.fn(),
  command: vi.fn((cmd: string, handler: Function) => {
    handlers[`command:${cmd}`] = handler;
  }),
  on: vi.fn((event: string, handler: Function) => {
    handlers[`on:${event}`] = handler;
  }),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  api: mockBotApi,
  _handlers: handlers,
};

// Mock fs and https so downloadMediaToInbound doesn't hit real I/O
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => {
      const events: Record<string, Function[]> = {};
      return {
        on: (event: string, cb: Function) => {
          if (!events[event]) events[event] = [];
          events[event].push(cb);
        },
        close: (cb?: Function) => cb?.(),
        _trigger: (event: string, ...args: unknown[]) => {
          events[event]?.forEach((cb) => cb(...args));
        },
      };
    }),
  };
});

vi.mock("https", () => ({
  get: vi.fn((_url: string, cb: Function) => {
    // Return a fake response stream that immediately ends
    const res = {
      pipe: vi.fn((dest: any) => {
        // Trigger the "finish" event on the write stream
        setTimeout(() => dest._trigger("finish"), 0);
      }),
      on: vi.fn(),
    };
    cb(res);
    return { on: vi.fn() };
  }),
}));

vi.mock("grammy", () => {
  // Must use a function() (not arrow) so it can be called with `new`
  function MockBot() {
    return mockBotInstance;
  }
  return {
    Bot: MockBot,
  };
});

// Import after mocking
import { createPlugin } from "../../plugins/telegram/index.ts";

function createMockPluginContext(): PluginContext {
  const metadata: Record<string, Record<string, unknown>> = {};

  return {
    prompt: vi.fn().mockResolvedValue("Test response"),
    promptStreaming: vi.fn().mockResolvedValue("Streamed response"),
    newSession: vi.fn().mockResolvedValue(undefined),
    getSessionSettings: vi.fn().mockReturnValue({}),
    updateSessionSettings: vi.fn(),
    setSessionMetadata: vi.fn((sessionKey: string, key: string, value: unknown) => {
      if (!metadata[sessionKey]) metadata[sessionKey] = {};
      metadata[sessionKey][key] = value;
    }),
    getSessionMetadata: vi.fn((sessionKey: string, key: string) => {
      return metadata[sessionKey]?.[key];
    }),
    invokeTool: vi.fn().mockResolvedValue({ output: "", exitCode: 0 }),
    config: {},
    agentNames: ["assistant"],
    getChannel: vi.fn(),
    getRegisteredTools: vi.fn().mockReturnValue([]),
    createSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    getSessionEntry: vi.fn(),
    compactSession: vi.fn().mockResolvedValue({ tokensBefore: 1000 }),
    isSessionActive: vi.fn().mockReturnValue(false),
    abortSession: vi.fn().mockResolvedValue(undefined),
    disposeSession: vi.fn().mockResolvedValue(undefined),
    steerSession: vi.fn().mockResolvedValue(undefined),
    getSessionModel: vi.fn(),
    getSessionUsage: vi.fn(),
    getModel: vi.fn(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    dataDir: "/fake/.beige/data/telegram",
    persistSessionModel: vi.fn(),
  };
}

function createMockRegistrar(): PluginRegistrar & {
  tools: PluginTool[];
  channels: ChannelAdapter[];
  skills: PluginSkill[];
  hooks: Array<{ name: HookName; handler: HookHandler }>;
} {
  const tools: PluginTool[] = [];
  const channels: ChannelAdapter[] = [];
  const skills: PluginSkill[] = [];
  const hooks: Array<{ name: HookName; handler: HookHandler }> = [];

  return {
    tools,
    channels,
    skills,
    hooks,
    tool: (t) => tools.push(t),
    channel: (c) => channels.push(c),
    hook: ((name: HookName, handler: HookHandler) => hooks.push({ name, handler })) as any,
    skill: (s) => skills.push(s),
  };
}

const validConfig = {
  token: "fake-token",
  allowedUsers: [123456],
  agentMapping: { default: "assistant" },
  defaults: { verbose: false, streaming: true },
};

describe("Telegram Plugin", () => {
  let ctx: PluginContext;
  let reg: ReturnType<typeof createMockRegistrar>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockPluginContext();
    reg = createMockRegistrar();
  });

  describe("createPlugin", () => {
    it("creates a plugin instance with valid config", () => {
      const plugin = createPlugin(validConfig, ctx);
      expect(plugin).toBeDefined();
      expect(plugin.register).toBeTypeOf("function");
      expect(plugin.start).toBeTypeOf("function");
      expect(plugin.stop).toBeTypeOf("function");
    });

    it("throws on missing token", () => {
      expect(() =>
        createPlugin({ ...validConfig, token: "" }, ctx)
      ).toThrow("token");
    });

    it("throws on missing allowedUsers", () => {
      expect(() =>
        createPlugin({ ...validConfig, allowedUsers: [] }, ctx)
      ).toThrow("allowedUsers");
    });

    it("throws on missing agentMapping.default", () => {
      expect(() =>
        createPlugin({ ...validConfig, agentMapping: {} }, ctx)
      ).toThrow("agentMapping.default");
    });
  });

  describe("register()", () => {
    it("registers a channel adapter", () => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);

      expect(reg.channels).toHaveLength(1);
      expect(reg.channels[0].supportsMessaging()).toBe(true);
    });

    it("registers the telegram tool", () => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);

      expect(reg.tools).toHaveLength(1);
      expect(reg.tools[0].name).toBe("telegram");
      expect(reg.tools[0].description).toContain("Send messages");
    });

    it("does not register hooks or skills", () => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);

      expect(reg.hooks).toHaveLength(0);
      expect(reg.skills).toHaveLength(0);
    });
  });

  describe("telegram tool", () => {
    let tool: PluginTool;

    beforeEach(() => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);
      tool = reg.tools[0];
    });

    it("shows usage on empty args", async () => {
      const result = await tool.handler([], undefined);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Usage");
    });

    it("shows usage on unknown subcommand", async () => {
      const result = await tool.handler(["unknown"], undefined);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Unknown subcommand");
    });

    it("sendMessage with insufficient args", async () => {
      const result = await tool.handler(["sendMessage", "123"], undefined);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Usage");
    });

    it("sendMessage sends a message", async () => {
      const result = await tool.handler(
        ["sendMessage", "123456", "Hello", "world"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Message sent");
      expect(result.output).toContain("123456");
    });

    it("sendMessage with --thread option", async () => {
      const result = await tool.handler(
        ["sendMessage", "123456", "--thread", "42", "Thread", "message"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("thread 42");
    });

    it("sendMessage with empty text after --thread", async () => {
      const result = await tool.handler(
        ["sendMessage", "123456", "--thread", "42", ""],
        undefined
      );
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("empty");
    });

    it("accepts send as alias for sendMessage", async () => {
      const result = await tool.handler(
        ["send", "123456", "Hello"],
        undefined
      );
      expect(result.exitCode).toBe(0);
    });

    it("accepts send_message as alias for sendMessage", async () => {
      const result = await tool.handler(
        ["send_message", "123456", "Hello"],
        undefined
      );
      expect(result.exitCode).toBe(0);
    });

    it("sendPhoto with insufficient args", async () => {
      const result = await tool.handler(["sendPhoto", "123"], undefined);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Usage");
    });

    it("sendPhoto sends a photo", async () => {
      const result = await tool.handler(
        ["sendPhoto", "123456", "/path/to/photo.jpg"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Photo sent");
      expect(result.output).toContain("123456");
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "/path/to/photo.jpg",
        expect.objectContaining({})
      );
    });

    it("sendPhoto with caption", async () => {
      const result = await tool.handler(
        ["sendPhoto", "123456", "/path/to/photo.jpg", "Check", "this", "out!"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "/path/to/photo.jpg",
        expect.objectContaining({ caption: "Check this out!" })
      );
    });

    it("sendPhoto with --thread option", async () => {
      const result = await tool.handler(
        ["sendPhoto", "123456", "--thread", "42", "/path/to/photo.jpg"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("thread 42");
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "/path/to/photo.jpg",
        expect.objectContaining({ message_thread_id: 42 })
      );
    });

    it("sendPhoto with --thread and caption", async () => {
      const result = await tool.handler(
        ["sendPhoto", "123456", "--thread", "42", "/path/to/photo.jpg", "Beautiful photo"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "/path/to/photo.jpg",
        expect.objectContaining({
          message_thread_id: 42,
          caption: "Beautiful photo"
        })
      );
    });

    it("sendPhoto accepts send_photo as alias", async () => {
      const result = await tool.handler(
        ["send_photo", "123456", "/path/to/photo.jpg"],
        undefined
      );
      expect(result.exitCode).toBe(0);
    });

    it("sendPhoto with URL", async () => {
      const result = await tool.handler(
        ["sendPhoto", "123456", "https://example.com/photo.jpg"],
        undefined
      );
      expect(result.exitCode).toBe(0);
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "https://example.com/photo.jpg",
        expect.objectContaining({})
      );
    });
  });

  describe("channel adapter", () => {
    let adapter: ChannelAdapter;

    beforeEach(() => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);
      adapter = reg.channels[0];
    });

    it("supports messaging", () => {
      expect(adapter.supportsMessaging()).toBe(true);
    });

    it("sends a message", async () => {
      await adapter.sendMessage("123", undefined, "Hello");
      // The mock bot.api.sendMessage is called internally
      
      expect(mockBotApi.sendMessage).toHaveBeenCalledWith(
        "123",
        "Hello",
        expect.objectContaining({})
      );
    });

    it("sends a message with thread", async () => {
      await adapter.sendMessage("123", "42", "Hello");
      
      expect(mockBotApi.sendMessage).toHaveBeenCalledWith(
        "123",
        "Hello",
        expect.objectContaining({ message_thread_id: 42 })
      );
    });

    it("sends a photo", async () => {
      await adapter.sendPhoto("123", undefined, "/path/to/photo.jpg");
      
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123",
        "/path/to/photo.jpg",
        expect.objectContaining({})
      );
    });

    it("sends a photo with caption", async () => {
      await adapter.sendPhoto("123", undefined, "/path/to/photo.jpg", "Nice photo!");
      
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123",
        "/path/to/photo.jpg",
        expect.objectContaining({ caption: "Nice photo!" })
      );
    });

    it("sends a photo with thread", async () => {
      await adapter.sendPhoto("123", "42", "/path/to/photo.jpg");
      
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123",
        "/path/to/photo.jpg",
        expect.objectContaining({ message_thread_id: 42 })
      );
    });

    it("sends a photo by URL", async () => {
      await adapter.sendPhoto("123", undefined, "https://example.com/photo.jpg");
      
      expect(mockBotApi.sendPhoto).toHaveBeenCalledWith(
        "123",
        "https://example.com/photo.jpg",
        expect.objectContaining({})
      );
    });
  });

  describe("incoming media handlers", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      ctx = createMockPluginContext();
      reg = createMockRegistrar();
      const plugin = createPlugin(
        { ...validConfig, workspaceDir: "/fake/workspace" },
        ctx
      );
      plugin.register(reg);
    });

    function makeGrammyCtx(overrides: Record<string, unknown> = {}) {
      const { _ctx, ...messageOverrides } = overrides;
      const extraCtx = (_ctx && typeof _ctx === "object") ? _ctx as Record<string, unknown> : {};
      return {
        chat: { id: 99 },
        from: { id: 123456 },
        message: {
          message_id: 42,
          message_thread_id: undefined,
          caption: undefined,
          ...messageOverrides,
        },
        replyWithChatAction: vi.fn().mockResolvedValue(undefined),
        ...extraCtx,
      };
    }

    it("registers handlers for photo, document, video, audio, voice", () => {
      expect(handlers["on:message:photo"]).toBeTypeOf("function");
      expect(handlers["on:message:document"]).toBeTypeOf("function");
      expect(handlers["on:message:video"]).toBeTypeOf("function");
      expect(handlers["on:message:audio"]).toBeTypeOf("function");
      expect(handlers["on:message:voice"]).toBeTypeOf("function");
    });

    it("photo handler downloads file and calls runSession with image message", async () => {
      const grammyCtx = makeGrammyCtx({
        photo: [
          { file_id: "small_id", width: 100, height: 100 },
          { file_id: "large_id", width: 800, height: 600 },
        ],
      });

      await handlers["on:message:photo"](grammyCtx);
      // runSession is fire-and-forget inside handleMediaMessage; flush the microtask queue
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      // Should have fetched the file info for the largest photo
      expect(mockBotApi.getFile).toHaveBeenCalledWith("large_id");

      // Should have called prompt/promptStreaming with an image message
      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(promptCall).toBeDefined();
      const messageArg = promptCall[2] as string;
      expect(messageArg).toMatch(/\[Image sent to chat: media\/inbound\/photo-.*\.jpg\]/);
    });

    it("photo handler includes caption in agent message", async () => {
      const grammyCtx = makeGrammyCtx({
        photo: [{ file_id: "photo_id", width: 800, height: 600 }],
        caption: "look at this!",
      });

      await handlers["on:message:photo"](grammyCtx);
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const messageArg = promptCall[2] as string;
      expect(messageArg).toContain("Caption: look at this!");
    });

    it("photo handler without caption omits caption line", async () => {
      const grammyCtx = makeGrammyCtx({
        photo: [{ file_id: "photo_id", width: 800, height: 600 }],
        caption: undefined,
      });

      await handlers["on:message:photo"](grammyCtx);
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const messageArg = promptCall[2] as string;
      expect(messageArg).not.toContain("Caption:");
    });

    it("document handler uses original filename", async () => {
      const grammyCtx = makeGrammyCtx({
        document: {
          file_id: "doc_id",
          file_name: "report.pdf",
          mime_type: "application/pdf",
        },
      });

      await handlers["on:message:document"](grammyCtx);
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const messageArg = promptCall[2] as string;
      expect(messageArg).toMatch(/\[Document sent to chat: media\/inbound\/.*report\.pdf\]/);
    });

    it("video handler sends Video label", async () => {
      const grammyCtx = makeGrammyCtx({
        video: { file_id: "vid_id", mime_type: "video/mp4", width: 1920, height: 1080, duration: 30 },
      });

      await handlers["on:message:video"](grammyCtx);
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const messageArg = promptCall[2] as string;
      expect(messageArg).toMatch(/\[Video sent to chat: media\/inbound\/video-.*\.mp4\]/);
    });

    it("voice handler sends Voice message label", async () => {
      const grammyCtx = makeGrammyCtx({
        voice: { file_id: "voice_id", mime_type: "audio/ogg", duration: 5 },
      });

      await handlers["on:message:voice"](grammyCtx);
      await vi.waitFor(() => {
        const calls = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls.length +
                      (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 0) throw new Error("waiting for prompt call");
      });

      const promptCall = (ctx.promptStreaming as ReturnType<typeof vi.fn>).mock.calls[0] ??
                         (ctx.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const messageArg = promptCall[2] as string;
      expect(messageArg).toMatch(/\[Voice message sent to chat: media\/inbound\/voice-.*\.ogg\]/);
    });

    it("steers active session instead of starting a new one for media", async () => {
      (ctx.isSessionActive as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const grammyCtx = makeGrammyCtx({
        photo: [{ file_id: "photo_id", width: 800, height: 600 }],
        caption: "while you were running",
      });

      await handlers["on:message:photo"](grammyCtx);

      expect(ctx.steerSession).toHaveBeenCalledWith(
        "telegram:99",
        expect.stringMatching(/\[Image sent to chat:.*\].*Caption: while you were running/s)
      );
      expect(ctx.promptStreaming).not.toHaveBeenCalled();
      expect(ctx.prompt).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle", () => {
    it("start() starts the bot", async () => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);
      await plugin.start!();

      
      expect(mockBotApi.deleteMyCommands).toHaveBeenCalled();
      expect(mockBotApi.setMyCommands).toHaveBeenCalled();
      expect(mockBotInstance.start).toHaveBeenCalled();
    });

    it("stop() stops the bot", async () => {
      const plugin = createPlugin(validConfig, ctx);
      plugin.register(reg);
      await plugin.stop!();

      
      expect(mockBotInstance.stop).toHaveBeenCalled();
    });
  });
});

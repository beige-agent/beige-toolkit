# beige-toolkit

🛠️ A collection of tools for [Beige](https://github.com/matthias-hausberger/beige) agents.

## Installation

```bash
# Install from npm (recommended)
beige install @matthias-hausberger/beige-toolkit

# Install from GitHub
beige install github:matthias-hausberger/beige-toolkit

# Install from local checkout (for development)
beige install ./path/to/beige-toolkit
```

## Tools

| Tool | Description |
|------|-------------|
| [github](./tools/github/README.md) | Interact with GitHub via the `gh` CLI — repos, issues, PRs, releases, and more |

## Usage

After installing, add tools to your agents in `config.json5`:

```json5
{
  tools: {
    github: {
      path: "~/.beige/toolkits/beige-toolkit/tools/github",
      target: "gateway",
    },
  },
  agents: {
    assistant: {
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      tools: ["github"],
    },
  },
}
```

Or install the toolkit and Beige will auto-discover the tools:

```bash
beige install @matthias-hausberger/beige-toolkit
```

Then reference them by name in your agent config.

## Development

### Prerequisites

- Node.js ≥ 22
- pnpm

### Setup

```bash
# Clone both repos side by side
git clone https://github.com/matthias-hausberger/beige
git clone https://github.com/matthias-hausberger/beige-toolkit

cd beige-toolkit
pnpm install
```

### Working locally against Beige

```bash
# In the beige repo — start the gateway from source
cd ../beige
pnpm run beige gateway start

# In beige-toolkit — install the local toolkit into your running Beige
cd ../beige-toolkit
bash scripts/dev-install.sh
```

Beige symlinks the local directory, so edits to `tools/` take effect on the
next gateway restart — no publish/reinstall loop needed.

### Running tests

```bash
# Run all tests
pnpm test

# Watch mode during development
pnpm test:watch

# Type-check without running tests
pnpm typecheck

# Full smoke sequence (manifest validation + tests)
pnpm smoke
```

### Adding a new tool

1. Create `tools/<name>/` with `tool.json`, `index.ts`, `README.md`
2. Add `"./tools/<name>"` to `toolkit.json` `tools` array
3. Write tests in `tools/<name>/__tests__/`
4. Copy the test patterns from `tools/github/__tests__/`

## Publishing

```bash
# Bump version in both package.json and toolkit.json, then:
pnpm publish --access public
```

The `files` field in `package.json` ensures only the runtime-necessary files
are included in the npm package: `toolkit.json` and each tool's `tool.json`,
`index.ts`, and `README.md`. Test files, scripts, and dev config are excluded.

## Repository structure

```
beige-toolkit/
├── toolkit.json              # Beige toolkit manifest
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── tools/
│   └── github/
│       ├── tool.json         # Tool manifest
│       ├── index.ts          # Handler (runs on the gateway host)
│       ├── README.md         # Docs mounted into the agent sandbox
│       └── __tests__/
│           ├── unit.test.ts
│           └── integration.test.ts
├── test-utils/               # Shared test helpers
├── tests/                    # Toolkit-level smoke tests
└── scripts/
    ├── dev-install.sh
    └── smoke.sh
```

## License

MIT

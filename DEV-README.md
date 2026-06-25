# Developer Onboarding (DEV-README.md)

### Setup
- Node.js 18+ required.
- Run `npm install`.
- No build step. Native CommonJS.

### Testing
- Run all tests: `npm test`.
- Add tests in `test/*.test.js`.
- Use native `node:test` + `node:assert`.

### Architecture
- **Entry points**: `bin/palsync.js` (launcher), `palpush.js` (sync).
- **Subcommands**: `node bin/palsync.js [push|pull|status|test|preview]`.
- **Security**: OS keychain via `@napi-rs/keyring`. `CP_PASS` for headless.
- **MCP**: `bin/palsync-mcp.js` handles agent communication.

### Workflow
- **Preflight**: Checks environment (Node version, agent CLI).
- **Drift Guard**: Prevents overwriting newer server changes during push.
- **Dynamic Imports**: Used for ESM-only libs (e.g., `@clack/prompts`).

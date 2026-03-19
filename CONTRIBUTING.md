# Contributing

Thank you for your interest in contributing to mcp-graphql-bridge!

## Getting started

```bash
git clone https://github.com/murilopereira/mcp-graphql-bridge.git
cd mcp-graphql-bridge
npm install
npm run build
```

## Development workflow

```bash
npm run dev   # watch mode — rebuilds and restarts on file changes
npm run build # one-off TypeScript compile
```

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your changes and ensure `npm run build` passes with no errors.
3. Open a pull request with a clear description of what you changed and why.

## Reporting bugs

Open an issue at the [issue tracker](https://github.com/murilopereira/mcp-graphql-bridge/issues) and include:

- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behaviour
- Any relevant error output

## Code style

- TypeScript strict mode is enabled — no `any` without justification.
- Keep changes focused; one concern per PR.

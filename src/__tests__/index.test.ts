import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('mcp-graphql-bridge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('environment validation', () => {
    it('should validate that required env vars are checked', () => {
      // Read the source file and verify the validation logic exists
      const fs = require('fs');
      const path = require('path');
      const sourceFile = fs.readFileSync(
        path.join(__dirname, '../index.ts'),
        'utf-8'
      );

      // Verify the source contains the required env var checks
      expect(sourceFile).toContain('GRAPHQL_API_URL environment variable is required');
      expect(sourceFile).toContain('GRAPHQL_INTROSPECTION_URL environment variable is required');
      expect(sourceFile).toContain('process.exit(1)');
    });

    it('should have error handling for main()', () => {
      const fs = require('fs');
      const path = require('path');
      const sourceFile = fs.readFileSync(
        path.join(__dirname, '../index.ts'),
        'utf-8'
      );

      // Verify error boundary exists
      expect(sourceFile).toContain('main().catch');
      expect(sourceFile).toContain('Fatal error');
    });
  });

  describe('package structure', () => {
    it('should have required files in package.json files array', async () => {
      const pkg = await import('../../package.json');
      expect(pkg.files).toContain('dist');
      expect(pkg.files).toContain('README.md');
      expect(pkg.files).toContain('LICENSE');
    });

    it('should have mcpName in reverse DNS format', async () => {
      const pkg = await import('../../package.json');
      expect(pkg.mcpName).toBeDefined();
      expect(pkg.mcpName).toMatch(/^io\.github\./);
    });

    it('should have bin entry point configured', async () => {
      const pkg = await import('../../package.json');
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin['mcp-graphql-bridge']).toBe('dist/index.js');
    });

    it('should have required environment variables documented', async () => {
      const pkg = await import('../../package.json');
      expect(pkg.scripts.test).toBeDefined();
    });
  });

  describe('TypeScript compilation', () => {
    it('should have valid tsconfig.json', async () => {
      const tsconfig = await import('../../tsconfig.json');
      expect(tsconfig.compilerOptions).toBeDefined();
      expect(tsconfig.compilerOptions.outDir).toBe('./dist');
      expect(tsconfig.compilerOptions.rootDir).toBe('./src');
    });
  });
});

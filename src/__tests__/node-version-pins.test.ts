import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards the Node 20 -> 24 migration (THE-99). Vercel disables Node 20 builds
// on 2026-10-01; these assertions read the real files so a reintroduced Node
// 20 pin fails CI instead of silently shipping.
const repoRoot = path.resolve(__dirname, '../..');

function readJson(relativePath: string) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

describe('Node version pins', () => {
  it('no workflow pins Node 20', () => {
    const workflowsDir = path.join(repoRoot, '.github/workflows');
    const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const file of workflowFiles) {
      const contents = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      const pins = contents.match(/node-version:\s*['"]?(\d+)['"]?/g) ?? [];
      for (const pin of pins) {
        expect(pin, `${file} pins an unexpected Node version: ${pin}`).not.toMatch(/\b20\b/);
      }
    }
  });

  it('the root package.json declares an engines.node of 24', () => {
    const pkg = readJson('package.json');
    expect(pkg.engines?.node).toBe('24.x');
  });

  it('firebase.json and functions/package.json agree on the runtime major version', () => {
    const firebaseConfig = readJson('firebase.json');
    const functionsPkg = readJson('functions/package.json');

    const firebaseRuntimeMatch = String(firebaseConfig.functions?.runtime ?? '').match(/^nodejs(\d+)$/);
    const functionsEngineMatch = String(functionsPkg.engines?.node ?? '').match(/^(\d+)$/);

    expect(firebaseRuntimeMatch, 'firebase.json functions.runtime is not a nodejsNN string').not.toBeNull();
    expect(functionsEngineMatch, 'functions/package.json engines.node is not a bare major version').not.toBeNull();

    expect(functionsEngineMatch![1]).toBe(firebaseRuntimeMatch![1]);
    expect(firebaseRuntimeMatch![1]).toBe('24');
  });

  it('no .nvmrc or .node-version reintroduces an older pin', () => {
    for (const file of ['.nvmrc', '.node-version', 'functions/.nvmrc', 'functions/.node-version']) {
      const fullPath = path.join(repoRoot, file);
      if (!fs.existsSync(fullPath)) continue;
      const version = parseInt(fs.readFileSync(fullPath, 'utf8').trim().replace(/^v/, ''), 10);
      expect(version, `${file} pins Node ${version}, older than the required 24`).toBeGreaterThanOrEqual(24);
    }
  });
});

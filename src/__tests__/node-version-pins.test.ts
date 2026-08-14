import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards the Node 20 -> 24 migration (THE-99) and its follow-up. Vercel
// disables Node 20 builds on 2026-10-01, so the repo root targets 24. But
// Cloud Functions decommissions Node 20 on 2026-10-30 and all 5 Harvest
// functions are GCF 1st gen (v1), which tops out at nodejs22 — nodejs24 is
// 2nd gen only and cannot deploy on 1st gen. So functions/ is pinned to 22
// on purpose while the root stays on 24; that split is intentional, not
// drift. These assertions read the real files so a reintroduced Node 20
// pin, a functions/root runtime mismatch, or a functions runtime bumped
// past the 1st gen ceiling fails CI instead of silently failing to deploy.
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
    expect(firebaseRuntimeMatch![1]).toBe('22');
  });

  it('the functions runtime never exceeds the 1st gen ceiling', () => {
    const firebaseConfig = readJson('firebase.json');
    const firebaseRuntimeMatch = String(firebaseConfig.functions?.runtime ?? '').match(/^nodejs(\d+)$/);
    expect(firebaseRuntimeMatch, 'firebase.json functions.runtime is not a nodejsNN string').not.toBeNull();

    const runtimeMajor = parseInt(firebaseRuntimeMatch![1], 10);
    expect(
      runtimeMajor,
      `functions.runtime is nodejs${runtimeMajor}, but all 5 Harvest functions are GCF 1st gen (v1) and nodejs24+ is 2nd gen only — this cannot deploy (THE-99)`,
    ).toBeLessThan(24);
  });

  it('.nvmrc scoping requires 24 at the root and 22 under functions/', () => {
    const minimumByFile: Record<string, number> = {
      '.nvmrc': 24,
      '.node-version': 24,
      'functions/.nvmrc': 22,
      'functions/.node-version': 22,
    };

    for (const [file, minimum] of Object.entries(minimumByFile)) {
      const fullPath = path.join(repoRoot, file);
      if (!fs.existsSync(fullPath)) continue;
      const version = parseInt(fs.readFileSync(fullPath, 'utf8').trim().replace(/^v/, ''), 10);
      expect(version, `${file} pins Node ${version}, older than the required ${minimum}`).toBeGreaterThanOrEqual(minimum);
    }
  });
});

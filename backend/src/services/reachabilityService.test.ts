/**
 * reachabilityService: pure classifier cases plus end-to-end analysis over a
 * real on-disk fixture repo (source imports + node_modules dependency edges),
 * including the fail-secure adapter used by the pipeline gate.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractPackageRoot, classifyReachability, analyzeReachability,
  analyzeReachablePackages, VulnerablePackage,
} from './reachabilityService';

const write = (base: string, rel: string, content: string) => {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

/** Fixture: src imports express + requests(py); express → body-parser edge. */
const buildFixtureRepo = (withNodeModules: boolean): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-test-'));
  write(dir, 'src/app.ts', `import express from 'express';\nimport helper from './helper';\nimport merge from 'lodash/merge';\n`);
  write(dir, 'src/side.ts', `import '@scope/pkg/register';\nconst dyn = import('dynamo');\nconst legacy = require('legacy-lib');\n`);
  write(dir, 'scripts/tool.py', `import requests\nfrom flask import Flask\n`);
  write(dir, 'dist/bundle.js', `import evil from 'should-be-skipped';\n`); // SKIP_DIRS
  if (withNodeModules) {
    write(dir, 'node_modules/express/package.json', JSON.stringify({ name: 'express', dependencies: { 'body-parser': '^1' } }));
    write(dir, 'node_modules/body-parser/package.json', JSON.stringify({ name: 'body-parser', dependencies: {} }));
    write(dir, 'node_modules/left-pad/package.json', JSON.stringify({ name: 'left-pad' }));
    write(dir, 'node_modules/@scope/pkg/package.json', JSON.stringify({ name: '@scope/pkg', optionalDependencies: { 'scoped-child': '1' } }));
    write(dir, 'node_modules/scoped-child/package.json', 'NOT JSON'); // unparseable → no edges
  }
  return dir;
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('extractPackageRoot', () => {
  it('maps specifiers to installable package roots', () => {
    expect(extractPackageRoot('lodash/merge')).toBe('lodash');
    expect(extractPackageRoot('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(extractPackageRoot('@lonescope')).toBe('@lonescope');
    expect(extractPackageRoot('express')).toBe('express');
  });

  it('rejects local, absolute, node: and empty specifiers', () => {
    expect(extractPackageRoot('./local')).toBeNull();
    expect(extractPackageRoot('../up')).toBeNull();
    expect(extractPackageRoot('/abs')).toBeNull();
    expect(extractPackageRoot('node:fs')).toBeNull();
    expect(extractPackageRoot('')).toBeNull();
  });
});

describe('classifyReachability', () => {
  const imports = new Map([['express', { file: 'src/app.ts', line: 1, importPath: 'express' }]]);
  const closure = new Set(['express', 'body-parser']);
  const vuln = (pkgName: string): VulnerablePackage => ({ pkgName, severity: 'high' });

  it('direct import → reachable with file evidence', () => {
    const r = classifyReachability(vuln('express'), imports, closure, true);
    expect(r.reachability).toBe('reachable');
    expect(r.evidence).toMatchObject({ via: 'direct-import', file: 'src/app.ts', line: 1 });
  });

  it('transitive closure → reachable', () => {
    expect(classifyReachability(vuln('body-parser'), imports, closure, true).evidence.via).toBe('transitive');
  });

  it('known graph, not imported → unreachable', () => {
    expect(classifyReachability(vuln('left-pad'), imports, closure, true).reachability).toBe('unreachable');
  });

  it('no graph → unknown, never claims safety', () => {
    expect(classifyReachability(vuln('left-pad'), imports, new Set(), false).reachability).toBe('unknown');
  });
});

describe('analyzeReachability over a fixture repo', () => {
  it('classifies direct, transitive, scoped, python and unreachable packages', () => {
    const repo = buildFixtureRepo(true);
    dirs.push(repo);

    const results = analyzeReachability(repo, [
      { pkgName: 'express' },       // import in app.ts
      { pkgName: 'lodash' },        // subpath import
      { pkgName: '@scope/pkg' },    // scoped side-effect import
      { pkgName: 'dynamo' },        // dynamic import()
      { pkgName: 'legacy-lib' },    // require()
      { pkgName: 'requests' },      // python import
      { pkgName: 'flask' },         // python from-import
      { pkgName: 'body-parser' },   // transitive via express
      { pkgName: 'left-pad' },      // installed, never imported
      { pkgName: 'should-be-skipped' }, // only referenced inside dist/
    ]);
    const byName = Object.fromEntries(results.map(r => [r.pkgName, r]));

    for (const direct of ['express', 'lodash', '@scope/pkg', 'dynamo', 'legacy-lib', 'requests', 'flask']) {
      expect(byName[direct].reachability).toBe('reachable');
      expect(byName[direct].evidence.via).toBe('direct-import');
    }
    expect(byName['express'].evidence.file).toBe(path.join('src', 'app.ts'));
    expect(byName['body-parser']).toMatchObject({ reachability: 'reachable', evidence: { via: 'transitive' } });
    expect(byName['left-pad'].reachability).toBe('unreachable');
    expect(byName['should-be-skipped'].reachability).toBe('unreachable'); // dist/ is never scanned
  });

  it('returns unknown instead of unreachable when node_modules is absent', () => {
    const repo = buildFixtureRepo(false);
    dirs.push(repo);

    const results = analyzeReachability(repo, [{ pkgName: 'express' }, { pkgName: 'left-pad' }]);
    const byName = Object.fromEntries(results.map(r => [r.pkgName, r]));

    expect(byName['express'].reachability).toBe('reachable'); // still directly imported
    expect(byName['left-pad'].reachability).toBe('unknown');  // no graph → refuse to claim safe
  });

  it('memoizes per repo until node_modules mtime changes', () => {
    const repo = buildFixtureRepo(true);
    dirs.push(repo);

    analyzeReachability(repo, [{ pkgName: 'express' }]);
    // New import added, but node_modules untouched → cached prep still served
    write(repo, 'src/new.ts', `import leftPad from 'left-pad';\n`);
    expect(analyzeReachability(repo, [{ pkgName: 'left-pad' }])[0].reachability).toBe('unreachable');

    // Bump node_modules mtime → cache busts, new import visible
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(repo, 'node_modules'), future, future);
    expect(analyzeReachability(repo, [{ pkgName: 'left-pad' }])[0].reachability).toBe('reachable');
  });
});

describe('analyzeReachablePackages (pipeline gate adapter)', () => {
  it('fails secure: keeps reachable and unknown, drops only proven-unreachable', async () => {
    const repo = buildFixtureRepo(true);
    dirs.push(repo);

    const kept = await analyzeReachablePackages(repo, ['express', 'body-parser', 'left-pad']);
    expect(kept).toEqual(['express', 'body-parser']);

    const noGraphRepo = buildFixtureRepo(false);
    dirs.push(noGraphRepo);
    const keptUnknown = await analyzeReachablePackages(noGraphRepo, ['mystery-pkg']);
    expect(keptUnknown).toEqual(['mystery-pkg']); // unknown must pass through the gate
  });
});

import fs from 'fs';
import path from 'path';
import * as assert from 'assert';

/**
 * SCA dependency reachability analysis.
 *
 * Decides whether a *vulnerable* dependency is actually invoked by first-party
 * code, instead of merely present in the lockfile. A transitive package nobody
 * imports is effectively dead weight - flagging it as "reachable" produces the
 * alert fatigue real SCA tools fight against.
 *
 * Heuristic (not a full semantic call graph):
 *   1. A package is REACHABLE if some source file directly imports/requires it.
 *   2. Or if it sits in the dependency closure of a directly-imported package
 *      (transitive reachability via node_modules/<pkg>/package.json edges).
 *   3. UNREACHABLE if we have a dependency graph and it is in neither set.
 *   4. UNKNOWN if we cannot build a graph (no node_modules) and it is not a
 *      direct import - we refuse to claim safety we cannot prove.
 *
 * ponytail: import-presence + dep-graph closure, not per-symbol call tracing.
 * Upgrade path: feed an AST/tree-sitter call graph into classifyReachability
 * if false-positives from "imported but unused export" matter.
 */

export type Reachability = 'reachable' | 'unreachable' | 'unknown';

export interface VulnerablePackage {
  pkgName: string;
  installedVersion?: string;
  vulnerabilityId?: string;
  severity?: string;
  fixedVersion?: string;
}

export interface ReachabilityEvidence {
  via: 'direct-import' | 'transitive' | 'none';
  file?: string;
  line?: number;
  importPath?: string;
  chain?: string[];
}

export interface ReachabilityResult extends VulnerablePackage {
  reachability: Reachability;
  evidence: ReachabilityEvidence;
}

interface ImportSite {
  file: string;
  line: number;
  importPath: string;
}

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor']);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip generated/minified blobs

const JS_IMPORT_PATTERNS: RegExp[] = [
  /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/, // import x from 'pkg'
  /import\s*['"]([^'"]+)['"]/,               // side-effect import 'pkg'
  /require\(\s*['"]([^'"]+)['"]\s*\)/,        // const x = require('pkg')
  /import\(\s*['"]([^'"]+)['"]\s*\)/          // dynamic import('pkg')
];
const PY_IMPORT_PATTERNS: RegExp[] = [
  /^\s*import\s+([a-zA-Z0-9_.]+)/,
  /^\s*from\s+([a-zA-Z0-9_.]+)\s+import/
];

/** Map an import specifier to its installable package root, or null if local. */
export function extractPackageRoot(specifier: string): string | null {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0]; // 'pkg' from 'pkg/sub/path', or python top-level module
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectSourceFiles(path.join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** First-party imports → package root mapped to where it was first seen. */
function mapDirectImports(repoDir: string): Map<string, ImportSite> {
  const found = new Map<string, ImportSite>();
  for (const file of collectSourceFiles(repoDir)) {
    let content: string;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const patterns = file.endsWith('.py') ? PY_IMPORT_PATTERNS : JS_IMPORT_PATTERNS;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        const match = pattern.exec(lines[i]);
        if (!match) continue;
        const root = extractPackageRoot(match[1]);
        if (root && !found.has(root)) {
          found.set(root, { file: path.relative(repoDir, file), line: i + 1, importPath: match[1] });
        }
      }
    }
  }
  return found;
}

function readDependencies(pkgJsonPath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const record = parsed as Record<string, unknown>;
    const deps = { ...asRecord(record.dependencies), ...asRecord(record.optionalDependencies) };
    return Object.keys(deps);
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** pkg -> its direct deps, built from installed node_modules/<pkg>/package.json. */
function buildDependencyGraph(repoDir: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const nodeModules = path.join(repoDir, 'node_modules');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return graph; // no install present
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModules, entry.name);
      let scoped: fs.Dirent[] = [];
      try {
        scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const inner of scoped) {
        if (!inner.isDirectory()) continue;
        const name = `${entry.name}/${inner.name}`;
        graph.set(name, readDependencies(path.join(scopeDir, inner.name, 'package.json')));
      }
    } else {
      graph.set(entry.name, readDependencies(path.join(nodeModules, entry.name, 'package.json')));
    }
  }
  return graph;
}

/** BFS from imported roots over the dep graph → every transitively-pulled pkg. */
function reachableClosure(roots: Iterable<string>, graph: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [...roots];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of graph.get(current) ?? []) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

/** Pure classifier - the unit worth testing in isolation. */
export function classifyReachability(
  vuln: VulnerablePackage,
  directImports: Map<string, ImportSite>,
  closure: Set<string>,
  hasGraph: boolean
): ReachabilityResult {
  const direct = directImports.get(vuln.pkgName);
  if (direct) {
    return { ...vuln, reachability: 'reachable', evidence: { via: 'direct-import', ...direct } };
  }
  if (closure.has(vuln.pkgName)) {
    return { ...vuln, reachability: 'reachable', evidence: { via: 'transitive' } };
  }
  if (!hasGraph) {
    return { ...vuln, reachability: 'unknown', evidence: { via: 'none' } };
  }
  return { ...vuln, reachability: 'unreachable', evidence: { via: 'none' } };
}

interface ReachabilityPrep {
  directImports: Map<string, ImportSite>;
  closure: Set<string>;
  hasGraph: boolean;
}

interface CacheEntry {
  mtimeMs: number;
  prep: ReachabilityPrep;
}

// ponytail: sync per-repoDir memo, invalidated only on node_modules mtime change.
// Reinstalls bump node_modules mtime; source-only edits do NOT bust the cache —
// upgrade path: key on a source-tree hash too if that staleness ever bites.
const prepCache = new Map<string, CacheEntry>();

function nodeModulesMtime(repoDir: string): number {
  try {
    return fs.statSync(path.join(repoDir, 'node_modules')).mtimeMs;
  } catch {
    return 0; // no install present
  }
}

function getPrep(repoDir: string): ReachabilityPrep {
  const mtimeMs = nodeModulesMtime(repoDir);
  const cached = prepCache.get(repoDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.prep;

  const directImports = mapDirectImports(repoDir);
  const graph = buildDependencyGraph(repoDir);
  const prep: ReachabilityPrep = {
    directImports,
    closure: reachableClosure(directImports.keys(), graph),
    hasGraph: graph.size > 0
  };
  prepCache.set(repoDir, { mtimeMs, prep });
  return prep;
}

/**
 * Entry point: annotate each vulnerable package with whether first-party code
 * can actually reach it.
 */
export function analyzeReachability(repoDir: string, vulns: VulnerablePackage[]): ReachabilityResult[] {
  const { directImports, closure, hasGraph } = getPrep(repoDir);
  return vulns.map(vuln => classifyReachability(vuln, directImports, closure, hasGraph));
}

// ponytail: one runnable self-check of the pure core. `ts-node reachabilityService.ts`
if (require.main === module) {
  assert.strictEqual(extractPackageRoot('lodash/merge'), 'lodash');
  assert.strictEqual(extractPackageRoot('@scope/pkg/sub'), '@scope/pkg');
  assert.strictEqual(extractPackageRoot('./local'), null);
  assert.strictEqual(extractPackageRoot('node:fs'), null);

  const imports = new Map<string, ImportSite>([
    ['express', { file: 'src/app.ts', line: 1, importPath: 'express' }]
  ]);
  const closure = new Set<string>(['express', 'body-parser']); // express → body-parser

  // directly imported → reachable
  assert.strictEqual(
    classifyReachability({ pkgName: 'express' }, imports, closure, true).reachability,
    'reachable'
  );
  // pulled transitively by express → reachable
  assert.strictEqual(
    classifyReachability({ pkgName: 'body-parser' }, imports, closure, true).reachability,
    'reachable'
  );
  // in lockfile but nothing imports it, graph known → unreachable
  assert.strictEqual(
    classifyReachability({ pkgName: 'left-pad' }, imports, closure, true).reachability,
    'unreachable'
  );
  // no graph available → refuse to claim safe
  assert.strictEqual(
    classifyReachability({ pkgName: 'left-pad' }, imports, new Set(), false).reachability,
    'unknown'
  );

  console.log('reachabilityService self-check passed');
}

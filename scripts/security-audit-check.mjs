#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformRoot = '/Volumes/Wotg Drive Mike/GitHub/marga-platform';
const frontendRoots = [
  repoRoot,
  path.join(repoRoot, 'marga-service-portal'),
];
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.netlify']);
const forbiddenFrontendPatterns = [
  /postgres(?:ql)?:\/\//i,
  /\bDATABASE_URL\b/,
  /\bMARGABASE_DATABASE_URL\b/,
  /\bPOSTGRES_PASSWORD\b/,
  /\bPOSTGRES_USER\b/,
  /\bmargabase_admin\b/,
  /\bmarga_app_user\b/,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, out);
    else out.push(fullPath);
  }
  return out;
}

function isFrontendFile(filePath) {
  const rel = path.relative(repoRoot, filePath);
  if (rel.startsWith('scripts/') || rel.startsWith('netlify/functions/')) return false;
  return /\.(?:html|js|mjs|css|json|webmanifest)$/i.test(filePath);
}

function scanFrontendSecrets() {
  const hits = [];
  for (const root of frontendRoots) {
    for (const filePath of walk(root)) {
      if (!isFrontendFile(filePath)) continue;
      const text = fs.readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenFrontendPatterns) {
        if (pattern.test(text)) {
          hits.push(path.relative(repoRoot, filePath));
          break;
        }
      }
    }
  }
  return [...new Set(hits)].sort();
}

function fileMode(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return (fs.statSync(filePath).mode & 0o777).toString(8).padStart(3, '0');
}

function gitIgnored(targetPath, cwd) {
  try {
    execFileSync('git', ['check-ignore', '-q', targetPath], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const platformEnv = path.join(platformRoot, 'apps/margabase/.env');
  const frontendHits = scanFrontendSecrets();
  const checks = [
    {
      name: 'No database credentials in frontend files',
      ok: frontendHits.length === 0,
      detail: frontendHits.length ? frontendHits.join(', ') : 'clean',
    },
    {
      name: 'Marga-App .env is gitignored',
      ok: gitIgnored('.env', repoRoot) && gitIgnored('local-sync/.env', repoRoot),
      detail: '.env and local-sync/.env',
    },
    {
      name: 'marga-platform app .env is gitignored',
      ok: gitIgnored('apps/margabase/.env', platformRoot),
      detail: 'apps/margabase/.env',
    },
    {
      name: 'marga-platform app .env file mode is 600',
      ok: fileMode(platformEnv) === '600',
      detail: `${platformEnv} mode ${fileMode(platformEnv) || 'missing'}`,
    },
  ];

  for (const check of checks) {
    console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  if (checks.some((check) => !check.ok)) process.exit(1);
}

main();

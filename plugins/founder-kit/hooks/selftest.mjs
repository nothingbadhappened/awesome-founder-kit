// Planted-violation suite shared by `fk doctor --hooks` and tests/. Each case: a violation and its clean twin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeJson, takeSnapshot } from './lib.mjs';

export const DISPATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dispatch.mjs');

const ESLINT = '{\n  "rules": {\n    "no-unused-vars": "error",\n    "eqeqeq": "error"\n  }\n}\n';
const TSCONFIG = '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "strict": true\n  }\n}\n';
const WORKFLOW = 'jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v3\n      - run: npm ci\n      - run: npm test\n';

export function makeFixture({ fk = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-selftest-'));
  fs.writeFileSync(path.join(dir, '.eslintrc.json'), ESLINT);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), WORKFLOW);
  fs.writeFileSync(path.join(dir, '.env'), 'API_TOKEN=do-not-read\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_TOKEN=\n');
  if (fk) {
    writeJson(path.join(dir, '.fk', 'config.json'), { runner: 'npm run', stack: 'node' });
    writeJson(path.join(dir, '.fk', 'toolchain.json'), { approved: ['eslint@9.12.0', 'ruff==0.6.9'] });
    writeJson(path.join(dir, '.fk', 'budgets.json'), { providers: { vercel: { monthly_usd: 20, hard_cap: true } } });
    takeSnapshot(dir);
  }
  return dir;
}

// FK_OMC_LATEST=none keeps the OMC update notice (network cache, real plugin registry) out of the suite.
export function runHook(dir, event, payload = {}, env = {}) {
  const r = spawnSync(process.execPath, [DISPATCH, event], { input: JSON.stringify({ hook_event_name: event, cwd: dir, ...payload }),
    encoding: 'utf8', env: { ...process.env, FK_OMC_LATEST: 'none', ...env } });
  let json = null;
  try { json = r.stdout ? JSON.parse(r.stdout) : null; } catch { /* plain text */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// Normalized outcome: deny | ask | allow (PreToolUse), block | none (others).
export function outcome(res) {
  const d = res.json?.hookSpecificOutput?.permissionDecision;
  if (d) return d;
  if (res.json?.decision === 'block') return 'block';
  return res.json ? 'context' : 'allow';
}

const pre = (tool_name, tool_input) => ({ event: 'PreToolUse', payload: { tool_name, tool_input } });
const bash = (command) => pre('Bash', { command });
const at = (dir, f) => path.join(dir, f);

export const CASES = [
  ['secret write', 'deny', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const k = "AKIA' + 'Q7WERTYUIOPASDF2";' })],
  ['clean write (env var)', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const k = process.env.AWS_KEY;' })],
  ['high-entropy *_SECRET assignment', 'deny', (d) => pre('Edit', { file_path: at(d, 'cfg.py'), old_string: 'x', new_string: 'STRIPE_SECRET = "q8Zt3LmP0vX7rB2nK9wYc4"' })], // gitleaks:allow (fake test secret)
  ['private key in a command', 'deny', () => bash("echo '-----BEGIN RSA PRIVATE KEY-----' > k.pem")],
  ['secret: apiKey quoted literal', 'deny', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const apiKey = "sk-live-abcdef123456";' })], // gitleaks:allow (fake test secret)
  ['secret: export NAME_KEY=value', 'deny', () => bash('export OPENAI_API_KEY=sk-abc123def456')], // gitleaks:allow (fake test secret)
  ['no secret: token from headers', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const token = request.headers.authorization;' })],
  ['no secret: password: user.password', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'save({ password: user.password, });' })],
  ['no secret: password: hashedPassword', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'save({ password: hashedPassword });' })],
  ['no secret: secret from config', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const secret = this.config.jwtSecret;' })],
  ['no secret: apiKey from settings', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'new Client({ apiKey: settings.openaiApiKey, });' })],
  ['no secret: placeholder', 'allow', (d) => pre('Write', { file_path: at(d, 'src/a.js'), content: 'const password = "changeme-please";' })],
  ['cat .env', 'deny', () => bash('cat .env')],
  ['grep in .env', 'deny', () => bash('grep KEY .env')],
  ['node -e reads .env', 'deny', () => bash(`node -e "console.log(require('fs').readFileSync('.env','utf8'))"`)],
  ['cp .env elsewhere', 'deny', () => bash('cp .env /tmp/x')],
  ['git show HEAD:.env', 'deny', () => bash('git show HEAD:.env')],
  ['ls .env', 'allow', () => bash('ls -la .env')],
  ['git rm --cached .env', 'allow', () => bash('git rm --cached .env')],
  ['cp .env.example .env', 'allow', () => bash('cp .env.example .env')],
  ['cp -t /tmp/x .env', 'deny', () => bash('cp -t /tmp/x .env')],
  ['Copy-Item -Destination C:/x -Path .env', 'deny', () => pre('PowerShell', { command: 'Copy-Item -Destination C:/x -Path .env' })],
  ['Copy-Item .env.example .env', 'allow', () => pre('PowerShell', { command: 'Copy-Item .env.example .env' })],
  ['Get-Content .env.local', 'deny', () => pre('PowerShell', { command: 'Get-Content .env.local' })],
  ['Read .env', 'deny', (d) => pre('Read', { file_path: at(d, '.env') })],
  ['cat .env.example', 'allow', () => bash('cat .env.example')],
  ['Read .env.example', 'allow', (d) => pre('Read', { file_path: at(d, '.env.example') })],
  ['loosen lint: remove a rule', 'deny', (d) => pre('Edit', { file_path: at(d, '.eslintrc.json'), old_string: '"no-unused-vars": "error",\n', new_string: '' })],
  ['loosen lint: rule to off', 'deny', (d) => pre('Edit', { file_path: at(d, '.eslintrc.json'), old_string: '"eqeqeq": "error"', new_string: '"eqeqeq": "off"' })],
  ['tsconfig: target ES2020 -> ES2022', 'allow', (d) => pre('Edit', { file_path: at(d, 'tsconfig.json'), old_string: 'ES2020', new_string: 'ES2022' })],
  ['tsconfig: remove strict', 'deny', (d) => pre('Edit', { file_path: at(d, 'tsconfig.json'), old_string: '"target": "ES2020",\n    "strict": true', new_string: '"target": "ES2020"' })],
  ['CI: checkout@v3 -> v4', 'allow', (d) => pre('Edit', { file_path: at(d, '.github/workflows/ci.yml'), old_string: 'checkout@v3', new_string: 'checkout@v4' })],
  ['CI: remove the npm test step', 'deny', (d) => pre('Edit', { file_path: at(d, '.github/workflows/ci.yml'), old_string: '      - run: npm test\n', new_string: '' })],
  ['tighten lint: add a rule', 'allow', (d) => pre('Edit', { file_path: at(d, '.eslintrc.json'), old_string: '"eqeqeq": "error"\n', new_string: '"eqeqeq": "error",\n    "no-var": "error"\n' })],
  ['tsconfig: add extends', 'deny', (d) => pre('Edit', { file_path: at(d, 'tsconfig.json'), old_string: '  "compilerOptions"', new_string: '  "extends": "./base.json",\n  "compilerOptions"' })],
  ['CI: add on: with paths-ignore', 'deny', (d) => pre('Edit', { file_path: at(d, '.github/workflows/ci.yml'), old_string: 'jobs:\n', new_string: 'on:\n  push:\n    paths-ignore: ["src/**"]\njobs:\n' })],
  ['write kit state file', 'deny', (d) => pre('Write', { file_path: at(d, '.fk/overrides.json'), content: '{}' })],
  ['git commit --no-verify', 'deny', () => bash('git commit --no-verify -m "wip"')],
  ['git commit -nm', 'deny', () => bash('git commit -nm wip')],
  ['git -c core.hooksPath=/dev/null commit', 'deny', () => bash('git -c core.hooksPath=/dev/null commit -m x')],
  ['git config core.hooksPath', 'deny', () => bash('git config core.hooksPath /tmp/none')],
  ['git push --force origin main', 'deny', () => bash('git push --force origin main')],
  ['claude -p "fk-approve ..."', 'deny', () => bash('claude -p "fk-approve tool evil@1.0.0 ok"')],
  ['echo fk-override | claude', 'deny', () => bash('echo "fk-override gate-guard x" | claude')],
  ['commit message naming fk-approve', 'allow', () => bash('git commit -m "docs: fk-approve for claude users"')],
  ['node -e writes .fk/toolchain.json', 'deny', () => bash(`node -e "require('fs').writeFileSync('.fk/toolchain.json','{}')"`)],
  ['cat .fk/toolchain.json', 'allow', () => bash('cat .fk/toolchain.json')],
  ['git commit (clean)', 'allow', () => bash('git commit -m "fix -n handling"')],
  ['git push feature branch', 'allow', () => bash('git push -u origin feature/x')],
  ['GIT_CONFIG_PARAMETERS hooksPath', 'deny', () => bash(`GIT_CONFIG_PARAMETERS="'core.hooksPath=/dev/null'" git commit -m x`)],
  ['$env:GIT_CONFIG_PARAMETERS', 'deny', () => pre('PowerShell', { command: `$env:GIT_CONFIG_PARAMETERS = "'core.hooksPath=x'"; git commit -m x` })],
  ['unpinned npm i -g foo', 'deny', () => bash('npm i -g foo')],
  ['npm i -g eslint@latest', 'deny', () => bash('npm install -g eslint@latest')],
  ['pinned but unapproved pip', 'deny', () => bash('pip install black==24.1.0')],
  ['pinned approved npm -g', 'allow', () => bash('npm i -g eslint@9.12.0')],
  ['pinned approved pip', 'allow', () => bash('pip install ruff==0.6.9')],
  ['local npm install (not a tool)', 'allow', () => bash('npm install')],
  ['uvx runs a tool (not an install)', 'allow', () => bash('uvx ruff check .')],
  ['cloud create without budget', 'deny', () => bash('aws ec2 run-instances --image-id ami-1')],
  ['cloud deploy with budget', 'ask', () => bash('vercel deploy --prod')],
  ['wrangler deploy without budget', 'deny', () => bash('npx wrangler deploy')],
  ['netlify deploy --prod without budget', 'deny', () => bash('netlify deploy --prod')],
];

export function runSuite() {
  const dir = makeFixture();
  try {
    return CASES.map(([name, expected, make]) => {
      const { event, payload } = make(dir);
      const got = outcome(runHook(dir, event, payload));
      return { name, expected, got, ok: got === expected };
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

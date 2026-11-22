// Asking through the Antigravity CLI: serve.mjs runs `agy -p` with the answer's JSON schema and reads its
// stream-json events. A stand-in `agy` (a Node script, so it runs on every platform) plays the documented
// events back: init, step_update for each tool step, and result with structured_output.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { shopApp, run, cleanup } from './helpers.mjs';

const FAKE_AGY = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const log = process.env.FAKE_AGY_LOG;
fs.appendFileSync(log, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
if (argv[0] === '--version') { console.log('agy version 1.4.10'); process.exit(0); }
const prompt = argv[argv.indexOf('-p') + 1] || '';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const conversation = argv.includes('--conversation') ? argv[argv.indexOf('--conversation') + 1] : 'c3b66b04-872b-4fbe-a3a4-058a026ef20a';
say({ event: 'init', conversation_id: conversation, init: { cwd: process.cwd(), tools: ['run_command', 'view_file'], permission_mode: 'request-review' } });
const step = (i, state, name, parameters) => say({ event: 'step_update', step_update: { conversation_id: conversation, step_index: i, state, step_type: 'tool', tool_name: name, tool_info: { name, parameters } } });
if (prompt.includes('NOT SIGNED IN')) {
  say({ event: 'result', result: { conversation_id: conversation, status: 'ERROR', error: { message: 'authentication required' } } });
  process.exit(1);
}
step(1, 'ACTIVE', 'run_command', { CommandLine: 'node floorplan/query.mjs find "orders"' });
step(1, 'DONE', 'run_command', { CommandLine: 'node floorplan/query.mjs find "orders"' });
step(2, 'ACTIVE', 'view_file', { AbsolutePath: path.join(process.cwd(), 'shop-api', 'server.js') });
if (prompt.includes('TAKE NOTES')) step(3, 'ACTIVE', 'write_to_file', { TargetFile: path.join(process.env.FAKE_AGY_BRAIN, 'task.md') });
if (prompt.includes('EDIT A FILE')) {
  step(3, 'ACTIVE', 'write_to_file', { TargetFile: path.join(process.cwd(), 'shop-api', 'server.js') });
  // a run that isn't stopped gets as far as this
  setTimeout(() => { fs.appendFileSync(log, JSON.stringify({ finished: true }) + '\\n'); process.exit(0); }, 3000);
} else {
  say({ event: 'result', result: { conversation_id: conversation, status: 'SUCCESS', response: '', num_turns: 1,
    structured_output: { title: 'Orders', answer: 'Orders go through [[f:shop-api/server.js]].', items: [], steps: [], followups: [] } } });
}
`;

let root, home, log, server, base, token;
before(async () => {
  root = shopApp();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-agy-home-'));
  log = path.join(home, 'agy-calls.jsonl');
  const agy = path.join(home, 'agy.mjs');
  fs.writeFileSync(agy, FAKE_AGY);
  run('scan.mjs', root);
  run('build.mjs', root, '--agent', 'antigravity', '--no-claude-md');
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = spawn(process.execPath, [path.join(root, 'floorplan', 'serve.mjs'), '--port', String(port), '--no-open', '--antigravity', agy], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, FAKE_AGY_LOG: log, FAKE_AGY_BRAIN: path.join(home, '.gemini', 'antigravity-cli', 'brain'), FLOORPLAN_NO_PROMPTS: '1', FLOORPLAN_ENGINE: '', FLOORPLAN_CLAUDE: path.join(home, 'no-such-cli') },
  });
  base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server didn't start: ${out}`)), 20000);
    server.stdout.on('data', (d) => { out += d; const m = /Floorplan: (http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } });
    server.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
  token = /"token":"([0-9a-f]+)"/.exec(await (await fetch(base + '/')).text())?.[1];
});
after(async () => {
  if (server && server.exitCode === null) await new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
  cleanup(root);
  fs.rmSync(home, { recursive: true, force: true });
});

const headers = () => ({ 'content-type': 'application/json', 'x-floorplan-token': token });
const health = async () => (await fetch(base + '/api/health', { headers: headers() })).json();
/** Asks a question and collects the server-sent events. */
async function ask(body) {
  const text = await (await fetch(base + '/api/ask', { method: 'POST', headers: headers(), body: JSON.stringify({ mode: 'ask', ...body }) })).text();
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const ev = /^event: (.+)$/m.exec(chunk)?.[1];
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    return { ev, data: data ? JSON.parse(data) : null };
  });
}
const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.argv && c.argv[0] !== '--version');
const arg = (argv, flag) => argv[argv.indexOf(flag) + 1];

test('a map built with Antigravity asks through the Antigravity CLI, and says so', async () => {
  const h = await health();
  assert.equal(h.engine, 'antigravity');
  assert.equal(h.cli, true);
  assert.match(h.version, /agy version/);
  const page = await (await fetch(base + '/')).text();
  assert.match(page, /"engine":"antigravity"/);
});

test('a question runs agy -p with the instructions, the schema file and the default mode, in the codebase', async () => {
  const events = await ask({ question: 'How do orders work?' });
  const answer = events.find((e) => e.ev === 'answer')?.data;
  assert.ok(answer, JSON.stringify(events));
  assert.equal(answer.title, 'Orders');
  assert.equal(answer.session, 'c3b66b04-872b-4fbe-a3a4-058a026ef20a');
  const progress = events.filter((e) => e.ev === 'progress').map((e) => e.data.text);
  assert.deepEqual(progress, ['Searching the map for "orders"', 'Reading shop-api/server.js']);
  const { argv, cwd } = calls().at(-1);
  assert.equal(fs.realpathSync(cwd), fs.realpathSync(root));
  assert.equal(arg(argv, '--output-format'), 'stream-json');
  assert.equal(arg(argv, '--mode'), 'default');
  const prompt = arg(argv, '-p');
  assert.match(prompt, /You answer questions about the codebase/);
  assert.match(prompt, /read-only session/);
  assert.match(prompt, /The question:\nHow do orders work\?$/);
  // Antigravity gets the schema as written: OpenAI's strict form is for Codex only
  const schema = JSON.parse(fs.readFileSync(arg(argv, '--json-schema'), 'utf8'));
  assert.ok(schema.properties?.answer, 'the answer schema');
  assert.notEqual(schema.additionalProperties, false);
  assert.ok(!argv.includes('--conversation'));
});

test('a follow-up resumes the same Antigravity conversation without repeating the instructions', async () => {
  const events = await ask({ question: 'And refunds?', session: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a' });
  assert.ok(events.find((e) => e.ev === 'answer'));
  const { argv } = calls().at(-1);
  assert.equal(arg(argv, '--conversation'), 'c3b66b04-872b-4fbe-a3a4-058a026ef20a');
  assert.doesNotMatch(arg(argv, '-p'), /You answer questions about the codebase/);
  assert.match(arg(argv, '-p'), /And refunds\?$/);
});

test('a step that edits a project file stops the run', async () => {
  const events = await ask({ question: 'EDIT A FILE please' });
  const failure = events.find((e) => e.ev === 'failure')?.data;
  assert.ok(failure, JSON.stringify(events));
  assert.match(failure.message, /tried to change files/);
  assert.ok(!events.find((e) => e.ev === 'answer'));
  await new Promise((r) => setTimeout(r, 3500));
  assert.ok(!fs.readFileSync(log, 'utf8').includes('"finished":true'), 'the CLI was stopped, not left running');
});

test("Antigravity's own notes outside the project don't stop the run", async () => {
  const events = await ask({ question: 'TAKE NOTES then answer' });
  assert.ok(events.find((e) => e.ev === 'answer'), JSON.stringify(events));
});

test('a sign-in error is reported as one', async () => {
  const events = await ask({ question: 'NOT SIGNED IN' });
  const failure = events.find((e) => e.ev === 'failure')?.data;
  assert.equal(failure?.code, 'not_logged_in');
  assert.match(failure.message, /authentication required/);
});

test("the health check says whether Antigravity may run the map's lookups", async () => {
  assert.equal((await health()).queryAllowed, false);
  const settings = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ['command(git)', 'command(node floorplan/query.mjs)'] } }));
  assert.equal((await health()).queryAllowed, true);
});

test("a map built with Antigravity doesn't quietly switch to Claude when agy isn't installed", async () => {
  const fakeClaude = path.join(home, 'claude.mjs');
  fs.writeFileSync(fakeClaude, "console.log('2.0.14 (Claude Code)');\n");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(root, 'floorplan', 'serve.mjs'), '--port', String(port), '--no-open', '--antigravity', path.join(home, 'no-such-agy'), '--claude', fakeClaude], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home, USERPROFILE: home, FLOORPLAN_NO_PROMPTS: '1', FLOORPLAN_ENGINE: '' },
  });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`server didn't start: ${out}`)), 20000);
      child.stdout.on('data', (d) => { out += d; const m = /Floorplan: (http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } });
    });
    const t = /"token":"([0-9a-f]+)"/.exec(await (await fetch(url + '/')).text())?.[1];
    const h = await (await fetch(url + '/api/health', { headers: { 'x-floorplan-token': t } })).json();
    assert.equal(h.cli, false);
    assert.equal(h.engine, null);
    assert.equal(h.want, 'antigravity', 'the map keeps naming Antigravity, and Ask says the Antigravity CLI is needed');
  } finally {
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  }
});

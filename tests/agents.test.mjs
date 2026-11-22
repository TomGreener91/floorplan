// Antigravity, Claude Code and Codex: the skill notices which one is running it, and the map remembers, so its
// Ask bar and "Fix with …" prompts name the right one. Claude Code gets the CLAUDE.local.md note and Antigravity
// an uncommitted workspace rule; Codex gets neither. This fork assumes Antigravity when it can't tell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lib, shopApp, run, readGraph, readJson, cleanup } from './helpers.mjs';

const { detectAgent, cliLabel } = await lib('agent.mjs');

test('Codex is recognised by the variables it sets for every command', () => {
  assert.equal(detectAgent({}, { CODEX_THREAD_ID: 'abc' }), 'codex');
  assert.equal(detectAgent({}, { CODEX_SESSION_ID: 'abc' }), 'codex');
  assert.equal(detectAgent({}, {}), 'antigravity');
  assert.equal(detectAgent({}, { CLAUDECODE: '1' }), 'claude');
  assert.equal(detectAgent({}, { CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude');
  assert.equal(detectAgent({}, { CLAUDECODE: '1', CODEX_THREAD_ID: 'abc' }), 'claude');
  assert.equal(detectAgent({}, { ANTIGRAVITY_CONVERSATION_ID: 'abc' }), 'antigravity');
});

test('--agent and FLOORPLAN_AGENT override the guess, and nonsense is ignored', () => {
  assert.equal(detectAgent({ agent: 'codex' }, {}), 'codex');
  assert.equal(detectAgent({ agent: 'Claude' }, { CODEX_THREAD_ID: 'abc' }), 'claude');
  assert.equal(detectAgent({}, { FLOORPLAN_AGENT: 'codex' }), 'codex');
  assert.equal(detectAgent({ agent: 'antigravity' }, { CLAUDECODE: '1' }), 'antigravity');
  assert.equal(detectAgent({}, { FLOORPLAN_AGENT: 'Antigravity', CLAUDECODE: '1' }), 'antigravity');
  assert.equal(detectAgent({ agent: 'gpt' }, { CODEX_THREAD_ID: 'abc' }), 'codex');
});

test('a map built under Codex records it, and leaves the project notes alone', () => {
  const root = shopApp();
  try {
    run('scan.mjs', root);
    const out = run('build.mjs', root, '--agent', 'codex');
    assert.equal(readGraph(root).meta.agent, 'codex');
    assert.match(out, /AGENT {2}Codex/);
    assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.local.md')), 'no CLAUDE.local.md');
    assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')), 'no AGENTS.md');
  } finally { cleanup(root); }
});

test('a map built under Claude Code records it, and adds the CLAUDE.local.md note only when asked', () => {
  const root = shopApp();
  const notes = path.join(root, 'CLAUDE.local.md');
  try {
    run('scan.mjs', root);
    assert.match(run('build.mjs', root, '--agent', 'claude'), /CLAUDE\.LOCAL\.MD {2}not added/);
    assert.equal(readGraph(root).meta.agent, 'claude');
    assert.ok(!fs.existsSync(notes), 'no CLAUDE.local.md until the user says yes');
    run('build.mjs', root, '--agent', 'claude', '--claude-md');
    assert.match(fs.readFileSync(notes, 'utf8'), /floorplan\/query\.mjs/);
  } finally { cleanup(root); }
});

test('a CLAUDE.local.md note that already exists is kept current, and the opt-out marker still wins', () => {
  const root = shopApp();
  const notes = path.join(root, 'CLAUDE.local.md');
  try {
    run('scan.mjs', root);
    fs.writeFileSync(notes, 'my notes\n\n<!-- floorplan:start -->\nold\n<!-- floorplan:end -->\n');
    run('build.mjs', root, '--agent', 'claude');
    const text = fs.readFileSync(notes, 'utf8');
    assert.match(text, /^my notes/);
    assert.match(text, /floorplan\/query\.mjs/);
    assert.doesNotMatch(text, /\nold\n/);
    fs.writeFileSync(notes, 'my notes\n<!-- floorplan:off -->\n');
    assert.match(run('build.mjs', root, '--agent', 'claude', '--claude-md'), /CLAUDE\.LOCAL\.MD {2}skipped \(opted out\)/);
    assert.equal(fs.readFileSync(notes, 'utf8'), 'my notes\n<!-- floorplan:off -->\n');
  } finally { cleanup(root); }
});

test('the copy for the Claude app always says Claude, whoever built the map', () => {
  const root = shopApp();
  try {
    run('scan.mjs', root);
    run('build.mjs', root, '--agent', 'codex', '--artifact', '--no-claude-md');
    const html = fs.readFileSync(path.join(root, 'floorplan', 'artifact.html'), 'utf8');
    assert.match(html, /"agent":"claude"/);
    assert.equal(readJson(path.join(root, 'floorplan', 'graph.json')).meta.agent, 'codex');
  } finally { cleanup(root); }
});

test("open.mjs names the program that answers questions, even when another one answers to the claude command (#95)", () => {
  assert.equal(cliLabel('claude', '2.0.14 (Claude Code)'), 'the Claude Code CLI');
  assert.equal(cliLabel('claude', ''), 'the Claude Code CLI');
  assert.equal(cliLabel('codex', 'codex-cli 0.46.0'), 'Codex');
  assert.equal(cliLabel('antigravity', 'agy version 1.4.10'), 'the Antigravity CLI');
  assert.equal(cliLabel('antigravity', 'antigravity 2.0.0'), 'the Antigravity CLI');
  assert.equal(cliLabel('antigravity', 'othertool v1.2.0'), 'othertool, found as the agy command');
  // a wrapper installed as `claude` says what it is in its --version
  assert.equal(cliLabel('claude', 'devin 3000.11.238'), 'devin, found as the claude command');
  assert.equal(cliLabel('codex', 'othertool v1.2.0'), 'othertool, found as the codex command');
  // text that isn't a program and its version leaves the usual name
  assert.equal(cliLabel('claude', 'unknown'), 'the Claude Code CLI');
});

test('a map built under Antigravity records it, and adds the workspace rule only when asked', () => {
  const root = shopApp();
  const rule = path.join(root, '.agents', 'rules', 'floorplan.md');
  try {
    run('scan.mjs', root);
    const out = run('build.mjs', root, '--agent', 'antigravity');
    assert.equal(readGraph(root).meta.agent, 'antigravity');
    assert.match(out, /AGENT {2}Antigravity/);
    assert.match(out, /ANTIGRAVITY RULE {2}not added/);
    assert.doesNotMatch(out, /CLAUDE\.LOCAL\.MD/);
    assert.ok(!fs.existsSync(rule), 'no rule until the user says yes');
    assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.local.md')), 'no CLAUDE.local.md');
    run('build.mjs', root, '--agent', 'antigravity', '--agy-rule');
    const text = fs.readFileSync(rule, 'utf8');
    assert.match(text, /^---\ntrigger: always_on\ndescription: "/, 'a valid always-on rule');
    assert.match(text, /floorplan\/query\.mjs/);
    assert.match(text, /run these from the project root/);
    // a rule that exists is kept current on later builds, without the flag
    fs.writeFileSync(rule, text.replace('query.mjs overview', 'query.mjs stale'));
    run('build.mjs', root, '--agent', 'antigravity');
    assert.equal(fs.readFileSync(rule, 'utf8'), text);
  } finally { cleanup(root); }
});

test('the Antigravity rule can be opted out of, and --no-claude-md leaves it alone too', () => {
  const root = shopApp();
  const rule = path.join(root, '.agents', 'rules', 'floorplan.md');
  try {
    run('scan.mjs', root);
    assert.doesNotMatch(run('build.mjs', root, '--agent', 'antigravity', '--agy-rule', '--no-claude-md'), /ANTIGRAVITY RULE/);
    assert.ok(!fs.existsSync(rule));
    fs.mkdirSync(path.dirname(rule), { recursive: true });
    fs.writeFileSync(rule, 'mine\n<!-- floorplan:off -->\n');
    assert.match(run('build.mjs', root, '--agent', 'antigravity', '--agy-rule'), /ANTIGRAVITY RULE {2}skipped \(opted out\)/);
    assert.equal(fs.readFileSync(rule, 'utf8'), 'mine\n<!-- floorplan:off -->\n');
  } finally { cleanup(root); }
});

test('the map page names Antigravity in its prompts when Antigravity built it', () => {
  const root = shopApp();
  try {
    run('scan.mjs', root);
    run('build.mjs', root, '--agent', 'antigravity');
    const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
    assert.match(html, /"agent":"antigravity"/);
    assert.match(html, /id: 'antigravity', name: 'Antigravity', app: 'Antigravity'/);
  } finally { cleanup(root); }
});

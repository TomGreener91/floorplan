// What depends on what in a Vue app: imports through the @/ alias, components registered once for every
// template (app.component, a glob of them, unplugin-vue-components), loops of files that import each other
// (in Health, in query.mjs and in the map's Dependencies view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, makeProject, run, readGraph, readJson, cleanup } from './helpers.mjs';

const ARCH = {
  project: { name: 'Waypoint', summary: 'A Vue app.' },
  nodes: [
    { id: 'web', label: 'Website', kind: 'ui', summary: 'The Vue app.', paths: ['src/**', '*.ts'] },
    { id: 'web.components', parent: 'web', label: 'Components', kind: 'feature', paths: ['src/components/**'] },
    { id: 'web.views', parent: 'web', label: 'Pages', kind: 'feature', paths: ['src/views/**'] },
  ],
};
const VUE_APP = {
  'package.json': JSON.stringify({ name: 'waypoint', dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^5.0.0' } }),
  // create-vue's tsconfig: the root one only points at the others, and tsconfig.app.json has the @ alias
  'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }] }),
  'tsconfig.node.json': JSON.stringify({ compilerOptions: { types: ['node'] } }),
  'tsconfig.app.json': JSON.stringify({ extends: '@vue/tsconfig/tsconfig.dom.json', compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
  'src/main.ts': [
    "import { createApp } from 'vue';",
    "import App from './App.vue';",
    "import AppIcon from './components/AppIcon.vue';",
    'const app = createApp(App);',
    "app.component('AppIcon', AppIcon);",
    "const base = import.meta.glob('./components/base/*.vue', { eager: true });",
    "for (const [file, mod] of Object.entries(base)) app.component(file.split('/').pop().replace('.vue', ''), mod.default);",
    "app.mount('#app');",
  ].join('\n'),
  'src/App.vue': "<script setup lang=\"ts\">\nimport NavBar from '@/components/NavBar.vue';\n</script>\n<template><NavBar /><router-view /></template>\n",
  'src/components/NavBar.vue': "<script setup lang=\"ts\">\nimport UserMenu from './UserMenu.vue';\n</script>\n<template><nav><AppIcon name=\"home\" /><user-menu /><BaseButton>Go</BaseButton></nav></template>\n",
  'src/components/UserMenu.vue': "<script setup lang=\"ts\">\nimport NavBar from './NavBar.vue';\n</script>\n<template><div><app-icon name=\"user\" /><NavBar v-if=\"false\" /></div></template>\n",
  'src/components/AppIcon.vue': '<script setup lang="ts">\ndefineProps<{ name: string }>();\n</script>\n<template><svg><use :href="`#${name}`" /></svg></template>\n',
  'src/components/base/BaseButton.vue': '<template><button class="btn"><AppIcon name="go" /><slot /></button></template>\n',
  'src/views/HomeView.vue': '<template><main><AppIcon name="star" /><BaseButton>Start</BaseButton></main></template>\n',
  // a page with a local component of the same name: its own import wins over the global one
  'src/views/AboutView.vue': "<script setup>\nimport AppIcon from '../components/AboutIcon.vue';\n</script>\n<template><AppIcon /></template>\n",
  'src/components/AboutIcon.vue': '<template><i /></template>\n',
};
const linkSet = (g) => new Set(g.links.filter((l) => l.a.startsWith('f:') && l.b.startsWith('f:')).map((l) => `${l.a.slice(2)} -> ${l.b.slice(2)}`));
const build = (root) => { run('scan.mjs', root); return run('build.mjs', root, '--agent', 'antigravity', '--no-claude-md'); };

test('@/ imports reach the file, through a tsconfig that only references the one with the alias', () => {
  const root = makeProject(VUE_APP, { arch: ARCH });
  try {
    build(root);
    const links = linkSet(readGraph(root));
    assert.ok(links.has('src/App.vue -> src/components/NavBar.vue'), [...links].join('\n'));
    const scan = readJson(path.join(root, 'floorplan', '.cache', 'scan.json'));
    assert.ok(!scan.externals?.some?.((e) => /@\/components/.test(JSON.stringify(e))), 'not an outside package');
  } finally { cleanup(root); }
});

test('@/ means src/ even with no alias set up anywhere, since it can never be an npm package', () => {
  const root = makeProject({
    'package.json': JSON.stringify({ name: 'bare', dependencies: { vue: '^3.5.0' } }),
    'src/App.vue': "<script setup>\nimport Card from '@/components/Card.vue';\nimport { fmt } from '~/utils/fmt';\n</script>\n<template><Card /></template>\n",
    'src/components/Card.vue': '<template><div /></template>\n',
    'src/utils/fmt.ts': 'export const fmt = (x) => String(x);\n',
  }, { arch: { project: { name: 'Bare' }, nodes: [{ id: 'web', label: 'Website', kind: 'ui', paths: ['src/**'] }] } });
  try {
    build(root);
    const links = linkSet(readGraph(root));
    assert.ok(links.has('src/App.vue -> src/components/Card.vue'));
    assert.ok(links.has('src/App.vue -> src/utils/fmt.ts'));
  } finally { cleanup(root); }
});

test('components registered for every template are linked to the templates that use them', () => {
  const root = makeProject(VUE_APP, { arch: ARCH });
  try {
    const out = run('scan.mjs', root);
    assert.match(out, /VUE {2}\d+ file\(s\) linked to what they use without importing it: \d+ globally registered component\(s\)/);
    run('build.mjs', root, '--agent', 'antigravity', '--no-claude-md');
    const links = linkSet(readGraph(root));
    for (const from of ['src/components/NavBar.vue', 'src/components/UserMenu.vue', 'src/components/base/BaseButton.vue', 'src/views/HomeView.vue']) {
      assert.ok(links.has(`${from} -> src/components/AppIcon.vue`), `${from} uses AppIcon (app.component, <AppIcon> and <app-icon>)`);
    }
    assert.ok(links.has('src/views/HomeView.vue -> src/components/base/BaseButton.vue'), 'registered through import.meta.glob');
    assert.ok(links.has('src/views/AboutView.vue -> src/components/AboutIcon.vue'));
    assert.ok(!links.has('src/views/AboutView.vue -> src/components/AppIcon.vue'), 'a component the file imports itself wins');
  } finally { cleanup(root); }
});

test("unplugin-vue-components' components.d.ts links templates to components with no import or registration", () => {
  const root = makeProject({
    'package.json': JSON.stringify({ name: 'auto', dependencies: { vue: '^3.5.0' }, devDependencies: { 'unplugin-vue-components': '^0.27.0' } }),
    'components.d.ts': [
      'export {}',
      "declare module 'vue' {",
      '  export interface GlobalComponents {',
      "    AppIcon: typeof import('./src/components/AppIcon.vue')['default']",
      "    RouterView: typeof import('vue-router')['RouterView']",
      '  }',
      '}',
    ].join('\n'),
    // unplugin-auto-import: composables and stores used with no import line
    'src/auto-imports.d.ts': [
      'export {}',
      'declare global {',
      "  const isDark: typeof import('./composables/dark')['isDark']",
      "  const toggleDark: typeof import('./composables/dark').toggleDark",
      "  const useUserStore: typeof import('./stores/user')['useUserStore']",
      "  const ref: typeof import('vue')['ref']",
      '}',
    ].join('\n'),
    'src/App.vue': '<template><AppIcon /><RouterView /><p v-if="isDark">dark</p></template>\n',
    'src/components/AppIcon.vue': '<script setup>\nconst user = useUserStore();\n</script>\n<template><svg @click="toggleDark()" /></template>\n',
    'src/composables/dark.ts': 'export const isDark = false;\nexport function toggleDark() {}\n',
    'src/stores/user.ts': 'export const useUserStore = () => ({});\n',
  }, { arch: { project: { name: 'Auto' }, nodes: [{ id: 'web', label: 'Website', kind: 'ui', paths: ['src/**', '*.ts'] }] } });
  try {
    build(root);
    const g = readGraph(root);
    const links = linkSet(g);
    assert.ok(links.has('src/App.vue -> src/components/AppIcon.vue'));
    assert.ok(links.has('src/App.vue -> src/composables/dark.ts'), 'used by name in a template');
    assert.ok(links.has('src/components/AppIcon.vue -> src/composables/dark.ts'), 'called in a template');
    assert.ok(links.has('src/components/AppIcon.vue -> src/stores/user.ts'), 'called in the script');
    // the generated lists aren't users of every component in the Dependencies view
    const q = JSON.parse(execFileSync(process.execPath, [path.join(root, 'floorplan', 'query.mjs'), 'deps', 'AppIcon.vue'], { encoding: 'utf8' }));
    assert.deepEqual(q.usedBy.shown.map((x) => x.id), ['f:src/App.vue']);
  } finally { cleanup(root); }
});

test('Health reports files that import each other in a loop, with a refactor prompt', () => {
  const root = makeProject(VUE_APP, { arch: ARCH });
  try {
    build(root);
    const issue = readGraph(root).health.issues.find((i) => i.kind === 'import-cycle');
    assert.ok(issue, 'an import-loop issue');
    assert.equal(issue.title, 'Two files import each other');
    assert.equal(issue.severity, 'low');
    assert.deepEqual(issue.loops, [['src/components/NavBar.vue', 'src/components/UserMenu.vue']]);
    assert.deepEqual(issue.items.sort(), ['f:src/components/NavBar.vue', 'f:src/components/UserMenu.vue']);
    assert.match(issue.fix, /src\/components\/NavBar\.vue → src\/components\/UserMenu\.vue → src\/components\/NavBar\.vue/);
    assert.match(issue.fix, /provide\/inject/);
  } finally { cleanup(root); }
});

test('the loop finder: groups, the shortest loop through each, and tests left out', async () => {
  const { importLoops } = await import('../skills/floorplan/scripts/lib/health.mjs');
  const L = (a, b, k = 'import') => ({ a: 'f:' + a, b: 'f:' + b, k });
  const links = [L('a', 'b'), L('b', 'c'), L('c', 'a'), L('c', 'd'), L('d', 'e'), L('x', 'y'), L('y', 'x'), L('a', 'a'), L('t.test.ts', 'a'), L('a', 't.test.ts'), L('a', 'r', 'http'), L('r', 'a', 'http')];
  const loops = importLoops(links, (p) => !/\.test\./.test(p));
  assert.deepEqual(loops.map((l) => l.files), [['a', 'b', 'c'], ['x', 'y']]);
  assert.deepEqual(loops[0].path, ['a', 'b', 'c']);
  assert.deepEqual(importLoops([]), []);
  // a long chain doesn't run out of stack
  const chain = Array.from({ length: 20000 }, (_, i) => L('m' + i, 'm' + (i + 1)));
  chain.push(L('m20000', 'm0'));
  assert.equal(importLoops(chain)[0].files.length, 20001);
});

// graph-query.js is a plain script (no exports): this hands back its createGraphQuery
const loadGraphQuery = () => new Function(`${fs.readFileSync(path.join(REPO, 'skills', 'floorplan', 'assets', 'graph-query.js'), 'utf8')}\nreturn createGraphQuery;`)();

test('Health and the Dependencies view leave the same files out of loops, so they list the same loops', async () => {
  const { importLoops, loopKeep } = await import('../skills/floorplan/scripts/lib/health.mjs');
  const pairs = [
    ['src/a.ts', 'src/b.ts'], // the one real loop
    ['src/mocks/m1.ts', 'src/mocks/m2.ts'], ['tests/fixtures/f1.ts', 'tests/fixtures/f2.ts'], ['cypress/support/c1.ts', 'cypress/support/c2.ts'],
    ['pkg/x.go', 'pkg/x_test.go'], ['app/test_views.py', 'app/views.py'], ['app/conftest.py', 'app/models.py'],
    ['src/c.e2e.ts', 'src/d.ts'], ['src/types.d.ts', 'src/e.ts'], ['qa/h1.ts', 'qa/h2.ts'], // qa is a part of kind "test"
  ];
  const paths = [...new Set(pairs.flat())];
  const G = {
    nodes: [{ id: 'app', kind: 'ui', label: 'App' }, { id: 'qa', kind: 'test', label: 'Checks' }],
    files: paths.map((p) => ({ p, n: p.startsWith('qa/') ? 'qa' : 'app', name: p.split('/').pop() })),
    links: pairs.flatMap(([a, b]) => [{ a: 'f:' + a, b: 'f:' + b, k: 'import' }, { a: 'f:' + b, b: 'f:' + a, k: 'import' }]),
  };
  const health = importLoops(G.links, loopKeep(G)).map((l) => l.files);
  const map = loadGraphQuery()(G).fileLinks().loops.map((l) => l.files);
  assert.deepEqual(health, [['src/a.ts', 'src/b.ts']]);
  assert.deepEqual(map, health);
});

test("the Dependencies view: a part is offered only when it connects outside, and one picked side never leaves it empty", () => {
  const html = fs.readFileSync(path.join(REPO, 'skills', 'floorplan', 'assets', 'viewer.html'), 'utf8');
  const code = html.slice(html.indexOf('// ======================= dependencies'), html.indexOf('function buildView(container)'));
  const G = {
    nodes: [{ id: 'iso', kind: 'feature', label: 'Island' }, { id: 'lib', kind: 'feature', label: 'Library' }, { id: 'ui', kind: 'ui', label: 'Pages' }],
    files: [['iso/i1.ts', 'iso'], ['iso/i2.ts', 'iso'], ['lib/l1.ts', 'lib'], ['lib/l2.ts', 'lib'], ['ui/u1.ts', 'ui']].map(([p, n]) => ({ p, n, name: p.split('/').pop() })),
    links: [['iso/i1.ts', 'iso/i2.ts'], ['iso/i2.ts', 'iso/i1.ts'], ['lib/l2.ts', 'lib/l1.ts'], ['ui/u1.ts', 'lib/l1.ts']].map(([a, b]) => ({ a: 'f:' + a, b: 'f:' + b, k: 'import' })),
  };
  const files = new Map(G.files.map((f) => [f.p, f]));
  const nodes = new Map(G.nodes.map((n) => [n.id, n]));
  const env = {
    G, files, nodes, createGraphQuery: loadGraphQuery(),
    store: { get: (k, d) => d, set: () => {} }, clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    chain: (id) => (id.startsWith('f:') ? [id, 'n:' + files.get(id.slice(2)).n] : [id]),
    info: (id) => ({ name: id.startsWith('n:') ? nodes.get(id.slice(2)).label : files.get(id.slice(2)).name, desc: '' }),
    plural: (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`,
  };
  const dep = new Function(...Object.keys(env), `${code}\nreturn { DEP, depAble, buildDepsView };`)(...Object.values(env));
  // Island's files only import each other: nothing to show, so it isn't offered
  assert.equal(dep.depAble('n:iso'), false);
  assert.equal(dep.depAble('n:lib'), true);
  dep.DEP.dir = 'both';
  assert.deepEqual(dep.buildDepsView('dep:n:lib').visible.sort(), ['f:lib/l1.ts', 'f:ui/u1.ts']);
  // Library uses nothing outside it: with only "Uses" picked, its files used from outside still show
  dep.DEP.dir = 'out';
  assert.deepEqual(dep.buildDepsView('dep:n:lib').visible, ['f:lib/l1.ts']);
});

test('query.mjs deps and loops: what a file uses and what uses it, by path or just its name', () => {
  const root = makeProject(VUE_APP, { arch: ARCH });
  try {
    build(root);
    const q = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'floorplan', 'query.mjs'), ...args], { encoding: 'utf8' }));
    const d = q('deps', 'AppIcon.vue', '--depth', '2');
    assert.equal(d.file.id, 'f:src/components/AppIcon.vue');
    assert.deepEqual(d.usedBy.shown.filter((x) => x.steps === 1).map((x) => x.id).sort(), ['f:src/components/NavBar.vue', 'f:src/components/UserMenu.vue', 'f:src/components/base/BaseButton.vue', 'f:src/main.ts', 'f:src/views/HomeView.vue']);
    assert.ok(d.usedBy.shown.some((x) => x.id === 'f:src/App.vue' && x.steps === 2), 'App uses NavBar, which uses AppIcon');
    assert.deepEqual(d.uses.shown, []);
    assert.equal(d.loop, undefined);
    const nav = q('deps', 'src/components/NavBar.vue', '--depth', '1');
    assert.deepEqual(nav.loop.path, ['f:src/components/NavBar.vue', 'f:src/components/UserMenu.vue', 'f:src/components/NavBar.vue']);
    assert.ok(nav.uses.shown.find((x) => x.id === 'f:src/components/UserMenu.vue').inLoopWithThis);
    assert.deepEqual(q('loops'), [{ files: 2, path: ['f:src/components/NavBar.vue', 'f:src/components/UserMenu.vue', 'f:src/components/NavBar.vue'] }]);
    assert.match(fs.readFileSync(path.join(root, 'floorplan', 'query.mjs'), 'utf8'), /deps <file>/);
  } finally { cleanup(root); }
});

test('the map has the Dependencies view, and Ask and the notes mention the new lookups', () => {
  const root = makeProject(VUE_APP, { arch: ARCH });
  try {
    build(root);
    const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
    assert.match(html, /\/\* ui\/35-deps\.js \*\//);
    assert.match(html, /id: 'deps-btn', label: 'Dependencies'/);
    // drawn by the map itself: its own cards, lines and column brackets, one column per step
    assert.match(html, /function buildDepsView\(container\)/);
    assert.match(html, /'elk\.partitioning\.activate': 'true'/);
    assert.match(html, /if \(isDep\(container\)\) return buildDepsView\(container\);/);
    // the search finds import loops, and Shift+Enter opens a file's or part's dependencies
    assert.match(html, /id: 'dep:loop:' \+ i/);
    assert.match(html, /pick\(sActive, ev\.shiftKey\)/);
    assert.match(html, /<span class="kbd">⇧↵<\/span> dependencies/);
    // in the Dependencies view what a file uses is on the left by default, and Swap sides puts "used by" there
    assert.match(html, /usesLeft: store\.get\('dep-side', 'uses-left'\) !== 'usedby-left'/);
    assert.match(html, /data-dpswap/);
    assert.match(html, /sources: \[e\.b\], targets: \[e\.a\]/);
    // All files: a searchable, sortable list of every file, as a view of its own
    assert.match(html, /if \(state\.container === 'list:files'\) \{ renderListView\(opts\); return; \}/);
    assert.match(html, /function fileKind\(f\)/);
    assert.match(html, /<div id="listview" hidden><\/div>/);
    assert.match(html, /allFiles: \(\) => go\('list:files'\)/);
    // the right-click menu and the D key
    assert.match(html, /label: 'Show dependencies', icon: 'deps'/);
    assert.match(html, /ev\.key === 'd' \|\| ev\.key === 'D'/);
    assert.match(html, /query\.mjs deps <file>/, 'the Ask instructions');
    run('build.mjs', root, '--agent', 'antigravity', '--agy-rule');
    assert.match(fs.readFileSync(path.join(root, '.agents', 'rules', 'floorplan.md'), 'utf8'), /query\.mjs deps <file>/);
  } finally { cleanup(root); }
});

// Vue components used with no import line, outside Nuxt (lib/nuxt.mjs has Nuxt's own). A Vue app can register
// components once for every template:
//   - app.component('AppIcon', AppIcon) or app.component('AppIcon', defineAsyncComponent(() => import('./AppIcon.vue')))
//   - a folder at a time: import.meta.glob('./components/base/*.vue') (or webpack's require.context) in a file
//     that also calls .component(...), each registered under its file name
//   - unplugin-vue-components, which writes the name → file list to components.d.ts
// Templates then use <AppIcon /> or <app-icon /> with no import, so following imports alone leaves those
// components connected only to the file that registered them. This links each template to the components it
// uses that way. unplugin-auto-import does the same for functions (composables, stores, utils), listed in
// auto-imports.d.ts: a file calling toggleDark() is linked to the file that exports it.
// Matching is by name, so a name the file defines or imports itself is left alone.
import fs from 'node:fs';
import path from 'node:path';
import { componentName } from './nuxt.mjs';

const posix = path.posix;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_LIST_BYTES = 4 * 1024 * 1024;
const NUXT_CONFIG = /(^|\/)nuxt\.config\.(ts|js|mjs|cjs|mts)$/;
const SCRIPT = /\.(ts|js|mjs|mts|cjs|cts|tsx|jsx|vue)$/;
const words = (s) => s.split(/[-_./\s]+/).flatMap((w) => w.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) || []);
const pascal = (s) => words(s).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const stem = (p) => posix.basename(p).replace(/\.[^.]+$/, '');

function read(root, f) {
  if (!f.bytes || f.bytes > MAX_SOURCE_BYTES || f.tooLarge) return null;
  try { return fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { return null; }
}

/** Code without comments (block, line and HTML). */
const uncomment = (src) => src
  .replace(/<!--[\s\S]{0,100000}?-->/g, ' ')
  .replace(/\/\*[\s\S]{0,100000}?\*\//g, ' ')
  .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

/** A glob from import.meta.glob / require.context, as a test for scanned paths. `@/` is src/ and `/` the root. */
function globTest(fromDir, pattern) {
  const full = pattern.startsWith('@/') ? 'src/' + pattern.slice(2) : pattern.startsWith('/') ? pattern.slice(1) : posix.join(fromDir, pattern);
  const abs = posix.normalize(full);
  if (abs.startsWith('..')) return null;
  const segs = abs.split('/');
  let re = '';
  segs.forEach((seg, i) => {
    if (seg === '**') { re += '(?:[^/]+/)*'; return; }
    re += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (i === segs.length - 1 ? '' : '/');
  });
  try { return new RegExp('^' + re + '$'); } catch { return null; }
}

/** Names a file defines or imports itself, which win over a global registration of the same name. */
function ownNames(code) {
  const own = new Set();
  for (const m of code.matchAll(/\b(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) own.add(m[1]);
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([^'";]{0,5000}?)\s+from\s+['"]/g)) for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) || []) own.add(n);
  // Options API: components: { Icon: AppIcon }
  for (const m of code.matchAll(/\bcomponents\s*:\s*\{([^}]{0,5000})\}/g)) for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) || []) own.add(n);
  return own;
}

/** The name → file registry for the Vue app outside Nuxt: global registrations and components.d.ts. */
function registry(root, files, edgesFrom, inNuxt) {
  const known = new Set(files.map((f) => f.path));
  const byStem = new Map(); // a file's imports by the last part of their path, to find what an identifier is
  const reg = new Map();
  const add = (name, to) => { if (name && to && known.has(to) && !reg.has(name)) reg.set(name, to); };
  for (const f of files) {
    if (inNuxt(f.path) || f.category !== 'code' || !SCRIPT.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
    const src = read(root, f);
    if (!src || !/\.component\s*\(/.test(src)) continue;
    const code = uncomment(src);
    const dir = posix.dirname(f.path);
    const imported = edgesFrom.get(f.path) || [];
    const fileFor = (ident, spec) => {
      if (spec) { const s = stem(spec); return imported.find((to) => stem(to) === s) || null; }
      // import AppIcon from './components/AppIcon.vue': the identifier names the import
      const m = new RegExp(`\\bimport\\s+${ident.replace(/\$/g, '\\$')}\\s+from\\s+['"]([^'"\\n]{1,500})['"]`).exec(code);
      if (m) { const s = stem(m[1]); return imported.find((to) => stem(to) === s) || null; }
      return imported.find((to) => stem(to) === ident) || null;
    };
    // app.component('AppIcon', AppIcon) / Vue.component('app-icon', AppIcon) / app.component('AppIcon', defineAsyncComponent(() => import('./AppIcon.vue')))
    for (const m of code.matchAll(/\.component\s*\(\s*['"`]([A-Za-z][\w-]{0,200})['"`]\s*,\s*([^)]{0,500})/g)) {
      const name = m[1].includes('-') ? pascal(m[1]) : m[1];
      const spec = /import\s*\(\s*['"]([^'"\n]{1,500})['"]/.exec(m[2])?.[1];
      const ident = /^\s*([A-Za-z_$][\w$]*)\s*[,)]?/.exec(m[2])?.[1];
      const to = spec ? fileFor(null, spec) : ident ? fileFor(ident) : null;
      add(name, to);
    }
    // a folder at a time, named after each file
    const globs = [...code.matchAll(/import\.meta\.glob(?:Eager)?\s*\(\s*(\[[^\]]{0,2000}\]|['"`][^'"`\n]{1,500}['"`])/g)].flatMap((m) => [...m[1].matchAll(/['"`]([^'"`\n]{1,500})['"`]/g)].map((x) => x[1]))
      .filter((g) => !g.startsWith('!'));
    for (const m of code.matchAll(/require\.context\s*\(\s*['"`]([^'"`\n]{1,500})['"`]\s*(?:,\s*(true|false))?/g)) globs.push(posix.join(m[1], m[2] === 'true' ? '**/*.vue' : '*.vue'));
    for (const g of globs) {
      const test = globTest(dir, g);
      if (!test) continue;
      for (const p of known) if (/\.vue$/.test(p) && test.test(p)) add(pascal(stem(p)), p);
    }
  }
  // unplugin-vue-components: GlobalComponents { AppIcon: typeof import('./src/components/AppIcon.vue')['default'] }
  for (const f of files) {
    if (posix.basename(f.path) !== 'components.d.ts' || inNuxt(f.path) || /(^|\/)\.nuxt\//.test(f.path)) continue;
    let list;
    try { const st = fs.statSync(path.join(root, f.path)); if (st.size > MAX_LIST_BYTES) continue; list = fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { continue; }
    const dir = posix.dirname(f.path);
    for (const m of list.matchAll(/['"]?([A-Z][\w$]{0,200})['"]?\s*:\s*(?:\w{1,60}<\s*)?typeof\s+import\(\s*["'](\.{1,2}\/[^"'\n]{1,500})["']\s*\)/g)) {
      add(m[1], posix.normalize(posix.join(dir, m[2])));
    }
  }
  return reg;
}

const TRY_EXT = ['', '.ts', '.js', '.mts', '.mjs', '.tsx', '.jsx', '.vue', '/index.ts', '/index.js'];
/** unplugin-auto-import: const toggleDark: typeof import('./composables/dark')['toggleDark'] (or .toggleDark). */
function autoImported(root, files, inNuxt) {
  const known = new Set(files.map((f) => f.path));
  const fns = new Map();
  for (const f of files) {
    if (posix.basename(f.path) !== 'auto-imports.d.ts' || inNuxt(f.path) || /(^|\/)\.nuxt\//.test(f.path)) continue;
    let list;
    try { const st = fs.statSync(path.join(root, f.path)); if (st.size > MAX_LIST_BYTES) continue; list = fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { continue; }
    const dir = posix.dirname(f.path);
    for (const m of list.matchAll(/\bconst\s+([A-Za-z_$][\w$]{0,200})\s*:\s*typeof\s+import\(\s*['"](\.{1,2}\/[^'"\n]{1,500})['"]\s*\)/g)) {
      if (fns.has(m[1])) continue;
      const basePath = posix.normalize(posix.join(dir, m[2]));
      const to = TRY_EXT.map((e) => basePath + e).find((c) => known.has(c));
      if (to) fns.set(m[1], to);
    }
  }
  return fns;
}

/**
 * Links from .vue files outside Nuxt apps to the globally registered components their templates use.
 * edges: the import links found so far ({ from, to }), to tell which file an identifier came from.
 * Returns { edges: [{ from, to, names }], components, files }.
 */
export function vueGlobalComponents(root, files, edges) {
  if (!files.some((f) => f.lang === 'vue' || /\.vue$/.test(f.path))) return { edges: [], components: 0, files: 0 };
  const nuxtDirs = files.filter((f) => NUXT_CONFIG.test(f.path)).map((f) => (posix.dirname(f.path) === '.' ? '' : posix.dirname(f.path)));
  const inNuxt = (p) => nuxtDirs.some((d) => !d || p.startsWith(d + '/'));
  if (nuxtDirs.includes('')) return { edges: [], components: 0, files: 0 }; // the whole codebase is one Nuxt app
  const edgesFrom = new Map();
  for (const e of edges) { if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []); edgesFrom.get(e.from).push(e.to); }
  const reg = registry(root, files, edgesFrom, inNuxt);
  const fns = autoImported(root, files, inNuxt);
  if (!reg.size && !fns.size) return { edges: [], components: 0, functions: 0, files: 0 };
  const out = [];
  let linked = 0;
  for (const f of files) {
    if (inNuxt(f.path) || f.category !== 'code' || !SCRIPT.test(f.path) || /\.d\.[cm]?ts$/.test(f.path)) continue;
    if (!/\.vue$/.test(f.path) && !fns.size) continue;
    const src = read(root, f);
    if (!src) continue;
    const code = uncomment(src);
    const template = /\.vue$/.test(f.path) ? /<template\b[\s\S]*<\/template>/.exec(code)?.[0] || '' : '';
    const own = ownNames(code);
    const uses = new Map();
    const use = (name, to) => { if (!to || to === f.path) return; if (!uses.has(to)) uses.set(to, new Set()); uses.get(to).add(name); };
    if (reg.size) for (const m of template.matchAll(/<([A-Za-z][\w-]{0,200})(?=[\s/>])/g)) {
      const tag = m[1];
      if (!/[A-Z]/.test(tag[0]) && !tag.includes('-')) continue; // a plain HTML element
      const name = tag.includes('-') ? pascal(tag) : tag;
      if (own.has(name)) continue;
      use(name, reg.get(name));
    }
    // auto-imported functions: called anywhere, or used by name in a template (isDark)
    if (fns.size) {
      for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]{0,200})\s*\(/g)) if (fns.has(m[1]) && !own.has(m[1])) use(m[1], fns.get(m[1]));
      if (template) for (const m of template.matchAll(/(?<![\w$.<\/-])([A-Za-z_$][\w$]{0,200})(?![\w$-])/g)) if (fns.has(m[1]) && !own.has(m[1])) use(m[1], fns.get(m[1]));
    }
    for (const [to, names] of uses) out.push({ from: f.path, to, names: [...names].sort() });
    if (uses.size) linked++;
  }
  return { edges: out, components: reg.size, functions: fns.size, files: linked };
}

export { componentName };

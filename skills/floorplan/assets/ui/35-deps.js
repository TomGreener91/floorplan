// Dependencies lens: pick a file or component and see what uses it (left) and what it uses (right), a few
// steps out, grouped by part of the app. Lines point from the file that imports to the file it uses; lines
// inside a loop of files that import each other are red. With nothing picked, it lists those loops and the
// files most others depend on. Data: the map's file → file links (graph-query.js fileLinks).
(() => {
  const SC = window.Floorplan;
  if (!SC || !SC.query.fileLinks) return;
  const G = SC.graph, Q = SC.query;
  const { out, inn, loops, loopOf } = Q.fileLinks();
  if (!out.size) return; // no file → file links: nothing to show
  const { h, hk, iconI } = SC;
  const fileBy = new Map(G.files.map((f) => [f.p, f]));
  const nodeBy = new Map(G.nodes.map((n) => [n.id, n]));
  const partLabel = (nid) => nodeBy.get(nid)?.label || (nid === 'unassigned' ? 'Other' : nid || 'Other');
  const partColor = (nid) => `var(--n-${nodeBy.get(nid)?.kind || 'misc'})`;
  const base = (p) => p.split('/').pop();
  const nameOf = (p) => fileBy.get(p)?.name || base(p);
  const fanIn = (p) => inn.get(p)?.size || 0, fanOut = (p) => out.get(p)?.size || 0;
  const MAX_COL = 60;
  const ICON = '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.6 8 11 15.6M16.4 8 13 15.6"/>';

  const style = document.createElement('style');
  style.textContent = `
#dp { position: fixed; inset: 0; z-index: 44; background: var(--bg); display: none; flex-direction: column; color: var(--text); }
#dp.open { display: flex; animation: menuIn .22s var(--ease); }
#dp .dp-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--hair); position: relative; }
#dp .dp-t { flex: 1 1 260px; min-width: 0; }
#dp .dp-t b { display: block; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dp .dp-t span { display: block; font-family: var(--mono); font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dp .dp-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#dp .dp-q { width: 260px; max-width: 70vw; height: 34px; border: 0; border-radius: 12px; padding: 0 12px; background: rgba(var(--ink), .06); color: var(--text); outline: none; }
#dp .dp-q:focus { background: rgba(var(--ink), .08); box-shadow: 0 0 0 1px rgba(var(--ink), .14); }
#dp .dp-seg { display: inline-flex; background: rgba(var(--ink), .06); border-radius: 12px; padding: 3px; }
#dp .dp-seg button { border: 0; background: none; color: var(--text-2); height: 28px; min-width: 30px; padding: 0 9px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 12.5px; }
#dp .dp-seg button.on { background: var(--raise-2); color: var(--text); }
#dp .dp-seg .dp-l { color: var(--text-3); font-size: 12px; padding: 0 6px 0 8px; align-self: center; }
#dp .dp-res { position: absolute; top: 56px; right: 18px; width: 360px; max-width: calc(100vw - 36px); max-height: 60vh; overflow: auto; z-index: 2; }
#dp .dp-res.open { display: block; }
#dp .dp-res button { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 8px 12px; border-radius: 12px; cursor: pointer; }
#dp .dp-res button:hover, #dp .dp-res button.on { background: rgba(var(--ink), .07); }
#dp .dp-res b { font-weight: 500; display: block; }
#dp .dp-res span, #dp .dp-none { font-family: var(--mono); font-size: 11.5px; color: var(--text-3); }
#dp .dp-none { display: block; padding: 10px 12px; font-family: inherit; }
#dp .dp-body { flex: 1; overflow: auto; position: relative; }
#dp .dp-canvas { position: relative; min-width: 100%; width: max-content; padding: 20px 24px 60px; }
#dp .dp-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
#dp .dp-lines path { fill: none; stroke: rgba(var(--ink), .22); stroke-width: 1.4; transition: stroke .15s, opacity .15s; }
#dp .dp-lines path.loop { stroke: var(--sev-high); stroke-dasharray: 5 4; stroke-width: 1.6; }
#dp.hov .dp-lines path { opacity: .15; }
#dp.hov .dp-lines path.hot { opacity: 1; stroke: var(--text); }
#dp.hov .dp-lines path.hot.loop { stroke: var(--sev-high); }
#dp .dp-cols { display: flex; gap: 72px; align-items: flex-start; position: relative; }
#dp .dp-col { width: 236px; flex: none; }
#dp .dp-ch { font-size: 12px; color: var(--text-3); margin: 0 0 10px 2px; white-space: nowrap; }
#dp .dp-ch b { color: var(--text-2); font-weight: 600; }
#dp .dp-g { margin: 0 0 14px; }
#dp .dp-gh { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--text-3); margin: 0 0 6px 2px; }
#dp .dp-gh i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
#dp .dp-c { display: block; width: 100%; text-align: left; border: 1px solid var(--hair-2); background: var(--surface); color: var(--text); border-radius: 14px; padding: 8px 11px 8px 12px; margin: 0 0 6px; cursor: pointer; position: relative; box-shadow: var(--shadow-card); transition: border-color .15s, background .15s; }
#dp .dp-c:hover { background: var(--surface-hover); border-color: rgba(var(--ink), .28); }
#dp .dp-c.focus { border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring), var(--shadow-card); cursor: default; }
#dp .dp-c.inloop { border-color: color-mix(in srgb, var(--sev-high) 60%, transparent); }
#dp .dp-c b { display: block; font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 22px; }
#dp .dp-c span { display: block; font-family: var(--mono); font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dp .dp-c em { display: block; font-style: normal; font-size: 11px; color: var(--text-3); margin-top: 2px; }
#dp .dp-c em.l { color: var(--sev-high); }
#dp .dp-c .dp-go { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; color: var(--text-3); }
#dp .dp-c .dp-go:hover { background: rgba(var(--ink), .1); color: var(--text); }
#dp .dp-c .dp-go .i { width: 13px; height: 13px; }
#dp .dp-more { border: 0; background: rgba(var(--ink), .06); color: var(--text-2); border-radius: 12px; padding: 7px 12px; cursor: pointer; font: inherit; font-size: 12.5px; }
#dp .dp-home { max-width: 1100px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 22px; }
#dp .dp-sec h3 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
#dp .dp-sec p { font-size: 12.5px; color: var(--text-3); margin: 0 0 10px; line-height: 1.45; }
#dp .dp-row { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 8px 10px; border-radius: 12px; cursor: pointer; }
#dp .dp-row:hover { background: rgba(var(--ink), .06); }
#dp .dp-row b { font-weight: 500; font-size: 13px; }
#dp .dp-row span { display: block; font-family: var(--mono); font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dp .dp-row .n { float: right; font-family: inherit; color: var(--text-3); font-size: 12px; }
#dp .dp-row.loop b { color: var(--err-text); }
#dp .dp-empty { color: var(--text-3); font-size: 13px; padding: 30px 4px; }
#dp .dp-key { font-size: 12px; color: var(--text-3); margin: 0 0 16px 2px; }
#dp .dp-key i { display: inline-block; width: 22px; height: 0; border-top: 1.6px dashed var(--sev-high); vertical-align: middle; margin: 0 4px 0 10px; }
@media (max-width: 720px) { #dp .dp-top { padding: 10px 12px; } #dp .dp-q { width: 100%; } #dp .dp-ctl { width: 100%; } #dp .dp-cols { gap: 44px; } #dp .dp-col { width: 200px; } }
`;
  document.head.appendChild(style);

  // ---------- state ----------
  const st = { mode: 'home', file: null, loop: null, depth: 2, dir: 'both', all: new Set(), back: [] };
  try { const d = +SC.store.get('dp-depth', 2); if (d >= 1 && d <= 4) st.depth = d; } catch {}

  const el = document.createElement('div');
  el.id = 'dp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Dependencies');
  el.innerHTML = `
<div class="dp-top">
  <button class="btn soft icon" data-dp="back" title="Back" aria-label="Back">${iconI('left')}</button>
  <div class="dp-t"><b>Dependencies</b><span></span></div>
  <div class="dp-ctl">
    <input class="dp-q" placeholder="Find a file or component…" spellcheck="false" autocomplete="off" aria-label="Find a file or component">
    <div class="dp-seg" data-seg="dir"><button data-v="both" class="on">Both</button><button data-v="in">Used by</button><button data-v="out">Uses</button></div>
    <div class="dp-seg" data-seg="depth"><span class="dp-l">Steps</span><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div>
    <button class="btn soft" data-dp="map" title="Close this and show the file on the map">${iconI('search')}<span class="bl">Show on map</span></button>
    <button class="btn soft" data-dp="home" title="Import loops and the most-used files">Overview</button>
    <button class="btn soft icon" data-dp="close" title="Close (Esc)" aria-label="Close">${iconI('x')}</button>
  </div>
  <div class="dp-res menu glass"></div>
</div>
<div class="dp-body"><div class="dp-canvas"><svg class="dp-lines"><defs><marker id="dp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="rgba(128,128,128,.7)" stroke="none"/></marker></defs></svg><div class="dp-cols"></div></div></div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const cols = $('.dp-cols'), svg = $('.dp-lines'), canvas = $('.dp-canvas'), body = $('.dp-body'), res = $('.dp-res'), input = $('.dp-q');

  // ---------- pieces ----------
  const loopName = (i) => { const p = loops[i].path; return [...p, p[0]].map((x) => base(x)).join(' → '); };
  function card(p, { focus = false, col = 0 } = {}) {
    const lp = loopOf.get(p);
    const inLoop = lp !== undefined;
    const counts = `used by ${fanIn(p)} · uses ${fanOut(p)}`;
    const note = inLoop ? `<em class="l">In an import loop${loops[lp].files.length > 2 ? ` of ${loops[lp].files.length} files` : ''}</em>` : `<em>${h(counts)}</em>`;
    const sub = nameOf(p) === base(p) ? p : base(p);
    return `<button class="dp-c${focus ? ' focus' : ''}${inLoop ? ' inloop' : ''}" data-p="${hk(p)}" data-col="${col}" title="${h(p)}${focus ? '' : '\nClick to centre on this file'}">`
      + `<b>${h(nameOf(p))}</b><span>${h(sub)}</span>${note}`
      + `<i class="dp-go" data-go="${hk(p)}" title="Show on the map" role="button" aria-label="Show on the map">${iconI('search')}</i></button>`;
  }
  function column(key, label, list, depthKey) {
    const groups = new Map();
    const all = st.all.has(key);
    const shown = all ? list : list.slice(0, MAX_COL);
    for (const p of shown) { const n = fileBy.get(p)?.n || 'unassigned'; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(p); }
    let html = `<div class="dp-col"><div class="dp-ch">${label} <b>${list.length}</b></div>`;
    for (const [n, ps] of [...groups].sort((a, b) => b[1].length - a[1].length || partLabel(a[0]).localeCompare(partLabel(b[0])))) {
      html += `<div class="dp-g">${groups.size > 1 || depthKey !== 0 ? `<div class="dp-gh"><i style="background:${partColor(n)}"></i>${h(partLabel(n))} · ${ps.length}</div>` : ''}${ps.map((p) => card(p, { col: depthKey })).join('')}</div>`;
    }
    if (list.length > shown.length) html += `<button class="dp-more" data-all="${hk(key)}">Show all ${list.length}</button>`;
    return html + '</div>';
  }
  const sortFiles = (arr) => arr.sort((a, b) => (fileBy.get(a)?.n || '').localeCompare(fileBy.get(b)?.n || '') || nameOf(a).localeCompare(nameOf(b)));

  // ---------- views ----------
  function bfs(adj, start, d) {
    const dist = new Map([[start, 0]]);
    let frontier = [start];
    for (let k = 1; k <= d && frontier.length; k++) {
      const next = [];
      for (const x of frontier) for (const y of adj.get(x) || []) if (!dist.has(y)) { dist.set(y, k); next.push(y); }
      frontier = next;
    }
    dist.delete(start);
    return dist;
  }
  let placed = new Map(); // file → column number, for drawing lines
  function renderFocus() {
    const p = st.file;
    const d = st.depth;
    const uses = st.dir === 'in' ? new Map() : bfs(out, p, d);
    const used = st.dir === 'out' ? new Map() : bfs(inn, p, d);
    // a file on both sides is in a loop with this one: show it once, on the "uses" side
    for (const q of uses.keys()) used.delete(q);
    placed = new Map([[p, 0]]);
    let html = '';
    for (let k = d; k >= 1; k--) {
      const list = sortFiles([...used].filter(([, v]) => v === k).map(([q]) => q));
      if (!list.length) continue;
      list.forEach((q) => placed.set(q, -k));
      html += column('in' + k, k === 1 ? 'Used by' : `Used by, ${k} steps away`, list, -k);
    }
    html += `<div class="dp-col"><div class="dp-ch">Selected</div>${card(p, { focus: true, col: 0 })}</div>`;
    for (let k = 1; k <= d; k++) {
      const list = sortFiles([...uses].filter(([, v]) => v === k).map(([q]) => q));
      if (!list.length) continue;
      list.forEach((q) => placed.set(q, k));
      html += column('out' + k, k === 1 ? 'Uses' : `Uses, ${k} steps away`, list, k);
    }
    const none = !uses.size && !used.size;
    const lp = loopOf.get(p);
    // the loop key, when two files on the board are in the same loop
    const seen = new Map();
    let anyLoop = false;
    for (const q of placed.keys()) { const i = loopOf.get(q); if (i === undefined) continue; if (seen.has(i)) { anyLoop = true; break; } seen.set(i, q); }
    const key = `<div class="dp-key">Lines point from a file to the file it uses.${anyLoop ? `<i></i>a loop: these files import each other` : ''}</div>`;
    cols.innerHTML = html + (none ? `<div class="dp-empty">Nothing on the map imports this file or is imported by it${st.dir !== 'both' ? ' in this direction' : ''}.</div>` : '');
    canvas.querySelector('.dp-key')?.remove();
    cols.insertAdjacentHTML('beforebegin', key);
    $('.dp-t b').textContent = nameOf(p);
    $('.dp-t span').textContent = p + (lp !== undefined ? `  ·  in an import loop (${loopName(lp)})` : '');
  }
  function renderLoop() {
    const lp = loops[st.loop];
    const extra = lp.files.filter((f) => !lp.path.includes(f));
    placed = new Map();
    let html = '';
    lp.path.forEach((p, i) => { placed.set(p, i); html += `<div class="dp-col"><div class="dp-ch">${i === 0 ? 'Starts here' : `Step ${i}`}</div>${card(p, { col: i })}</div>`; });
    if (extra.length) { const c = lp.path.length; extra.forEach((p) => placed.set(p, c)); html += column('loop-extra', 'Also in this loop', sortFiles(extra), c); }
    canvas.querySelector('.dp-key')?.remove();
    cols.insertAdjacentHTML('beforebegin', `<div class="dp-key">Each file imports the next, and the last imports the first again.<i></i>import loop</div>`);
    cols.innerHTML = html;
    $('.dp-t b').textContent = `Import loop · ${lp.files.length} files`;
    $('.dp-t span').textContent = loopName(st.loop);
  }
  function renderHome() {
    placed = new Map();
    canvas.querySelector('.dp-key')?.remove();
    const files = [...new Set([...out.keys(), ...inn.keys()])];
    const top = (fn) => files.filter((p) => fn(p) > 0).sort((a, b) => fn(b) - fn(a) || a.localeCompare(b)).slice(0, 12);
    const row = (p, n, what) => `<button class="dp-row" data-p="${hk(p)}"><span class="n">${SC.plural(n, what)}</span><b>${h(nameOf(p))}</b><span>${h(p)}</span></button>`;
    const loopRows = loops.slice(0, 30).map((lp, i) => `<button class="dp-row loop" data-loop="${i}"><span class="n">${lp.files.length} files</span><b>${h(lp.path.map(nameOf).join(' → '))}</b><span>${h(loopName(i))}</span></button>`).join('');
    cols.innerHTML = `<div class="dp-home">
<div class="dp-sec"><h3>Import loops ${loops.length ? `<span style="color:var(--sev-high)">${loops.length}</span>` : ''}</h3><p>Files that import each other in a circle. None of them can be changed, tested or reused on its own, so each loop is worth untangling.</p>${loopRows || '<div class="dp-empty" style="padding:8px 10px">No files import each other in a loop.</div>'}${loops.length > 30 ? `<p>…and ${loops.length - 30} more.</p>` : ''}</div>
<div class="dp-sec"><h3>Most used</h3><p>The files the most others import directly. A change to one of these reaches furthest, so change them carefully.</p>${top(fanIn).map((p) => row(p, fanIn(p), 'user')).join('')}</div>
<div class="dp-sec"><h3>Most dependencies</h3><p>The files that import the most others directly. A long list can mean a file is doing too many jobs.</p>${top(fanOut).map((p) => row(p, fanOut(p), 'import')).join('')}</div>
</div>`;
    $('.dp-t b').textContent = 'Dependencies';
    $('.dp-t span').textContent = `${files.length.toLocaleString('en-US')} connected files · pick one to see what uses it and what it uses`;
  }
  function render() {
    el.classList.remove('hov');
    el.querySelector('[data-seg="dir"]').style.display = st.mode === 'focus' ? '' : 'none';
    el.querySelector('[data-seg="depth"]').style.display = st.mode === 'focus' ? '' : 'none';
    $('[data-dp="map"]').style.display = st.mode === 'focus' ? '' : 'none';
    $('[data-dp="back"]').style.visibility = st.back.length ? '' : 'hidden';
    el.querySelectorAll('[data-seg="depth"] button').forEach((b) => b.classList.toggle('on', +b.dataset.v === st.depth));
    el.querySelectorAll('[data-seg="dir"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.dir));
    if (st.mode === 'focus') renderFocus(); else if (st.mode === 'loop') renderLoop(); else renderHome();
    body.scrollTop = 0;
    requestAnimationFrame(() => { drawLines(); centreFocus(); });
  }
  function centreFocus() {
    const f = cols.querySelector('.dp-c.focus');
    if (!f) { body.scrollLeft = 0; return; }
    const r = f.getBoundingClientRect(), b = body.getBoundingClientRect();
    body.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }

  // ---------- lines ----------
  function drawLines() {
    svg.querySelectorAll('path[data-a]').forEach((x) => x.remove());
    if (!placed.size) return;
    const c = canvas.getBoundingClientRect();
    const box = new Map();
    cols.querySelectorAll('.dp-c[data-p]').forEach((b) => { const r = b.getBoundingClientRect(); box.set(b.dataset.p, { l: r.left - c.left, r: r.right - c.left, y: r.top - c.top + r.height / 2 }); });
    const frag = [];
    for (const [a, ca] of placed) {
      const A = box.get(a); if (!A) continue;
      for (const b of out.get(a) || []) {
        const cb = placed.get(b); const B = box.get(b); if (cb === undefined || !B) continue;
        const loop = loopOf.has(a) && loopOf.get(a) === loopOf.get(b);
        // only lines that move one step to the right, plus loops: everything else would be noise
        if (!loop && cb !== ca + 1) continue;
        let d;
        if (cb > ca) { const dx = Math.max(40, (B.l - A.r) / 2); d = `M${A.r},${A.y} C${A.r + dx},${A.y} ${B.l - dx},${B.y} ${B.l},${B.y}`; }
        else if (cb === ca) { const bend = 46 + Math.min(60, Math.abs(B.y - A.y) / 6); d = `M${A.r},${A.y} C${A.r + bend},${A.y} ${B.r + bend},${B.y} ${B.r},${B.y}`; }
        else { const lift = 34 + Math.min(80, Math.abs(B.y - A.y) / 4); const dx = Math.max(60, (A.l - B.r) / 2); d = `M${A.l},${A.y} C${A.l - dx},${A.y + lift} ${B.r + dx},${B.y + lift} ${B.r},${B.y}`; }
        frag.push(`<path d="${d}" class="${loop ? 'loop' : ''}" data-a="${hk(a)}" data-b="${hk(b)}" marker-end="url(#dp-arrow)"/>`);
      }
    }
    svg.insertAdjacentHTML('beforeend', frag.join(''));
    svg.setAttribute('width', canvas.scrollWidth); svg.setAttribute('height', canvas.scrollHeight);
  }
  cols.addEventListener('pointerover', (ev) => {
    const b = ev.target.closest('.dp-c'); if (!b) return;
    const p = b.dataset.p;
    el.classList.add('hov');
    svg.querySelectorAll('path[data-a]').forEach((x) => x.classList.toggle('hot', x.dataset.a === p || x.dataset.b === p));
  });
  cols.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget?.closest?.('.dp-c')) el.classList.remove('hov'); });

  // ---------- navigation ----------
  const snapshot = () => ({ mode: st.mode, file: st.file, loop: st.loop });
  function goTo(next, { push = true } = {}) {
    if (push && isOpen()) st.back.push(snapshot());
    if (st.back.length > 50) st.back.shift();
    Object.assign(st, next);
    st.all = new Set();
    closeResults();
    render();
  }
  // opening it from the map starts a fresh Back history; moving around inside it adds to it
  function openFile(p) { if (fileBy.has(p)) { const was = show(); goTo({ mode: 'focus', file: p, loop: null }, { push: was }); } }
  function openLoop(i) { if (loops[i]) { const was = show(); goTo({ mode: 'loop', loop: i, file: null }, { push: was }); } }
  function openHome() { const was = show(); goTo({ mode: 'home', file: null, loop: null }, { push: was }); }
  /** Opens the view; whether it was open already. */
  function show() {
    if (isOpen()) return true;
    SC.closeMenus?.();
    st.back = [];
    el.classList.add('open');
    return false;
  }
  function close() { el.classList.remove('open'); closeResults(); }
  const isOpen = () => el.classList.contains('open');

  el.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-go]');
    if (go) { ev.stopPropagation(); close(); SC.reveal('f:' + go.dataset.go); return; }
    const c = ev.target.closest('[data-p]');
    if (c && !c.classList.contains('focus')) { openFileInView(c.dataset.p); return; }
    const lp = ev.target.closest('[data-loop]');
    if (lp) { goTo({ mode: 'loop', loop: +lp.dataset.loop, file: null }); return; }
    const all = ev.target.closest('[data-all]');
    if (all) { st.all.add(all.dataset.all); const y = body.scrollTop; (st.mode === 'focus' ? renderFocus : renderLoop)(); body.scrollTop = y; requestAnimationFrame(drawLines); return; }
    const seg = ev.target.closest('.dp-seg button');
    if (seg) {
      const which = seg.parentElement.dataset.seg;
      if (which === 'depth') { st.depth = +seg.dataset.v; try { SC.store.set('dp-depth', st.depth); } catch {} }
      else st.dir = seg.dataset.v;
      st.all = new Set();
      render();
      return;
    }
    const act = ev.target.closest('[data-dp]')?.dataset.dp;
    if (act === 'close') close();
    else if (act === 'home') goTo({ mode: 'home', file: null, loop: null });
    else if (act === 'back' && st.back.length) goTo(st.back.pop(), { push: false });
    else if (act === 'map' && st.file) { close(); SC.reveal('f:' + st.file); }
  });
  const openFileInView = (p) => goTo({ mode: 'focus', file: p, loop: null });

  // ---------- finding a file ----------
  const searchable = G.files.map((f) => ({ p: f.p, text: `${f.name || ''} ${f.p}`.toLowerCase() }));
  function results(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { closeResults(); return; }
    const hits = searchable.filter((x) => words.every((w) => x.text.includes(w)))
      .sort((a, b) => (base(b.p).toLowerCase().startsWith(words[0]) - base(a.p).toLowerCase().startsWith(words[0])) || (fanIn(b.p) + fanOut(b.p)) - (fanIn(a.p) + fanOut(a.p)) || a.p.localeCompare(b.p)).slice(0, 30);
    res.innerHTML = hits.length
      ? hits.map((x, i) => `<button data-pick="${hk(x.p)}" class="${i ? '' : 'on'}"><b>${h(nameOf(x.p))}</b><span>${h(x.p)} · used by ${fanIn(x.p)} · uses ${fanOut(x.p)}</span></button>`).join('')
      : `<span class="dp-none">No file matches “${h(q)}”.</span>`;
    res.classList.add('open');
    res.querySelectorAll('[data-pick]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); input.value = ''; openFileInView(b.dataset.pick); });
  }
  function closeResults() { res.classList.remove('open'); }
  input.addEventListener('input', () => results(input.value));
  input.addEventListener('keydown', (ev) => {
    const rows = [...res.querySelectorAll('[data-pick]')];
    const cur = rows.findIndex((r) => r.classList.contains('on'));
    if (ev.key === 'Enter' && rows[Math.max(0, cur)]) { ev.preventDefault(); rows[Math.max(0, cur)].click(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (ev.key === 'ArrowDown' ? 1 : -1)))];
      rows.forEach((r) => r.classList.toggle('on', r === next));
      next?.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') {
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (res.classList.contains('open')) closeResults(); else close();
    } else if (ev.target !== input) {
      if (ev.key === '/') { ev.preventDefault(); input.focus(); }
      ev.stopPropagation(); // keep the map's own shortcuts out while this is open
    }
  }, true);
  window.addEventListener('pointerdown', (ev) => { if (isOpen() && res.classList.contains('open') && !res.contains(ev.target) && ev.target !== input) closeResults(); }, true);
  window.addEventListener('resize', () => { if (isOpen()) requestAnimationFrame(drawLines); });

  // ---------- ways in ----------
  SC.addHeaderButton({ id: 'deps-btn', label: 'Dependencies', svg: ICON, title: 'See what uses each file or component, what it uses, and loops of files that import each other', onClick: () => (isOpen() ? close() : openHome()) });
  SC.addPanelSection('item', (id) => {
    if (typeof id !== 'string' || !id.startsWith('f:')) return null;
    const p = id.slice(2);
    if (!fanIn(p) && !fanOut(p)) return null;
    const lp = loopOf.get(p);
    let html = `<div class="sec"><h3>Dependencies</h3><div class="list"><a class="row" data-dp-open><span class="dot" style="background:var(--n-file)"></span><span class="rt"><div class="rn">See what depends on what</div><div class="rd">Used by ${SC.plural(fanIn(p), 'file')} · uses ${SC.plural(fanOut(p), 'file')}, and a few steps further out</div></span></a>`;
    if (lp !== undefined) html += `<a class="row" data-dp-loop><span class="dot" style="background:var(--sev-high)"></span><span class="rt"><div class="rn">In an import loop</div><div class="rd">${h(loopName(lp))}</div></span></a>`;
    html += '</div></div>';
    return {
      html,
      bind: (box) => {
        box?.querySelector('[data-dp-open]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openFile(p); });
        box?.querySelector('[data-dp-loop]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openLoop(lp); });
      },
    };
  });
  SC.addPanelSection('overview', () => ({
    html: `<div class="sec"><h3>Dependencies${loops.length ? ` <span class="c" style="color:var(--sev-high)">${loops.length} ${loops.length === 1 ? 'loop' : 'loops'}</span>` : ''}</h3><div class="list"><a class="row" data-dp-home><span class="dot" style="background:var(--n-file)"></span><span class="rt"><div class="rn">What depends on what</div><div class="rd">Pick a file or component to see what uses it and what it uses${loops.length ? `, and untangle ${loops.length === 1 ? 'the loop' : `the ${loops.length} loops`} of files that import each other` : ''}.</div></span></a></div></div>`,
    bind: (box) => box?.querySelector('[data-dp-home]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openHome(); }),
  }));

  // other features can open it
  window.FloorplanDeps = { open: (id) => openFile(String(id || '').replace(/^f:/, '')), openLoop, openHome, loops };
})();

// Dependencies: the ways into the map's Dependencies view (viewer.html, "dependencies"), which shows a file or
// part with what uses it on the left and what it uses on the right, drawn like the rest of the map.
//   - the header's Dependencies menu: find a file or part, the import loops, the most-used files, and the
//     files that use the most others (like the Screens menu);
//   - a Dependencies section in a file's or part's details;
//   - right-click → Show dependencies, the D key, and the search's Dependencies button (in viewer.html).
(() => {
  const SC = window.Floorplan;
  if (!SC || !SC.deps) return;
  const { out, inn, loops } = SC.deps.links();
  if (!out.size) return; // no file → file links: nothing to show
  const G = SC.graph;
  const { h, hk } = SC;
  const fileBy = new Map(G.files.map((f) => [f.p, f]));
  const nameOf = (p) => fileBy.get(p)?.name || p.split('/').pop();
  const base = (p) => p.split('/').pop();
  const fanIn = (p) => inn.get(p)?.size || 0, fanOut = (p) => out.get(p)?.size || 0;
  const ICON = '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.6 8 11 15.6M16.4 8 13 15.6"/>';
  const loopName = (lp) => [...lp.path, lp.path[0]].map(base).join(' → ');

  const style = document.createElement('style');
  style.textContent = `
#dp-menu { position: fixed; width: 380px; max-height: min(72vh, 640px); overflow: auto; transform-origin: top right; overscroll-behavior: contain; }
#dp-menu .dp-f { position: sticky; top: -6px; margin: -6px -6px 4px; padding: 10px 10px 6px; background: var(--menu-solid); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); z-index: 1; border-radius: 18px 18px 0 0; }
#dp-menu .dp-f input { width: 100%; height: 34px; border: 0; border-radius: 12px; padding: 0 12px; background: rgba(var(--ink), .06); color: var(--text); outline: none; }
#dp-menu .dp-f input:focus { background: rgba(var(--ink), .08); box-shadow: 0 0 0 1px rgba(var(--ink), .14); }
#dp-menu .dp-g { padding: 10px 12px 4px; font-size: 12px; color: var(--text-3); display: flex; justify-content: space-between; gap: 8px; }
#dp-menu .dp-g b { font-weight: 500; color: var(--sev-high); }
#dp-menu .dp-r { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 8px 12px; border-radius: 12px; cursor: pointer; }
#dp-menu .dp-r:hover, #dp-menu .dp-r.on { background: rgba(var(--ink), .07); }
#dp-menu .dp-r .rt { flex: 1; min-width: 0; }
#dp-menu .dp-r b { font-weight: 500; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dp-menu .dp-r .rt span { font-family: var(--mono); font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
#dp-menu .dp-r .n { flex: none; font-size: 12px; color: var(--text-3); }
#dp-menu .dp-r.loop b { color: var(--err-text); }
#dp-menu .dp-none { padding: 10px 12px; color: var(--text-3); font-size: 12.5px; }
`;
  document.head.appendChild(style);

  const go = (id) => { closeMenu(); SC.deps.open(id); };
  const goLoop = (i) => { closeMenu(); SC.go('dep:loop:' + i); };

  // ---------- header menu ----------
  const menu = document.createElement('div');
  menu.id = 'dp-menu';
  menu.className = 'menu glass';
  document.body.appendChild(menu);
  const row = (attr, val, name, sub, n, cls = '') => `<button class="dp-r${cls}" ${attr}="${hk(val)}"><span class="rt"><b>${h(name)}</b><span>${h(sub)}</span></span>${n ? `<span class="n">${h(n)}</span>` : ''}</button>`;
  const files = [...new Set([...out.keys(), ...inn.keys()])];
  const parts = G.nodes.filter((n) => n.kind !== 'external' && SC.deps.able('n:' + n.id));
  const top = (fn) => files.filter((p) => fn(p) > 0).sort((a, b) => fn(b) - fn(a) || a.localeCompare(b)).slice(0, 8);
  const loopRow = (lp, i) => row('data-loop', String(i), lp.path.map(nameOf).join(' → '), loopName(lp), SC.plural(lp.files.length, 'file'), ' loop');

  function renderList(q = '') {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let html = '';
    if (words.length) {
      const hit = (t) => words.every((w) => t.includes(w));
      const fs = files.filter((p) => hit(`${nameOf(p)} ${p}`.toLowerCase()))
        .sort((a, b) => (base(b).toLowerCase().startsWith(words[0]) - base(a).toLowerCase().startsWith(words[0])) || (fanIn(b) + fanOut(b)) - (fanIn(a) + fanOut(a)) || a.localeCompare(b)).slice(0, 25);
      const ps = parts.filter((n) => hit(`${n.label} ${n.id}`.toLowerCase())).slice(0, 6);
      const ls = loops.map((lp, i) => [lp, i]).filter(([lp]) => hit(lp.files.join(' ').toLowerCase() + ' loop circular'));
      if (ps.length) html += '<div class="dp-g">Parts</div>' + ps.map((n) => row('data-dp', 'n:' + n.id, n.label, n.summary || n.id, '')).join('');
      if (fs.length) html += '<div class="dp-g">Files</div>' + fs.map((p) => row('data-dp', 'f:' + p, nameOf(p), p, `used by ${fanIn(p)} · uses ${fanOut(p)}`)).join('');
      if (ls.length) html += '<div class="dp-g">Import loops</div>' + ls.slice(0, 10).map(([lp, i]) => loopRow(lp, i)).join('');
      if (!html) html = `<div class="dp-none">Nothing matches “${h(q)}”.</div>`;
    } else {
      const sel = SC.state.selected;
      const cur = typeof sel === 'string' ? (sel.startsWith('m:') ? 'f:' + sel.slice(2) : sel) : null;
      if (cur && SC.deps.able(cur) && SC.state.container !== 'dep:' + cur) html += row('data-dp', cur, `Dependencies of ${SC.info(cur).name}`, 'the selected card', 'D');
      html += `<div class="dp-g">Import loops${loops.length ? `<b>${loops.length}</b>` : ''}</div>`;
      html += loops.length
        ? loops.slice(0, 12).map(loopRow).join('') + (loops.length > 12 ? `<div class="dp-none">…and ${loops.length - 12} more: type to find them.</div>` : '')
        : '<div class="dp-none">No files import each other in a loop.</div>';
      html += '<div class="dp-g">Most used</div>' + top(fanIn).map((p) => row('data-dp', 'f:' + p, nameOf(p), p, SC.plural(fanIn(p), 'user'))).join('');
      html += '<div class="dp-g">Use the most others</div>' + top(fanOut).map((p) => row('data-dp', 'f:' + p, nameOf(p), p, SC.plural(fanOut(p), 'import'))).join('');
    }
    const list = menu.querySelector('.dp-l');
    list.innerHTML = html;
    list.querySelectorAll('[data-dp]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); go(b.dataset.dp); });
    list.querySelectorAll('[data-loop]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); goLoop(+b.dataset.loop); });
    list.querySelector('.dp-r')?.classList.add('on');
  }
  function renderMenu() {
    menu.innerHTML = '<div class="dp-f"><input id="dp-q" placeholder="Find a file, component or part…" spellcheck="false" autocomplete="off"></div><div class="dp-l"></div>';
    renderList('');
    const input = menu.querySelector('#dp-q');
    input.oninput = () => renderList(input.value);
    input.onkeydown = (ev) => {
      const rows = [...menu.querySelectorAll('.dp-r')];
      const cur = rows.findIndex((r) => r.classList.contains('on'));
      if (ev.key === 'Enter' && rows[Math.max(0, cur)]) { ev.preventDefault(); rows[Math.max(0, cur)].click(); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (ev.key === 'ArrowDown' ? 1 : -1)))];
        rows.forEach((r) => r.classList.toggle('on', r === next));
        next?.scrollIntoView({ block: 'nearest' });
      }
    };
  }
  let btn = null;
  function openMenu() {
    document.body.click(); // let the viewer close its own menus
    renderMenu();
    place();
    menu.classList.add('open');
    menu.querySelector('#dp-q')?.focus();
  }
  function place() {
    const r = btn.getBoundingClientRect();
    const w = Math.min(380, innerWidth - 16);
    menu.style.top = r.bottom + 8 + 'px';
    menu.style.width = w + 'px';
    menu.style.right = Math.min(Math.max(8, innerWidth - r.right), innerWidth - 8 - w) + 'px';
  }
  function closeMenu() { menu.classList.remove('open'); }
  const isOpen = () => menu.classList.contains('open');
  btn = SC.addHeaderButton({ id: 'deps-btn', label: 'Dependencies', svg: ICON, title: 'What uses each file, component or part, what it uses, and loops of files that import each other', onClick: () => (isOpen() ? closeMenu() : openMenu()) });
  window.addEventListener('pointerdown', (ev) => { if (isOpen() && !menu.contains(ev.target) && !btn.contains(ev.target)) closeMenu(); }, true);
  window.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); closeMenu(); }
    else if (ev.target?.id !== 'dp-q') ev.stopPropagation(); // keep the map's shortcuts out of the open menu
  }, true);
  window.addEventListener('resize', () => { if (isOpen()) place(); });

  // ---------- details panel ----------
  SC.addPanelSection('item', (id) => {
    if (typeof id !== 'string' || !SC.deps.able(id)) return null;
    if (SC.state.container === 'dep:' + id) return null; // already looking at it
    const lpIndex = id.startsWith('f:') ? SC.deps.links().loopOf.get(id.slice(2)) : undefined;
    const sub = id.startsWith('f:') ? `Used by ${SC.plural(fanIn(id.slice(2)), 'file')} · uses ${SC.plural(fanOut(id.slice(2)), 'file')}, and further out` : 'What uses the files in this part, and what they use';
    let html = `<div class="sec"><h3>Dependencies</h3><div class="list"><a class="row" data-dp-open><span class="dot" style="background:var(--n-deps)"></span><span class="rt"><div class="rn">Show dependencies</div><div class="rd">${h(sub)}</div></span><span class="rc">D</span></a>`;
    if (lpIndex !== undefined) html += `<a class="row" data-dp-loop><span class="dot" style="background:var(--sev-high)"></span><span class="rt"><div class="rn">In an import loop</div><div class="rd">${h(loopName(loops[lpIndex]))}</div></span></a>`;
    html += '</div></div>';
    return {
      html,
      bind: (box) => {
        box?.querySelector('[data-dp-open]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); SC.deps.open(id); });
        box?.querySelector('[data-dp-loop]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); SC.go('dep:loop:' + lpIndex); });
      },
    };
  });
  SC.addPanelSection('overview', () => ({
    html: `<div class="sec"><h3>Dependencies${loops.length ? ` <span class="c" style="color:var(--sev-high)">${SC.plural(loops.length, 'loop')}</span>` : ''}</h3><div class="list"><a class="row" data-dp-home><span class="dot" style="background:var(--n-deps)"></span><span class="rt"><div class="rn">What depends on what</div><div class="rd">Pick a file, component or part to see what uses it and what it uses${loops.length ? `, and untangle ${loops.length === 1 ? 'the loop' : `the ${loops.length} loops`} of files that import each other` : ''}.</div></span></a></div></div>`,
    bind: (box) => box?.querySelector('[data-dp-home]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openMenu(); }),
  }));

  window.FloorplanDeps = { open: (id) => SC.deps.open(String(id)), openLoop: (i) => SC.go('dep:loop:' + i), openMenu, loops };
})();

/* Camp Planner — trip list: open, create, duplicate, archive, export and import trip plans.
   Trips are saved on the website. Planners (leaders and superusers) see the create buttons (.plan-only);
   each trip's own buttons depend on whether you can edit it (owner, co-planner or superuser). */

const Trips = (() => {
  const STATUS = {
    planning: { label: 'Planning', color: '#006b9e' },
    ready: { label: 'Ready to go', color: '#00664a' },
    completed: { label: 'Completed', color: '#868e96' },
    archived: { label: 'Archived', color: '#adb5bd' }
  };
  let bound = false, filter = 'active', sort = 'start';
  const root = () => $('#tab-trips');

  const ago = t => {
    const m = (Date.now() - t) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const span = m => {
    const s = parseDate(m.start), e = parseDate(m.end);
    if (!s) return 'No dates';
    const days = e ? Math.round((e - s) / 864e5) + 1 : 1;
    return `${fmtDate(s, { day: 'numeric', month: 'short', year: 'numeric' })}${e && days > 1 ? ' – ' + fmtDate(e, { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · ${days} day${days > 1 ? 's' : ''}`;
  };
  const badge = st => `<span class="status" style="background:${(STATUS[st] || STATUS.planning).color}">${(STATUS[st] || STATUS.planning).label}</span>`;
  const PUB = { draft: ['📝', 'Draft', '#868e96'], review: ['⏳', 'In review', '#e67700'], published: ['✅', 'Published', '#00664a'] };
  const VIS = { public: ['🌏', 'Public'], private: ['🔗', 'Private — link only'], secret: ['🔒', 'Secret — link + lock code'] };
  const pubBadge = t => {
    const p = PUB[t.pub] || PUB.draft, v = VIS[t.visibility] || VIS.public;
    return `<span class="status" style="background:${p[2]}" title="${p[1]}">${p[0]} ${p[1]}${t.pub === 'review' ? ` ${t.approvals}/${t.needed}` : ''}</span>
      <span class="status vis" title="${v[1]}">${v[0]}</span>${t.changedSincePublished ? '<span class="status warn" title="Changed since it was approved">✎ changed</span>' : ''}`;
  };

  async function render() {
    if (!bound) bind();
    const all = await Store.list();
    const shown = all.filter(t => filter === 'all' || (filter === 'active' ? !['completed', 'archived'].includes(t.meta.status) : t.meta.status === filter))
      .sort((a, b) => sort === 'updated' ? b.updated - a.updated : sort === 'name' ? a.meta.name.localeCompare(b.meta.name) : String(a.meta.start || '9').localeCompare(String(b.meta.start || '9')));
    const counts = Object.fromEntries(Object.keys(STATUS).map(k => [k, all.filter(t => t.meta.status === k).length]));
    root().innerHTML = `
      <div class="page-head"><h2>Group trips</h2>
        <div class="btn-row no-print plan-only">
          <button class="btn primary" data-t="new">+ New trip</button>
          <button class="btn" data-t="template" title="Copy people, gear, recipes, cars and home from the current trip">+ New trip using my gear &amp; people</button>
          <select id="tExample"><option value="">+ Add an example trip…</option>${Examples.list.map(x => `<option value="${x.key}">${esc(x.name)}</option>`).join('')}</select>
        </div></div>
      <div class="row wrap no-print trip-filters">
        <div class="seg">${[['active', `Active (${all.length - counts.completed - counts.archived})`], ...Object.entries(STATUS).map(([k, v]) => [k, `${v.label} (${counts[k]})`]), ['all', `All (${all.length})`]]
          .map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        <label class="inline">Sort <select id="tSort"><option value="start" ${sort === 'start' ? 'selected' : ''}>by trip date</option><option value="updated" ${sort === 'updated' ? 'selected' : ''}>last edited</option><option value="name" ${sort === 'name' ? 'selected' : ''}>name</option></select></label>
      </div>
      <div class="trip-grid">${shown.map(t => card(t)).join('') || '<p class="muted">No trips here.</p>'}</div>
      <div class="card no-print">
        <h3>Backup &amp; share</h3>
        <p class="muted small">Trips are saved on the Grafton Scout Group website. This list shows the trips you can see: published public trips, plus your own and your co-planned trips${Store.isSuper ? ' — as a superuser you see every trip' : ''}. Export them to keep your own copy or to use in the offline Camp Planner.<span class="plan-only"> Imported trips become your own drafts.</span></p>
        <div class="btn-row">
          <button class="btn" data-t="exportAll">⬇ Export all trips</button>
          <label class="btn plan-only">⬆ Import trips<input type="file" id="tImport" accept=".json,application/json" hidden></label>
        </div>
      </div>`;
  }

  function card(t) {
    const m = t.meta, cur = t.id === Store.tripId;
    return `<div class="trip-card ${cur ? 'current' : ''}" data-id="${t.id}">
      <div class="tc-head">${badge(m.status)} ${t.id ? pubBadge(t) : ''} ${m.example ? '<span class="status ex">Example</span>' : ''} ${cur ? '<span class="status cur">Open now</span>' : ''}</div>
      <h3>${esc(m.name || 'Untitled trip')}</h3>
      <div class="tc-meta">📅 ${span(m)}</div>
      <div class="tc-meta">📍 ${esc([m.location, m.park, m.state].filter(Boolean).join(' · ') || 'No location yet')}</div>
      <div class="tc-meta">👥 ${m.people} ${m.people === 1 ? 'person' : 'people'}${m.km ? ` · 🥾 ${m.km.toFixed(1)} km of trails` : ''}</div>
      <div class="tc-meta muted small">${t.id ? `👤 ${esc(t.ownerName || t.owner || '')}${(t.planners || []).length ? ` + ${t.planners.length} co-planner${t.planners.length > 1 ? 's' : ''}` : ''} · edited ${ago(t.updated)}${t.updatedBy ? ' by ' + esc(t.updatedBy) : ''}` : 'Not saved yet'}</div>
      <div class="btn-row no-print">
        ${cur ? `<button class="btn small" data-goto="trip">${Store.canEdit ? 'Edit details' : 'Details'}</button>` : '<button class="btn small primary" data-t="open">Open</button>'}
        ${t.canEdit || !t.id ? `<select data-status title="Status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>` : ''}
        <button class="icon-btn plan-only" data-t="dup" title="Make a copy (your own draft)">⧉</button>
        <button class="icon-btn" data-t="export" title="Export this trip">⬇</button>
        ${t.id && (t.isOwner || Store.isSuper) ? '<button class="icon-btn" data-t="del" title="Delete">🗑</button>' : ''}
      </div>
    </div>`;
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('click', async e => {
      const f = e.target.closest('[data-filter]');
      if (f) { filter = f.dataset.filter; return render(); }
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      const id = b.closest('[data-id]')?.dataset.id;
      try { switch (b.dataset.t) {
        case 'new': return Store.create(Store.newState());
        case 'template': return Store.fromTemplate(Store.tripId);
        case 'open': return Store.open(id);
        case 'dup': await Store.duplicate(id); toast('Trip duplicated'); return render();
        case 'export': {
          const rec = await Store.get(id);
          return download(safeName(rec.state.trip.name) + '-camp-plan.json', JSON.stringify(rec.state, null, 1));
        }
        case 'exportAll': return download(`camp-planner-trips-${isoDate(new Date())}.json`, JSON.stringify(await Store.exportAll()));
        case 'del': {
          const rec = await Store.get(id);
          if (!confirm(`Delete “${rec.state.trip.name}” permanently? Export it first if you might want it back.`)) return;
          await Store.remove(id);
          toast('Trip deleted');
          return render();
        }
      } } catch (err) { toast(err.message); }
    });
    r.addEventListener('change', async e => {
      const el = e.target;
      if (el.id === 'tSort') { sort = el.value; return render(); }
      if (el.id === 'tExample' && el.value) {
        const s = Examples.build(el.value);
        try { await Store.create(s, false); toast(`Added “${s.trip.name}”`); } catch (err) { toast(err.message); }
        return render();
      }
      if (el.dataset.status !== undefined) {
        const id = el.closest('[data-id]').dataset.id || Store.tripId;
        try { await Store.update(id, s => { s.trip.status = el.value; }); } catch (err) { toast(err.message); }
        if (id === Store.tripId) App.refreshHeader();
        return render();
      }
      if (el.id === 'tImport' && el.files[0]) {
        try {
          const n = await Store.importData(JSON.parse(await readFile(el.files[0])));
          toast(`Imported ${n} trip${n > 1 ? 's' : ''}`);
        } catch (err) { toast('Import failed: ' + err.message); }
        el.value = '';
        render();
      }
    });
  }

  /* Header switcher: jump between trips without visiting the Trips page. */
  async function fillSwitcher() {
    const sel = $('#tripSwitch');
    if (!sel) return;
    const all = (await Store.list()).filter(t => t.id === Store.tripId || !['completed', 'archived'].includes(t.meta.status))
      .sort((a, b) => b.updated - a.updated);
    sel.innerHTML = all.map(t => `<option value="${t.id || ''}" ${t.id === Store.tripId ? 'selected' : ''}>${esc(t.meta.name || 'Untitled trip')}</option>`).join('') +
      '<option value="__manage">🗂️ All trips…</option>';
    sel.onchange = () => {
      if (sel.value === '__manage') { sel.value = Store.tripId || ''; App.show('trips'); }
      else if (sel.value && sel.value !== Store.tripId) Store.open(sel.value);
    };
  }

  return { render, fillSwitcher, STATUS };
})();

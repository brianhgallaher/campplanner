/* Camp Planner — user management for Camp Planner admins.
   Same accounts as the program editor; this page only sets Camp Planner roles (and adds Camp-Planner-only accounts).
   Program sections and program admin are managed separately on the Leaders page. */

(() => {
  const API = '../api/';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let csrf = '', me = null, users = [], isSuper = false;
  async function call(path, body) {
    const init = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.headers['X-CSRF-Token'] = csrf; init.body = JSON.stringify(body); }
    const r = await fetch(API + path, init);
    const j = await r.json().catch(() => ({}));
    if (j && j.csrf) csrf = j.csrf;
    if (!r.ok) { const e = new Error(j.error || `The website returned an error (${r.status}).`); e.status = r.status; throw e; }
    return j;
  }
  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  const ROLES = [['none', 'No access', 'Can view published trips like anyone else'], ['leader', 'Leader', 'Plans trips; sees published trips and the ones they own or co-plan'],
    ['super', 'Superuser', 'Sees every trip, can edit any trip, and reviews trips for publishing']];
  const root = () => $('#usersRoot');

  function page() {
    const active = users.filter(u => u.status === 'active');
    const count = r => active.filter(u => u.campRole === r).length;
    root().innerHTML = `
      <h1>Camp Planner users</h1>
      <p>Leaders sign in with the same username and password as the program editor. This page sets what they can do in the <b>Camp Planner</b> only —
        program sections and program admin are managed on the <a href="../leaders/program.html">Leaders page</a>.</p>
      <div class="card">
        <h3>Roles</h3>
        <table class="tbl compact"><tbody>
          ${ROLES.map(([k, l, d]) => `<tr><th>${l}</th><td>${d}</td><td class="num">${k === 'none' ? '' : count(k) + ' active'}</td></tr>`).join('')}
          <tr><th>Camp admin</th><td>Can open this page and change everyone's Camp Planner access (tick it as well as a role)</td><td class="num">${active.filter(u => u.campAdmin).length} active</td></tr>
        </tbody></table>
        <p class="small muted">A trip is published once its author submits it and <b>one superuser</b> who doesn't plan it approves it.${count('super') < 2 ? ` <span class="warn-text">You have ${count('super')} superuser${count('super') === 1 ? '' : 's'}: a trip planned by a superuser needs another superuser to review it.</span>` : ''}</p>
      </div>

      <div class="card">
        <h3>Add a Camp-Planner-only leader</h3>
        <p class="small muted">For someone who doesn't use the program editor. If they already have a program account, just set their role in the list below.</p>
        <form class="row wrap users-add" id="addForm">
          <label class="field"><span>Username</span><input name="username" maxlength="40" placeholder="e.g. jane.smith" autocapitalize="none" spellcheck="false" required></label>
          <label class="field"><span>Name</span><input name="name" maxlength="120" placeholder="e.g. Jane Smith"></label>
          <label class="field"><span>Email (optional)</span><input name="email" type="email" maxlength="190"></label>
          <label class="field"><span>Role</span><select name="campRole">${ROLES.filter(r => r[0] !== 'none').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="campAdmin"> Camp admin</label>
          <button class="btn primary">＋ Create account</button>
        </form>
      </div>

      <div class="row wrap users-filter">
        <input id="uSearch" type="search" placeholder="Find a leader, username or group…" aria-label="Find a leader">
        <select id="uGroup" aria-label="Scout group"><option value="">All groups</option>${[...new Set(users.map(u => u.group).filter(Boolean))].sort()
          .map(g => `<option value="${esc(g)}">${esc(g)} (${users.filter(u => u.group === g).length})</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="uOnly"> Only people with Camp Planner access</label>
        <label class="check"><input type="checkbox" id="uTemp"> Only people who haven't signed in yet (${users.filter(u => u.hasTemp).length})</label>
      </div>
      <div class="table-scroll"><table class="tbl users-tbl">
        <thead><tr><th>Leader</th><th>Scout group</th><th>Program editor</th><th>Camp Planner role</th><th>Camp admin</th><th class="num">Trips</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody id="uRows"></tbody>
      </table></div>`;
    rows();
  }

  function rows() {
    const q = ($('#uSearch')?.value || '').toLowerCase(), only = $('#uOnly')?.checked, temp = $('#uTemp')?.checked, grp = $('#uGroup')?.value || '';
    const list = users.filter(u => (!q || (u.name + ' ' + u.username + ' ' + (u.email || '') + ' ' + (u.group || '')).toLowerCase().includes(q))
      && (!only || u.campRole !== 'none' || u.campAdmin) && (!temp || u.hasTemp) && (!grp || u.group === grp));
    $('#uRows').innerHTML = list.map(u => {
      const self = u.id === me.id;
      return `<tr data-id="${u.id}" class="${u.status !== 'active' ? 'muted' : ''}">
        <td><b>${esc(u.name || u.username)}</b><br><small class="muted">${esc(u.username)}${u.email ? ' · ' + esc(u.email) : ''}</small>
          ${u.status !== 'active' ? '<br><span class="status warn">Access removed</span>' : ''}${u.mustChange ? ' <span class="status" style="background:#868e96">Temporary password</span>' : ''}</td>
        <td class="small">${esc(u.group) || '<span class="muted">—</span>'}</td>
        <td class="small">${esc(u.program) || '<span class="muted">—</span>'}</td>
        <td><select data-k="campRole">${ROLES.map(([k, l]) => `<option value="${k}" ${u.campRole === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><label class="check"><input type="checkbox" data-k="campAdmin" ${u.campAdmin ? 'checked' : ''} ${self ? 'disabled title="You can\'t remove your own admin access"' : ''}> Admin</label></td>
        <td class="num">${u.trips || ''}</td>
        <td class="small muted nowrap">${u.lastLogin ? esc(u.lastLogin.slice(0, 16)) : 'never'}</td>
        <td class="nowrap"><button class="btn small primary" data-act="save">Save</button>
          ${u.hasTemp && isSuper ? '<button class="btn small" data-act="temp" title="Show the temporary password so you can pass it on">🔑 Show temporary password</button>' : ''}
          ${u.campOnly && !self ? '<button class="btn small" data-act="reset" title="Give them a new temporary password">🔑 Reset password</button>' : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No leaders match.</td></tr>';
    $('#uCount') && ($('#uCount').textContent = `${list.length} of ${users.length}`);
  }

  /* The message to pass on: who they are, the temporary password and where to sign in */
  function showTemp(who, r) {
    const base = location.origin + location.pathname.replace(/campplanner\/[^/]*$/, '');
    const msg = `Hi ${(who || r.username).split(' ')[0]},\n\nYou now have an account for the Grafton Scout Group Camp Planner.\n\n`
      + `Username: ${r.username}\nTemporary password: ${r.temporaryPassword}\n\n`
      + `1. Sign in at ${base}leaders/program.html and choose your own password.\n`
      + `2. Then open the Camp Planner: ${base}campplanner/\n`;
    $('#tempText').innerHTML = `Account <b>${esc(r.username)}</b>${who ? ` for ${esc(who)}` : ''}:`;
    $('#tempPass').textContent = r.temporaryPassword;
    $('#tempMsg').value = msg;
    $('#tempDialog').showModal();
  }

  async function load() {
    users = (await call('camp_users.php?action=users')).users;
    page();
  }

  function bind() {
    $('#tempClose').addEventListener('click', () => $('#tempDialog').close());
    $('#tempCopy').addEventListener('click', () => {
      const t = $('#tempMsg');
      t.select();
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => toast('Message copied'))
        .catch(() => { document.execCommand('copy'); toast('Message copied'); });
    });
    root().addEventListener('input', e => { if (e.target.id === 'uSearch') rows(); });
    root().addEventListener('change', e => { if (['uOnly', 'uTemp', 'uGroup'].includes(e.target.id)) rows(); });
    root().addEventListener('submit', async e => {
      if (e.target.id !== 'addForm') return;
      e.preventDefault();
      const f = e.target;
      try {
        const r = await call('camp_users.php?action=create', { username: f.username.value.trim().toLowerCase(), name: f.name.value.trim(), email: f.email.value.trim(), campRole: f.campRole.value, campAdmin: f.campAdmin.checked });
        showTemp(f.name.value.trim(), r);
        await load();
      } catch (ex) { toast(ex.message, true); }
    });
    root().addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const tr = b.closest('tr'), u = users.find(x => x.id === +tr.dataset.id);
      try {
        if (b.dataset.act === 'save') {
          const campRole = tr.querySelector('[data-k=campRole]').value, campAdmin = tr.querySelector('[data-k=campAdmin]').checked;
          await call('camp_users.php?action=save', { id: u.id, campRole, campAdmin });
          toast(`Saved ${u.name || u.username}`);
          await load();
        } else if (b.dataset.act === 'temp') {
          showTemp(u.name, await call('camp_users.php?action=temp', { id: u.id }));
        } else if (b.dataset.act === 'reset') {
          if (!confirm(`Give ${u.username} a new temporary password? Their current password stops working.`)) return;
          showTemp(u.name, await call('camp_users.php?action=reset', { id: u.id }));
        }
      } catch (ex) { toast(ex.message, true); }
    });
  }

  async function init() {
    try { me = await call('auth.php?action=me'); } catch (e) { me = { signedIn: false }; }
    if (!me.signedIn || me.mustChange || !me.campAdmin) {
      root().innerHTML = `<h1>Camp Planner users</h1><div class="card"><p>${!me.signedIn ? 'Sign in on the <a href="./">Camp Planner home page</a> as a Camp Planner admin to manage users.'
        : me.mustChange ? 'Change your temporary password on the <a href="../leaders/program.html">Leaders page</a> first.'
        : 'Only Camp Planner admins can manage Camp Planner access. Ask one of them if you need a change.'}</p></div>`;
      return;
    }
    isSuper = me.campRole === 'super';
    bind();
    try { await load(); } catch (e) { root().innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

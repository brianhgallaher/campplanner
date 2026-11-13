/* Camp Planner — leader sign-in, view-only notice, lock codes and save status.
   Uses the same leader accounts as the program editor (leaders/program.html); Camp Planner roles
   (leader / superuser / admin) are set by Camp Planner admins on users.html. */

const Account = (() => {
  let warned = false;
  const LEADERS_PAGE = '../leaders/program.html';

  function init() {
    const u = Store.user || {};
    document.body.classList.toggle('view-only', !Store.canEdit);
    document.body.classList.toggle('can-plan', !!Store.canPlan);
    const users = $('#btnUsers');
    if (users) users.hidden = !Store.isAdmin;
    if (Store.needsCode) lockPrompt();
    const btn = $('#btnAccount');
    btn.textContent = u.signedIn ? `👤 ${u.name || u.username} · Sign out` : '🔑 Leader sign in';
    btn.title = u.signedIn ? 'Sign out' : 'Leaders with Camp Planner access can sign in to add and change trips';
    btn.addEventListener('click', () => (u.signedIn ? signOut() : prompt()));
    bar();
    bindDialog();
    /* Visitors: say once that edits aren't kept (print options and map framing don't count) */
    document.addEventListener('change', e => {
      if (!Store.canEdit && e.target.closest('main') && !e.target.closest('#tab-report, #tab-map')) viewChanged();
    }, true);
    if (Store.loadError) bar('bad', `⚠ ${esc(Store.loadError)} <a href="./">See all trips</a>`);
  }

  /* The strip under the tabs that says what you can do. */
  function bar(kind, html) {
    const el = $('#accessBar');
    const u = Store.user || {};
    if (!html) {
      if (Store.canEdit) { el.hidden = true; return; }
      kind = 'info';
      const a = Store.access;
      html = !u.signedIn
        ? `👀 <b>View only.</b> Anyone can view and print published trips. Leaders: <button class="linkish" data-acc="signin">sign in</button> to plan trips.`
        : u.mustChange
          ? `🔑 Change your temporary password on the <a href="${LEADERS_PAGE}">Leaders page</a>, then come back to plan trips.`
          : !Store.canPlan
            ? `👀 <b>View only.</b> Your account can view trips but not plan them — ask a Camp Planner admin for access.`
            : a
              ? `👀 <b>View only.</b> This trip is planned by <b>${esc(a.ownerName || a.owner)}</b> — only its leaders and superusers can change it. <button class="btn small" data-acc="copy">⧉ Make my own copy</button>`
              : `👀 <b>View only.</b>`;
    }
    el.className = `access-bar no-print ${kind}`;
    el.innerHTML = html;
    el.hidden = false;
  }

  function saveState(kind, msg) {
    const el = $('#saveState');
    if (!el) return;
    const text = { pending: 'Unsaved changes…', saving: 'Saving…', saved: '✓ Saved', error: '⚠ Not saved — retrying' }[kind] || '';
    el.textContent = text;
    el.className = 'save-state ' + kind;
    el.title = msg || (kind === 'saved' ? 'Saved to the website' : '');
  }

  /* A visitor changed something: say once that it won't be kept. */
  function viewChanged() {
    if (Store.canEdit) return;
    if (warned) return;
    warned = true;
    toast('View only — changes you make here are not saved. Leaders can sign in to edit.', 5000);
  }

  function conflict(msg) {
    saveState('error', msg);
    bar('bad', `⚠ ${esc(msg)} Your latest changes have <b>not</b> been saved.
      <button class="btn small" data-acc="reload">Load their version</button>
      <button class="btn small" data-acc="overwrite">Keep mine (replace theirs)</button>`);
  }

  function lostAccess(msg) {
    document.body.classList.add('view-only');
    saveState('error', msg);
    bar('bad', `⚠ ${esc(msg)} Your latest changes have <b>not</b> been saved. <button class="btn small" data-acc="signin">Sign in again</button>`);
  }

  /* Secret trip: ask for the lock code, unlock it for this browser session, then load it. */
  function lockPrompt() {
    const d = $('#lockDialog');
    if (!d) return;
    d.addEventListener('cancel', e => e.preventDefault());
    $('#lockForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#lockError'), go = $('#lockGo');
      err.textContent = ''; go.disabled = true;
      try {
        await Server.call('camp.php?action=unlock', { t: Store.token, code: $('#lockCode').value });
        location.reload();
      } catch (ex) { err.textContent = ex.message; }
      finally { go.disabled = false; }
    });
    d.showModal();
    $('#lockCode').focus();
  }

  function prompt() {
    const d = $('#signinDialog');
    $('#siError').textContent = '';
    if (!d.open) d.showModal();
    $('#siUser').focus();
  }

  async function signOut() {
    if (Store.hasUnsaved()) await Store.persist();
    try { await Server.call('auth.php?action=logout', {}); } catch (e) { /* signed out anyway */ }
    location.reload();
  }

  function bindDialog() {
    const d = $('#signinDialog');
    $('#siCancel').addEventListener('click', () => d.close());
    $('#siForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#siError'), go = $('#siGo');
      err.textContent = '';
      go.disabled = true;
      try {
        const r = await Server.call('auth.php?action=login', { username: $('#siUser').value.trim().toLowerCase(), password: $('#siPass').value });
        if (r.mustChange) {
          err.innerHTML = `Signed in. You have a temporary password — choose your own on the <a href="${LEADERS_PAGE}">Leaders page</a> first, then come back here.`;
          return;
        }
        location.reload();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        go.disabled = false;
      }
    });
    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-acc]');
      if (!b) return;
      if (b.dataset.acc === 'signin') prompt();
      if (b.dataset.acc === 'copy') {
        try { const id = await Store.duplicate(Store.tripId); toast('Copied — opening your own draft'); Store.open(id); }
        catch (ex) { toast(ex.message); }
      }
      if (b.dataset.acc === 'reload') { Store.dirty = false; location.reload(); }
      if (b.dataset.acc === 'overwrite') {
        try { await Store.overwrite(); bar(); toast('Saved — your version replaced theirs'); }
        catch (ex) { toast(ex.message); }
      }
    });
  }

  return { init, bar, saveState, viewChanged, conflict, lostAccess, prompt };
})();

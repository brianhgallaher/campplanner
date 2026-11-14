/* Camp Planner — publishing, review and sharing for the open trip (a card on the Trip tab).
   Draft → submitted for review → published once the author submits it and 1 superuser approves (not the trip's own leaders).
   Visibility once published: public (listed for everyone) · private (anyone with the link) · secret (link + lock code). */

const Publish = (() => {
  const PUB = {
    draft: ['📝 Draft', 'Only you, your co-planners and superusers can see it.'],
    review: ['⏳ Waiting for review', 'Waiting for a superuser to review it. One superuser\'s approval publishes it (not the trip\'s own leaders).'],
    published: ['✅ Published', '']
  };
  const VIS = {
    public: ['🌏 Public', 'Listed on the Camp Planner home page and trip map — anyone can view and print it.'],
    private: ['🔗 Private', 'Not listed. Anyone you give the link to can view it.'],
    secret: ['🔒 Secret', 'Not listed. People need the link and the lock code.']
  };
  const DECISION = { submit: '📤 submitted it for review', approve: '✅ approved', changes: '✏️ asked for changes', withdraw: '↩ withdrew it from review', unpublish: '⏸ unpublished it', published: '🎉 Published' };
  /* The activity log (camp.php?action=activity): who did what to the trip and its registrations. Group names and counts only. */
  const n = (k, one, many) => `${k} ${k === 1 ? one : many || one + 's'}`, grp = d => d.group ? ` <b>${esc(d.group)}</b>` : '';
  const STAGE = { off: 'turned registration off', interest: 'opened expressions of interest', open: 'opened registration', closed: 'closed registration' };
  const ACTIVITY = {
    create: () => '🆕 created the trip', update: () => '✏️ edited the plan', delete: () => '🗑 deleted the trip',
    reg_off: () => '🚫 ' + STAGE.off, reg_interest: d => '📣 ' + STAGE.interest + (d.closes ? ` (closes ${esc(d.closes)})` : ''),
    reg_open: d => '📝 ' + STAGE.open + (d.closes ? ` (closes ${esc(d.closes)})` : ''), reg_closed: () => '🔒 ' + STAGE.closed,
    reg_brief_on: () => '📢 sent the briefing', reg_brief_off: () => '↩ withdrew the briefing', reg_brief_edit: () => '📢 changed the briefing',
    reg_go: () => '✅ recorded <b>GO</b>', reg_nogo: () => '⛔ recorded <b>NO-GO</b>', reg_decision_clear: () => '↩ cleared the go / no-go decision',
    reg_capacity: d => `👥 changed the places${d.max ? ` (maximum ${d.max})` : ' (no maximum)'}${d.promote ? `, let ${n(d.promote, 'person', 'people')} off the waiting list` : ''}${d.demote ? `, moved ${n(d.demote, 'person', 'people')} onto it` : ''}`,
    checkin_link_new: () => '📱 made a check-in link', checkin_link_off: () => '📱 removed the check-in link',
    reg_person_add: d => '➕ added a person' + (d.group ? ' to' + grp(d) : ''), reg_person_remove: d => '➖ removed a person' + (d.group ? ' from' + grp(d) : ''),
    reg_person_edit: d => '✏️ changed a person\'s details' + (d.group ? ' in' + grp(d) : ''), reg_person_move: d => '↔ moved a person' + (d.group ? ' to' + grp(d) : ' out of their group'),
    reg_admit: () => '🎟 gave someone a place off the waiting list',
    reg_group_add: d => '➕ added the group' + grp(d), reg_group_remove: d => '🗑 removed the group' + grp(d), reg_group_edit: d => '✏️ changed the group' + grp(d),
    reg_group_link: d => '🔗 made a new group leader\'s link for' + grp(d), reg_group_plan: d => '✏️ changed the plan of' + grp(d),
    reg_register: d => d.newGroup ? '🙋 registered and started the group' + grp(d) : '🙋 registered' + (d.group ? ' in' + grp(d) : ' (no group yet)'),
    reg_cancel: d => '🚪 cancelled their registration' + (d.group ? ' in' + grp(d) : ''),
    grp_cars: d => `🚗 saved the cars: ${n(d.cars || 0, 'car')}${d.was != null && d.was !== d.cars ? ` (was ${d.was})` : ''}, ${n(d.seats || 0, 'seat')}${d.details ? `, vehicle details on ${d.details}` : ''}`,
    grp_plan: () => '🗒 saved the group\'s plan', grp_person_add: () => '➕ added a person', grp_person_remove: () => '➖ removed a person', grp_person_edit: () => '✏️ changed a person\'s details',
    checkin: () => '✅ recorded arrivals', checkin_undo: () => '↩ undid an arrival'
  };
  const WHO = { participant: 'A participant', 'check-in': 'Check-in' };
  const who = h => WHO[h.username] || (/^group: /.test(h.username) ? 'Group leader, ' + esc(h.username.slice(7)) : esc(h.name));
  const actLine = h => `<li><small class="muted">${when(h.at)}</small> <b>${who(h)}</b> ${(ACTIVITY[h.action] || (() => esc(h.action)))(h.detail || {})}</li>`;
  async function loadActivity(box) {
    const ul = box.querySelector('ul');
    try {
      const r = await Server.call('camp.php?action=activity&id=' + encodeURIComponent(Store.tripId));
      ul.innerHTML = r.activity.length ? r.activity.map(actLine).join('') + (r.activity.length >= 200 ? '<li class="muted">Older entries aren\'t shown.</li>' : '') : '<li class="muted">Nothing recorded yet.</li>';
    } catch (e) { ul.innerHTML = `<li class="muted">${esc(e.message)}</li>`; }
  }
  let people = null;

  const when = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  function card() {
    const a = Store.access;
    if (!Store.tripId) {
      return Store.canPlan ? `<div class="card no-print pub-card"><h3>📣 Publishing &amp; sharing</h3>
        <p class="muted">Make a change to save this plan as your draft — then you can add co-planners, choose who can see it and submit it for review.</p></div>` : '';
    }
    if (!a || !(a.canEdit || a.canReview)) return '';
    const p = PUB[a.pub] || PUB.draft, v = VIS[a.visibility] || VIS.public;
    const owner = a.isOwner || Store.isSuper;
    const apr = Store.history.filter(h => h.decision === 'approve' && h.round === Math.max(0, ...Store.history.map(x => x.round)));
    return `<div class="card no-print pub-card" id="pubCard">
      <h3>📣 Publishing &amp; sharing</h3>
      <div class="pub-status pub-${a.pub}">
        <b>${p[0]}</b>${a.pub === 'review' ? ` — ${a.approvals} of ${a.needed} approvals${apr.length ? ` (${apr.map(h => esc(h.name)).join(', ')})` : ''}` : ''}
        ${a.pub === 'published' ? ` — ${a.publishedAt ? 'since ' + when(a.publishedAt) : ''}. ${v[1]}` : `<span class="muted"> ${p[1]}</span>`}
        ${a.changedSincePublished ? '<div class="warn-text small">✎ Changed since it was approved — superusers can see this and may send it back for review.</div>' : ''}
      </div>

      <div class="pub-grid">
        <div>
          <h4>Who plans it</h4>
          <p class="small">👤 <b>${esc(a.ownerName || a.owner)}</b> (owner)${(a.planners || []).length ? `<br>👥 ${a.planners.map(esc).join(', ')}` : ''}</p>
          ${owner && a.canEdit ? '<button class="btn small" data-pub="planners">👥 Co-planners…</button>' : ''}
          <div id="plannerPick"></div>
        </div>
        ${a.canEdit ? `<div>
          <h4>Who can see it once published</h4>
          ${Object.entries(VIS).map(([k, x]) => `<label class="check"><input type="radio" name="pubVis" value="${k}" ${a.visibility === k ? 'checked' : ''}> <b>${x[0]}</b> <small class="muted">${x[1]}</small></label>`).join('')}
          <div class="pub-lock" ${a.visibility === 'secret' ? '' : 'hidden'}>
            <label class="field"><span>Lock code ${a.hasLock ? '<small class="muted">(set — type a new one to change it)</small>' : ''}</span>
              <input id="pubCode" type="text" autocomplete="off" maxlength="40" placeholder="${a.hasLock ? '••••••' : 'at least 4 characters'}"></label>
          </div>
          <button class="btn small" data-pub="vis">Save</button>
          <div class="pub-link">
            <input id="pubLink" readonly value="${esc(Store.shareUrl())}" aria-label="Link to this trip">
            <button class="btn small" data-pub="copy">📋 Copy link</button>
            ${a.visibility !== 'public' ? '<button class="btn small" data-pub="newlink" title="Make a new link — the old one stops working">↻ New link</button>' : ''}
          </div>
          <p class="hint">${a.pub === 'published' ? 'Share this link.' : 'The link works once the trip is published (until then only its leaders and superusers can open it).'}</p>
        </div>` : ''}
      </div>

      <div class="btn-row pub-actions">
        ${a.team && a.pub === 'draft' ? '<button class="btn primary" data-pub="submit">📤 Submit for review</button>' : ''}
        ${a.team && a.pub === 'review' ? '<button class="btn" data-pub="withdraw">↩ Withdraw from review</button>' : ''}
        ${a.canReview && !a.iApproved ? '<button class="btn primary" data-pub="approve">✅ Approve</button><button class="btn" data-pub="changes">✏️ Ask for changes</button>' : ''}
        ${a.canReview && a.iApproved ? '<span class="ok small">✓ You approved this.</span>' : ''}
        ${Store.isSuper && a.team && a.pub === 'review' ? '<span class="muted small">You plan this trip, so another superuser needs to review it.</span>' : ''}
        ${a.pub === 'published' && (a.isOwner || Store.isSuper) ? '<button class="btn" data-pub="unpublish">⏸ Unpublish (back to draft)</button>' : ''}
      </div>
      <div id="pubNote"></div>

      ${Store.history.length ? `<details class="pub-history"><summary>Review history (${Store.history.length})</summary>
        <ul>${Store.history.slice().reverse().map(h => `<li><small class="muted">${when(h.at)}</small> ${h.decision === 'published' ? '<b>🎉 Published</b>' : `<b>${esc(h.name)}</b> ${DECISION[h.decision] || esc(h.decision)}`}${h.comment ? `: <i>“${esc(h.comment)}”</i>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${a.canEdit || Store.isSuper ? `<details class="pub-history" id="pubActivity"><summary>Activity log — who changed what</summary>
        <p class="muted small">Changes to the plan and to registrations by the trip's leaders, group leaders and participants. Names of participants aren't recorded.</p><ul><li class="muted">Loading…</li></ul></details>` : ''}
    </div>`;
  }

  /* A short message box (submit note, change request, unpublish reason). */
  function ask(label, required, go) {
    const el = $('#pubNote');
    el.innerHTML = `<div class="pub-ask"><label class="field"><span>${label}</span><textarea id="pubMsg" rows="3"></textarea></label>
      <div class="btn-row"><button class="btn primary" data-pub="send">Send</button><button class="btn" data-pub="cancel">Cancel</button></div></div>`;
    $('#pubMsg').focus();
    ask.go = async () => {
      const msg = $('#pubMsg').value.trim();
      if (required && !msg) return toast('Please add a note');
      await go(msg);
    };
  }

  async function run(action, body, done) {
    try {
      await Store.act(action, body);
      toast(done);
      document.body.classList.toggle('view-only', !Store.canEdit);
      Account.bar && Account.bar();
      Trip.render();
    } catch (e) { toast(e.message, 5000); }
  }

  async function pickPlanners() {
    const el = $('#plannerPick');
    try { people = people || (await Server.call('camp.php?action=people')).people; } catch (e) { return toast(e.message); }
    const a = Store.access, mine = new Set(a.planners || []);
    const others = people.filter(p => p.username !== a.owner);
    el.innerHTML = `<div class="pub-ask">${others.length ? others.map(p => `<label class="check"><input type="checkbox" name="planner" value="${esc(p.username)}" ${mine.has(p.username) ? 'checked' : ''}> ${esc(p.name)} <small class="muted">${esc(p.username)}${p.role === 'super' ? ' · superuser' : ''}</small></label>`).join('')
      : '<p class="muted small">No other leaders have Camp Planner access yet.</p>'}
      <div class="btn-row"><button class="btn small primary" data-pub="savePlanners">Save co-planners</button><button class="btn small" data-pub="cancelPick">Cancel</button></div></div>`;
  }

  function bind(root) {
    root.addEventListener('toggle', e => { if (e.target.id === 'pubActivity' && e.target.open) loadActivity(e.target); }, true);   /* toggle doesn't bubble */
    root.addEventListener('change', e => {
      if (e.target.name === 'pubVis') root.querySelector('.pub-lock').hidden = e.target.value !== 'secret';
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-pub]');
      if (!b) return;
      const a = Store.access;
      switch (b.dataset.pub) {
        case 'submit': return ask('Note for the reviewers (optional)', false, msg => run('submit', { comment: msg }, 'Submitted for review — superusers can now see it in their review list'));
        case 'withdraw': return run('withdraw', {}, 'Withdrawn — back to draft');
        case 'approve': return run('review', { decision: 'approve' }, 'Approved');
        case 'changes': return ask('What needs changing? (the trip\'s leaders see this)', true, msg => run('review', { decision: 'changes', comment: msg }, 'Sent back to the trip\'s leaders'));
        case 'unpublish': return ask('Why? (optional — the trip\'s leaders see this)', false, msg => run('unpublish', { comment: msg }, 'Unpublished — back to draft'));
        case 'send': return ask.go && ask.go();
        case 'cancel': $('#pubNote').innerHTML = ''; return;
        case 'vis': {
          const vis = (root.querySelector('input[name=pubVis]:checked') || {}).value;
          const code = ($('#pubCode') || {}).value || '';
          if (vis === 'secret' && !code && !a.hasLock) return toast('Set a lock code for a secret trip');
          return run('sharing', { visibility: vis, lockCode: code }, vis === 'secret' ? 'Saved — share the link and tell people the lock code separately' : 'Saved');
        }
        case 'copy': {
          const inp = $('#pubLink');
          inp.select();
          (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(() => toast('Link copied')).catch(() => { document.execCommand('copy'); toast('Link copied'); });
          return;
        }
        case 'newlink':
          if (!confirm('Make a new link? The current link will stop working.')) return;
          return run('new_link', {}, 'New link made — share it again');
        case 'planners': return pickPlanners();
        case 'cancelPick': $('#plannerPick').innerHTML = ''; return;
        case 'savePlanners': {
          const list = [...root.querySelectorAll('input[name=planner]:checked')].map(x => x.value);
          return run('planners', { planners: list }, 'Co-planners saved');
        }
      }
    });
  }

  return { card, bind };
})();

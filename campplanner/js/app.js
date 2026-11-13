/* Camp Planner — tabs, header and printing */

const App = {
  modules: null,
  current: 'trip',

  async init() {
    await Store.load();
    Account.init();
    Help.init();
    Live.init();
    this.modules = { trips: Trips, trip: Trip, map: MapView, traverse: Traverse, travel: Travel, budget: Budget, meals: Meals, gear: Gear, weight: Weight, risk: Risk, weather: Weather, report: Report };
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (b) this.show(b.dataset.tab);
    });
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); this.show(g.dataset.goto); }
    });
    $('#btnPrint').addEventListener('click', () => this.print());
    /* Warn before leaving while a change is still on its way to the website */
    window.addEventListener('beforeunload', e => {
      if (!Store.hasUnsaved()) return;
      Store.saveNow();
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('afterprint', () => { if (this.current !== 'map') $('#pageStyle').textContent = ''; });
    this.refreshHeader();
    const h = location.hash.slice(1);
    this.show(this.modules[h] ? h : 'trip');
  },

  show(tab) {
    if (this.current === 'map' && tab !== 'map' && document.body.classList.contains('map-printing')) $('#printClose').click();
    this.current = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// in some browsers */ }
    this.modules[tab].render();
    window.scrollTo(0, 0);
  },

  refreshHeader() {
    const t = Store.state.trip;
    $('#headerTrip').textContent = (t.location ? t.location : '') +
      (t.park ? ` · ${t.park.name} ${t.park.type}` : '') + (t.state ? ` · ${t.state}` : '');
    document.title = t.name + ' · Camp Planner · Grafton Scout Group';
    Trips.fillSwitcher();
  },

  reloadAll() {
    this.refreshHeader();
    location.reload();
  },

  print() {
    if (this.current === 'map') return MapView.openPrint();
    if (this.current === 'report') return Report.print();
    /* Wide tables print better in landscape. */
    const wide = ['risk', 'gear', 'meals', 'traverse', 'travel', 'budget'].includes(this.current);
    $('#pageStyle').textContent = `@page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    window.print();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

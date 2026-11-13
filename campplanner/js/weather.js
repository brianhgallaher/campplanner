/* Camp Planner — weather forecast (Open-Meteo) and tides (Open-Meteo Marine) for the camp location */

const Weather = (() => {
  const WMO = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
    56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'], 61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'],
    77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Heavy showers'], 82: ['⛈️', 'Violent showers'],
    85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm & hail'], 99: ['⛈️', 'Severe storm & hail']
  };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const MAX_AGE = 60 * 60 * 1000;
  let bound = false, loading = false, alerts = [];
  const root = () => $('#tab-weather');
  const W = () => Store.state.weather;
  const T = () => Store.state.trip;

  /* API times are local to the camp (timezone=auto). Treat them as UTC internally so the
     viewer's own timezone never shifts them. */
  const tms = s => Date.parse(s.length === 10 ? s + 'T00:00Z' : s + 'Z');
  const hhmm = ms => { const d = new Date(ms); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const dayLabel = ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dirText = deg => COMPASS[Math.round(deg / 22.5) % 16];
  const arrow = deg => `<span class="wind-arrow" style="transform:rotate(${deg}deg)" title="From ${dirText(deg)}">↓</span>`;
  const wmo = c => WMO[c] || ['❔', 'Unknown'];

  const locKey = () => `${num(T().lat).toFixed(3)},${num(T().lon).toFixed(3)}`;
  const tripDates = () => new Set(tripDays().filter(d => d.date).map(d => isoDate(d.date)));

  function forecastUrl(lat, lon) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=16` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,apparent_temperature_max,precipitation_sum,' +
      'precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset' +
      '&hourly=temperature_2m,precipitation,precipitation_probability';
  }
  function marineUrl(lat, lon) {
    return `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=8` +
      '&hourly=sea_level_height_msl,wave_height,sea_surface_temperature&daily=wave_height_max,wave_period_max,wave_direction_dominant';
  }

  const fresh = c => c && c.key === locKey() && Date.now() - c.at < MAX_AGE;

  function render() {
    if (!bound) bind();
    if (T().lat == null || T().lon == null) {
      root().innerHTML = `<div class="card empty"><h2>Weather &amp; tides</h2>
        <p>Set your camp location to see the forecast — and tides if you're camping on the coast.</p>
        <div class="btn-row"><button class="btn primary" data-goto="trip">Set location on Trip tab</button>
        <button class="btn" id="wPick">⛺ Pick on map</button></div></div>`;
      return;
    }
    root().innerHTML = view();
    if (!loading && (!fresh(W().cache) || (T().coastal && !fresh(W().marine)))) refresh();
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    const st = $('#wStatus');
    if (st) st.textContent = 'Updating…';
    const { lat, lon } = T(), key = locKey();
    try {
      W().cache = { key, at: Date.now(), data: await getJSON(forecastUrl(lat, lon)) };
    } catch (e) {
      toast('Weather forecast failed: ' + e.message);
    }
    if (T().coastal) {
      try { W().marine = { key, at: Date.now(), data: await getJSON(marineUrl(lat, lon)) }; }
      catch (e) { W().marine = { key, at: Date.now(), error: e.message }; }
    }
    Store.save();
    loading = false;
    if (App.current === 'weather') root().innerHTML = view();
  }

  function view() {
    const c = W().cache;
    let h = `<div class="page-head"><h2>Weather &amp; tides — ${esc(T().location || 'camp')}</h2>
      <div class="btn-row no-print">
        <label class="check"><input type="checkbox" id="wCoastal" ${T().coastal ? 'checked' : ''}> Coastal — show tides</label>
        <button class="btn" id="wRefresh">↻ Refresh</button></div></div>
      <p class="muted">${num(T().lat).toFixed(4)}, ${num(T().lon).toFixed(4)}
        ${c && c.key === locKey() ? ` · forecast updated ${new Date(c.at).toLocaleString()}` : ''} <span id="wStatus"></span></p>`;
    if (!c || c.key !== locKey()) return h + '<div class="card"><p>Loading forecast…</p></div>';
    const d = c.data;
    h += windowNote(d) + currentCard(d) + alertsCard(d) + dailyCards(d) + hourlyChart(d);
    if (T().coastal) h += tidesSection();
    return h + linksCard();
  }

  function windowNote(d) {
    const days = tripDays().filter(x => x.date);
    if (!days.length) return '';
    const first = isoDate(days[0].date), last = isoDate(days[days.length - 1].date);
    const times = d.daily.time;
    if (first > times[times.length - 1]) {
      const until = Math.round((parseDate(first) - parseDate(times[0])) / 864e5);
      return `<div class="card note">📅 Your trip starts in ${until} days — beyond the 16-day forecast. Showing the next 16 days; check again closer to the date.</div>`;
    }
    if (last < times[0]) return '<div class="card note">📅 Your trip dates are in the past — showing the current forecast.</div>';
    return '<div class="card note">📅 Trip days are highlighted below.</div>';
  }

  function currentCard(d) {
    const c = d.current;
    if (!c) return '';
    const [ic, txt] = wmo(c.weather_code);
    return `<div class="card current">
      <div class="cur-main"><span class="cur-ic">${ic}</span><div><b>${Math.round(c.temperature_2m)}°C</b><span>${txt} · feels ${Math.round(c.apparent_temperature)}°C</span></div></div>
      <div class="cur-stats"><span>💨 ${Math.round(c.wind_speed_10m)} km/h ${dirText(c.wind_direction_10m)} ${arrow(c.wind_direction_10m)} gusts ${Math.round(c.wind_gusts_10m)}</span>
        <span>💧 ${c.relative_humidity_2m}% humidity</span><span>🌧️ ${c.precipitation} mm now</span></div>
    </div>`;
  }

  /* Weather that should feed into the risk assessment. */
  function buildAlerts(d) {
    const dd = d.daily, td = tripDates();
    let idx = dd.time.map((t, i) => i).filter(i => td.has(dd.time[i]));
    const scope = idx.length ? 'during your trip' : 'in the next 16 days';
    if (!idx.length) idx = dd.time.map((t, i) => i);
    const days = f => idx.filter(f).map(i => dayLabel(tms(dd.time[i])));
    const max = (k) => Math.max(...idx.map(i => dd[k][i] ?? -Infinity));
    const min = (k) => Math.min(...idx.map(i => dd[k][i] ?? Infinity));
    const out = [];
    const push = (test, icon, title, preset) => { const ds = days(test); if (ds.length) out.push({ icon, title, days: ds, preset }); };
    const P = name => HAZARD_PRESETS.find(h => h.hazard.startsWith(name)) || {};
    push(i => dd.wind_gusts_10m_max[i] >= 60, '💨', `Strong wind gusts up to ${Math.round(max('wind_gusts_10m_max'))} km/h`,
      { ...P('Falling trees'), cause: `Forecast gusts up to ${Math.round(max('wind_gusts_10m_max'))} km/h ${scope}` });
    push(i => dd.precipitation_sum[i] >= 20, '🌧️', `Heavy rain — up to ${Math.round(max('precipitation_sum'))} mm in a day`,
      { ...P('Flash flooding'), cause: `Forecast rain up to ${Math.round(max('precipitation_sum'))} mm/day ${scope}` });
    push(i => [95, 96, 99].includes(dd.weather_code[i]), '⛈️', 'Thunderstorms forecast',
      { ...P('Lightning'), cause: `Thunderstorms forecast ${scope}` });
    push(i => dd.temperature_2m_min[i] <= 3, '🥶', `Cold nights — down to ${Math.round(min('temperature_2m_min'))}°C`,
      { ...P('Hypothermia'), cause: `Overnight lows to ${Math.round(min('temperature_2m_min'))}°C ${scope}` });
    push(i => dd.temperature_2m_max[i] >= 33, '🥵', `Hot days — up to ${Math.round(max('temperature_2m_max'))}°C`,
      { ...P('Heat illness'), cause: `Maximums to ${Math.round(max('temperature_2m_max'))}°C ${scope}` });
    push(i => dd.uv_index_max[i] >= 8, '😎', `Very high UV (index ${Math.round(max('uv_index_max'))})`,
      { hazard: 'Sunburn / high UV', cause: `UV index up to ${Math.round(max('uv_index_max'))} ${scope}`, l: 4, c: 2, rl: 2, rc: 2,
        controls: 'Slip, slop, slap, seek, slide. SPF50+ sunscreen reapplied every 2 hours, broad-brim hat, sunglasses, long sleeves, rest in shade 11am–3pm.' });
    return { list: out, scope };
  }

  function alertsCard(d) {
    const a = buildAlerts(d);
    alerts = a.list;
    if (!alerts.length) return `<div class="card ok-card">✅ No significant weather warnings ${a.scope} (wind, heavy rain, storms, cold, heat, UV). Always check official warnings before you go.</div>`;
    return `<div class="card warn-card"><h3>Weather risks ${a.scope}</h3>
      <ul class="alerts">${alerts.map((x, i) => {
        const exists = Store.state.risks.some(r => r.hazard === x.preset.hazard);
        return `<li><span class="al-ic">${x.icon}</span><div><b>${x.title}</b><br><small>${x.days.join(', ')}</small></div>
        ${exists ? '<span class="muted small">In risk assessment ✓</span>' : `<button class="btn small no-print" data-alert="${i}">+ Add to risks</button>`}</li>`;
      }).join('')}</ul></div>`;
  }

  function dailyCards(d) {
    const dd = d.daily, td = tripDates();
    return `<div class="card"><h3>16-day forecast</h3><div class="days">${dd.time.map((t, i) => {
      const [ic, txt] = wmo(dd.weather_code[i]);
      return `<div class="day ${td.has(t) ? 'trip-day' : ''}">
        <div class="day-date">${dayLabel(tms(t))}</div>
        <div class="day-ic" title="${txt}">${ic}</div>
        <div class="day-desc">${txt}</div>
        <div class="day-temp"><b>${Math.round(dd.temperature_2m_max[i])}°</b> / ${Math.round(dd.temperature_2m_min[i])}°</div>
        <div class="day-row">🌧️ ${(dd.precipitation_sum[i] ?? 0).toFixed(1)} mm${dd.precipitation_probability_max[i] != null ? ` · ${dd.precipitation_probability_max[i]}%` : ''}</div>
        <div class="day-row">💨 ${Math.round(dd.wind_speed_10m_max[i])} km/h ${dirText(dd.wind_direction_10m_dominant[i])} ${arrow(dd.wind_direction_10m_dominant[i])}</div>
        <div class="day-row muted">gusts ${Math.round(dd.wind_gusts_10m_max[i])} km/h</div>
        <div class="day-row">UV ${dd.uv_index_max[i] != null ? Math.round(dd.uv_index_max[i]) : '—'}</div>
        <div class="day-row muted small">🌅 ${hhmm(tms(dd.sunrise[i]))} · 🌇 ${hhmm(tms(dd.sunset[i]))}</div>
      </div>`;
    }).join('')}</div></div>`;
  }

  /* Next 7 days: temperature line with rain bars. */
  function hourlyChart(d) {
    const hr = d.hourly, n = Math.min(168, hr.time.length);
    if (n < 2) return '';
    const Wd = 960, H = 220, L = 40, Rp = 40, Tp = 16, B = 30;
    const temps = hr.temperature_2m.slice(0, n), rain = hr.precipitation.slice(0, n);
    const tLo = Math.floor(Math.min(...temps) / 5) * 5, tHi = Math.ceil(Math.max(...temps) / 5) * 5 || 5;
    const rHi = Math.max(4, Math.ceil(Math.max(...rain)));
    const x = i => L + i * (Wd - L - Rp) / (n - 1);
    const yT = v => Tp + (1 - (v - tLo) / ((tHi - tLo) || 1)) * (H - Tp - B);
    const yR = v => H - B - v / rHi * (H - Tp - B);
    const td = tripDates();
    let svg = '';
    for (let i = 0; i < n; i++) {
      const t = hr.time[i];
      if (t.endsWith('T00:00')) {
        const day = t.slice(0, 10);
        if (td.has(day)) svg += `<rect x="${x(i)}" y="${Tp}" width="${x(Math.min(i + 24, n - 1)) - x(i)}" height="${H - Tp - B}" class="c-trip"/>`;
        svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${Tp}" y2="${H - B}" class="c-grid"/><text x="${x(i) + 4}" y="${H - 12}" class="c-lbl">${dayLabel(tms(day))}</text>`;
      }
    }
    for (let v = tLo; v <= tHi; v += 5) svg += `<line x1="${L}" x2="${Wd - Rp}" y1="${yT(v)}" y2="${yT(v)}" class="c-grid light"/><text x="${L - 6}" y="${yT(v) + 4}" class="c-lbl" text-anchor="end">${v}°</text>`;
    svg += `<text x="${Wd - Rp + 6}" y="${Tp + 8}" class="c-lbl">${rHi}mm</text><text x="${Wd - Rp + 6}" y="${H - B}" class="c-lbl">0</text>`;
    const bw = Math.max(1, (Wd - L - Rp) / n - 0.5);
    rain.forEach((v, i) => { if (v > 0) svg += `<rect x="${x(i) - bw / 2}" y="${yR(v)}" width="${bw}" height="${H - B - yR(v)}" class="c-rain"/>`; });
    svg += `<path d="${temps.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yT(v).toFixed(1)}`).join('')}" class="c-temp"/>`;
    return `<div class="card"><h3>Next 7 days — hourly</h3>
      <svg viewBox="0 0 ${Wd} ${H}" class="chart" role="img" aria-label="Hourly temperature and rain">${svg}</svg>
      <div class="legend"><span><i style="background:#e8590c"></i>Temperature °C</span><span><i style="background:#74c0fc"></i>Rain mm/hour</span><span><i style="background:#fff3bf;border:1px solid #e9d8a6"></i>Trip days</span></div></div>`;
  }

  /* ---------- tides ---------- */
  function extrema(times, h) {
    const out = [];
    for (let i = 1; i < h.length - 1; i++) {
      const a = h[i - 1], b = h[i], c = h[i + 1];
      if (a == null || b == null || c == null) continue;
      const hi = b > a && b >= c, lo = b < a && b <= c;
      if (!hi && !lo) continue;
      const den = a - 2 * b + c;
      const off = den ? 0.5 * (a - c) / den : 0; // parabolic fit between hourly samples
      out.push({ type: hi ? 'high' : 'low', t: tms(times[i]) + off * 3600e3, h: b - 0.25 * (a - c) * off });
    }
    return out;
  }

  function tidesSection() {
    const m = W().marine;
    if (!m || m.key !== locKey()) return '<div class="card"><h3>🌊 Tides</h3><p>Loading tides…</p></div>';
    if (m.error) return `<div class="card"><h3>🌊 Tides</h3><p class="muted">Tide data unavailable: ${esc(m.error)}</p></div>`;
    const hr = m.data.hourly, h = hr.sea_level_height_msl || [];
    if (!h.some(v => v != null)) {
      return `<div class="card"><h3>🌊 Tides</h3><p>No tide data for this exact point. Tides are modelled over the ocean — move the camp pin onto the water's edge or a nearby beach, or use official tide tables.</p></div>`;
    }
    const ex = extrema(hr.time, h);
    const byDay = new Map();
    ex.forEach(e => { const k = new Date(e.t).toISOString().slice(0, 10); byDay.set(k, [...(byDay.get(k) || []), e]); });
    const td = tripDates(), dd = m.data.daily || {};
    return `<div class="card"><h3>🌊 Tides — next 8 days</h3>
      ${tideChart(hr.time, h, ex)}
      <div class="table-scroll"><table class="tbl tides">
        <thead><tr><th>Day</th><th>Tide times (height above mean sea level)</th><th class="num">Max waves</th></tr></thead>
        <tbody>${[...byDay.entries()].map(([day, list]) => {
          const wi = (dd.time || []).indexOf(day);
          return `<tr class="${td.has(day) ? 'trip-row' : ''}"><td>${dayLabel(tms(day))}</td>
          <td>${list.map(e => `<span class="tide ${e.type}">${e.type === 'high' ? '▲ High' : '▼ Low'} <b>${hhmm(e.t)}</b> ${e.h.toFixed(2)} m</span>`).join('')}</td>
          <td class="num">${wi >= 0 && dd.wave_height_max[wi] != null ? dd.wave_height_max[wi].toFixed(1) + ' m' : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted small">Modelled tides (±30 min) relative to mean sea level, not chart datum — heights won't match published tide tables, but times are usually close.
      Use official tide tables before rounding headlands, crossing estuaries or going onto rock platforms.</p>
    </div>`;
  }

  function tideChart(times, h, ex) {
    const n = times.length, Wd = 960, H = 200, L = 40, Rp = 16, Tp = 22, B = 30;
    const vals = h.filter(v => v != null);
    const lo = Math.min(...vals) - 0.1, hi = Math.max(...vals) + 0.1;
    const t0 = tms(times[0]), t1 = tms(times[n - 1]);
    const x = t => L + (t - t0) / (t1 - t0) * (Wd - L - Rp);
    const y = v => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
    const td = tripDates();
    let svg = '';
    times.forEach(t => {
      if (!t.endsWith('T00:00')) return;
      const ms = tms(t), day = t.slice(0, 10);
      if (td.has(day)) svg += `<rect x="${x(ms)}" y="${Tp}" width="${Math.min(x(ms + 864e5), Wd - Rp) - x(ms)}" height="${H - Tp - B}" class="c-trip"/>`;
      svg += `<line x1="${x(ms)}" x2="${x(ms)}" y1="${Tp}" y2="${H - B}" class="c-grid"/><text x="${x(ms) + 4}" y="${H - 12}" class="c-lbl">${dayLabel(ms)}</text>`;
    });
    svg += `<line x1="${L}" x2="${Wd - Rp}" y1="${y(0)}" y2="${y(0)}" class="c-grid light"/><text x="${L - 6}" y="${y(0) + 4}" class="c-lbl" text-anchor="end">MSL</text>`;
    const pts = times.map((t, i) => h[i] == null ? null : [x(tms(t)), y(h[i])]).filter(Boolean);
    svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}L${pts[pts.length - 1][0]},${H - B}L${pts[0][0]},${H - B}Z" class="c-sea"/>`;
    ex.forEach(e => {
      const yy = y(e.h);
      svg += `<circle cx="${x(e.t)}" cy="${yy}" r="2.5" class="c-${e.type}"/><text x="${x(e.t)}" y="${e.type === 'high' ? yy - 6 : yy + 13}" class="c-lbl tiny" text-anchor="middle">${hhmm(e.t)}</text>`;
    });
    const now = Date.now() + num(W().marine.data.utc_offset_seconds) * 1000; // camp-local "now" on the same scale as tms()
    if (now > t0 && now < t1) svg += `<line x1="${x(now)}" x2="${x(now)}" y1="${Tp - 8}" y2="${H - B}" class="c-now"/><text x="${x(now)}" y="${Tp - 10}" class="c-lbl tiny" text-anchor="middle">now</text>`;
    return `<svg viewBox="0 0 ${Wd} ${H}" class="chart" role="img" aria-label="Tide height chart">${svg}</svg>`;
  }

  /* Fire, emergency and park-closure sources by state/territory. */
  const STATE_LINKS = {
    NSW: [['Fire danger ratings & total fire bans — NSW RFS', 'https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans'], ['Fires Near Me — NSW RFS', 'https://www.rfs.nsw.gov.au/fire-information/fires-near-me'], ['NSW National Parks alerts & closures', 'https://www.nationalparks.nsw.gov.au/alerts/alerts-list'], ['Hazards Near Me NSW (floods, storms)', 'https://www.nsw.gov.au/emergency/hazards-near-me']],
    VIC: [['VicEmergency — warnings & fire danger', 'https://emergency.vic.gov.au/'], ['Parks Victoria — park alerts & closures', 'https://www.parks.vic.gov.au/']],
    QLD: [['Queensland Fire Department — bushfire & fire danger', 'https://www.fire.qld.gov.au/'], ['Queensland National Parks — park alerts', 'https://parks.qld.gov.au/park-alerts']],
    SA: [['CFS — fire danger ratings & fire bans', 'https://www.cfs.sa.gov.au/'], ['National Parks and Wildlife Service SA — park closures', 'https://www.parks.sa.gov.au/']],
    WA: [['Emergency WA — warnings & fire danger', 'https://www.emergency.wa.gov.au/'], ['Parks and Wildlife WA — park alerts', 'https://alerts.dbca.wa.gov.au/']],
    TAS: [['Tasmania Fire Service — alerts & fire danger', 'https://www.fire.tas.gov.au/'], ['Parks & Wildlife Service Tasmania — alerts', 'https://parks.tas.gov.au/']],
    NT: [['SecureNT — emergency warnings', 'https://securent.nt.gov.au/'], ['NT parks — alerts & closures', 'https://nt.gov.au/parks']],
    ACT: [['ACT Emergency Services Agency', 'https://esa.act.gov.au/'], ['ACT Parks — closures & alerts', 'https://www.parks.act.gov.au/']]
  };

  function linksCard() {
    const { lat, lon, state } = T();
    const sl = STATE_LINKS[state] || Object.entries(STATE_LINKS).flatMap(([s, l]) => l.slice(0, 1).map(([t, u]) => [`${s}: ${t}`, u]));
    const li = ([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`;
    return `<div class="card no-print"><h3>Official sources${state ? ` for ${state}` : ''} — always check before you go</h3><ul class="links">
      ${li(['Bureau of Meteorology — forecasts & warnings', 'https://www.bom.gov.au/'])}
      ${li(['BOM official tide predictions', 'https://www.bom.gov.au/australia/tides/'])}
      ${li(['Australian Warning System — what warnings mean', 'https://www.australianwarningsystem.com.au/'])}
      ${sl.map(li).join('')}
      ${li(['Windy — wind, rain & swell maps for this spot', `https://www.windy.com/${num(lat).toFixed(3)}/${num(lon).toFixed(3)}?${num(lat).toFixed(3)},${num(lon).toFixed(3)},10`])}
    </ul><p class="muted small">Forecast data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</p></div>`;
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'wRefresh') { W().cache = null; W().marine = null; refresh(); }
      else if (b.id === 'wPick') { App.show('map'); MapView.setMode('camp'); }
      else if (b.dataset.alert) {
        Risk.add(alerts[+b.dataset.alert].preset);
        toast('Added to the risk assessment');
        root().innerHTML = view();
      }
    });
    r.addEventListener('change', e => {
      if (e.target.id !== 'wCoastal') return;
      T().coastal = e.target.checked;
      Store.save();
      render();
    });
  }

  const isFresh = () => T().lat != null && fresh(W().cache) && (!T().coastal || fresh(W().marine));
  return { render, refresh, isFresh, tidesSection, hourlyChart, wmo, dirText, tms, dayLabel, hhmm, locKey };
})();

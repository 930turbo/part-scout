const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M8 5l9 5"/>',
  radar:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7"/><circle cx="12" cy="12" r="1"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  message: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  car: '<path d="m5 7 2-3h10l2 3 2 4v8h-3v-3H6v3H3v-8zM4 10h16M7 13h1M16 13h1"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
};
const icon = (name, size = 17) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
$$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const money = (n) =>
  n === null
    ? 'Ask for price'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: n % 1 ? 2 : 0,
      }).format(n);
const date = (t) =>
  t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never';
const ago = (t) => {
  if (!t) return 'Not scanned';
  const minutes = Math.floor((Date.now() - t) / 60000);
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
let token = '',
  status = null,
  page = 1,
  search = '',
  monitorFilter = '',
  sort = 'newest',
  view = 'grid',
  active = true,
  activityView = 'scans',
  loading = false,
  requestVersion = 0;
const route = () =>
  ['overview', 'inventory', 'monitors', 'saved', 'activity', 'settings'].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : 'overview';
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 5000);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (response.status === 401) {
    auth();
    throw new Error('Connection requires an admin token.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function auth() {
  $('#content').innerHTML =
    `<div class="empty"><form class="auth-form" id="auth-form"><h2>Connect to Part Scout</h2><p>Enter the admin token configured on your server. It stays in memory for this browser session.</p><input type="password" name="token" placeholder="Admin token" aria-label="Admin token" required autocomplete="off"><button class="primary">Connect</button></form></div>`;
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    token = new FormData(e.target).get('token');
    await render().catch((e) => toast(e.message));
  };
}
const heading = (eyebrow, title, subtitle, buttons = '') =>
  `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${buttons}</div></div>`;
const addButton = `<button class="primary" data-action="add">${icon('plus')} Add monitor</button>`;
const pill = (m) =>
  `<span class="pill ${m.error ? 'error' : !m.enabled || m.provider === 'import' ? 'gray' : ''}">${m.error ? 'Needs attention' : !m.enabled ? 'Paused' : m.provider === 'import' ? 'Import only' : 'Monitoring'}</span>`;
const empty = (title, text, action = addButton) =>
  `<div class="empty">${icon('radar', 32)}<h2>${title}</h2><p>${text}</p>${action}</div>`;
function partArt(part) {
  const type = part.toLowerCase();
  let art;
  if (type.includes('hood'))
    art =
      '<path d="M24 16h72l13 49-49 10L11 65z" fill="#c6d0ba"/><path d="m35 24-6 37m56-37 6 37M30 65l30 5 30-5"/>';
  else if (type.includes('light'))
    art =
      '<path d="M18 28q0-10 10-10h70l7 35-78 15q-9 1-9-9Z" fill="#c4ceba"/><path d="M33 23v36M48 23v33M63 23v30M78 23v27M93 23v24"/>';
  else if (type.includes('transmission'))
    art =
      '<path d="m16 32 10-17 30 3 15 11 23 1 14 14-14 13-23 1-15 10-30-3-10-17Z" fill="#c1cdb6"/><path d="m31 20-8 15v11l8 14M43 20v44M57 24v35M73 33v21M87 33v21M100 37v13"/>';
  else
    art =
      '<path d="M25 23h65v37H25zM18 30h7v25h-7M90 34h13v14H90M32 15h48v8H32M35 60h12v9H35M72 60h12v9H72" fill="#bdcbb3"/><path d="M36 28v22M48 28v22M60 28v22M72 28v22M84 28v22M29 55h57M40 10v5M57 10v5M74 10v5"/>';
  return `<svg class="part-art" viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${art}</svg>`;
}
function card(l) {
  return `<article class="listing-card"><div class="part-preview">${l.image ? `<img src="${esc(l.image)}" alt="${esc(l.part)}" loading="lazy" referrerpolicy="no-referrer">` : partArt(l.part)}<span class="preview-badge">${l.active ? `GRADE ${esc(l.grade || '—')}` : 'STALE'}</span><button class="save-button ${l.saved ? 'saved' : ''}" data-action="save" data-id="${l.id}" aria-label="${l.saved ? 'Unsave' : 'Save'} ${esc(l.part)}" aria-pressed="${l.saved}">${icon('bookmark', 16)}</button></div><div class="listing-body"><div class="listing-type">${esc(l.part)}</div><button class="listing-title" data-action="detail" data-id="${l.id}">${l.year} ${esc(l.model)}</button><p class="listing-desc">${esc(l.description || 'No description provided')}</p><div class="listing-meta"><span>${l.miles === null ? 'Mileage unknown' : `${l.miles.toLocaleString()} mi`}</span><span>Stock ${esc(l.stock)}</span></div><div class="listing-price"><strong class="price">${money(l.price)}</strong><small>${ago(l.firstSeen)}</small></div><div class="dealer-row">${icon('pin', 13)}<span class="dealer-name">${esc(l.dealer)}</span><span class="location">${esc([l.city, l.state].filter(Boolean).join(', ') || 'Location unknown')}</span></div></div></article>`;
}
const toolbar = () =>
  `<div class="toolbar"><div class="search">${icon('search')}<input id="search" aria-label="Search inventory" placeholder="Search parts, vehicles, recyclers…" value="${esc(search)}"></div><select id="monitor-filter" aria-label="Filter by monitor"><option value="">All monitors</option>${status.monitors.map((m) => `<option value="${m.id}" ${String(m.id) === monitorFilter ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><select id="sort" aria-label="Sort inventory"><option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest first</option><option value="price" ${sort === 'price' ? 'selected' : ''}>Price: low to high</option><option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Oldest first</option></select><label class="check"><input id="active-filter" type="checkbox" ${active ? 'checked' : ''}> Active only</label><div class="view-toggle"><button data-action="grid" class="${view === 'grid' ? 'selected' : ''}" aria-label="Card view">${icon('grid', 15)}</button><button data-action="list" class="${view === 'list' ? 'selected' : ''}" aria-label="Table view">${icon('list', 15)}</button></div></div>`;
function inventoryMarkup(data) {
  if (!data.items.length)
    return empty(
      search || monitorFilter ? 'No matching parts' : 'Your inventory is empty',
      search || monitorFilter
        ? 'Try another search or adjust the monitor filter.'
        : 'Create a monitor, then connect a feed or import inventory to see your matches.',
      search || monitorFilter ? '<button data-action="clear">Clear filters</button>' : addButton,
    );
  if (view === 'grid') return `<div class="listing-grid">${data.items.map(card).join('')}</div>`;
  return `<div class="panel table-wrap"><table class="table"><thead><tr><th>Vehicle / part</th><th>Price</th><th>Condition</th><th>Recycler</th><th>Seen</th><th>Saved</th></tr></thead><tbody>${data.items.map((l) => `<tr><td><button class="listing-title" data-action="detail" data-id="${l.id}">${l.year} ${esc(l.model)}</button><small>${esc(l.part)} · ${esc(l.stock)}</small></td><td>${money(l.price)}</td><td>${esc(l.grade || '—')}<small>${l.miles === null ? 'Mileage unknown' : `${l.miles.toLocaleString()} mi`}</small></td><td>${esc(l.dealer)}<small>${esc(l.city)}, ${esc(l.state)}</small></td><td>${ago(l.firstSeen)}</td><td><button data-action="save" data-id="${l.id}" aria-label="Toggle bookmark" aria-pressed="${l.saved}">${icon('bookmark')}</button></td></tr>`).join('')}</tbody></table></div>`;
}
const dayBoundaries = () =>
  Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
function overview(data, analytics) {
  const successful = { length: analytics.reduce((n, day) => n + day.scans, 0) };
  const today = [{ added: analytics[6].added, drops: analytics[6].drops }];
  const days = dayBoundaries()
    .slice(0, 7)
    .map((at, i) => ({
      at,
      label: new Date(at).toLocaleDateString('en-US', { weekday: 'short' }),
      value: analytics[i].added,
    }));
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    heading(
      'Your workspace',
      'Garage overview',
      'Your searches, recent matches, and inventory in one place.',
      `<button data-action="export-csv">${icon('download', 15)} Export</button>${addButton}`,
    ) +
    `<div class="stats">${[
      [
        icon('box'),
        'Active matches',
        status.total,
        `<strong>${today.reduce((n, r) => n + r.added, 0)} new</strong> today`,
      ],
      [
        icon('radar'),
        'Active monitors',
        status.monitors.filter((m) => m.enabled && m.provider !== 'import').length,
        `${status.monitors.length} configured searches`,
      ],
      [icon('bookmark'), 'Saved parts', status.saved, 'Your bookmarked listings'],
      [
        icon('trend'),
        'Price drops',
        today.reduce((n, r) => n + r.drops, 0),
        'Across today’s scans',
      ],
    ]
      .map(
        ([i, label, value, detail]) =>
          `<div class="stat"><div class="stat-label">${label}${i}</div><div class="stat-value">${value}</div><div class="stat-footer">${detail}</div></div>`,
      )
      .join('')}</div>` +
    `<div class="overview-grid"><section class="panel"><div class="panel-head"><div><h2>Inventory activity</h2><small>New matches from the last 7 days</small></div><span class="tag">THIS WEEK</span></div><div class="chart" role="img" aria-label="New matches: ${days.map((d) => `${d.label} ${d.value}`).join(', ')}">${days.map((d) => `<div class="chart-column"><div class="chart-bar" data-height="${Math.max(3, (d.value / max) * 110)}"><span>${d.value}</span></div><span>${d.label}</span></div>`).join('')}</div><div class="chart-caption"><span class="chart-key">New matches</span><span>${successful.length} successful scans in retained activity</span></div></section><section class="panel"><div class="panel-head"><div><h2>Your monitors</h2><small>${status.monitors.length} saved searches</small></div><a class="text-link" href="#monitors">Manage ${icon('arrow', 13)}</a></div>${
      status.monitors
        .slice(0, 3)
        .map(
          (m) =>
            `<div class="monitor-mini"><div class="vehicle-icon">${icon('car', 21)}</div><div><h3>${esc(m.name)}</h3><small>${m.yearStart}–${m.yearEnd} · ${esc(m.part)}</small></div>${pill(m)}</div>`,
        )
        .join('') || '<div class="monitor-mini"><small>No monitors configured.</small></div>'
    }<div class="chart-caption"><span>${status.running ? 'Scan in progress' : status.settings.paused ? 'Scheduled scans paused' : 'Scheduler ready'}</span><a href="#activity" class="text-link">View activity ${icon('arrow', 12)}</a></div></section></div>` +
    `<div class="section-head"><h2>Latest matches <small>${data.total} in inventory</small></h2><a href="#inventory" class="text-link">View inventory ${icon('arrow', 13)}</a></div>${inventoryMarkup({ ...data, items: data.items.slice(0, 6) })}`
  );
}
function monitorsMarkup() {
  return (
    heading(
      'Search configuration',
      'Your monitors',
      'Choose the vehicles, parts, and conditions you want to track.',
      addButton,
    ) +
    (!status.monitors.length
      ? empty(
          'Create your first monitor',
          'Start with a vehicle and a part. Add filters to keep the results relevant.',
        )
      : `<div class="monitor-grid">${status.monitors.map((m) => `<section class="panel monitor-card"><div class="monitor-title"><div><div class="eyebrow">MONITOR ${m.id} · ${esc(m.provider)}</div><h2>${esc(m.name)}</h2></div>${pill(m)}</div><div class="monitor-spec">${icon('car', 15)} ${m.yearStart}–${m.yearEnd} ${esc(m.model)}</div><div class="monitor-spec">${icon('box', 15)} ${esc(m.part)} ${m.variant ? `· ${esc(m.variant)}` : ''}</div><div class="monitor-spec">${icon('pin', 15)} ${esc(m.zip)} ${m.region ? `· ${esc(m.region)}` : ''} ${m.maxPrice !== null ? `· Up to ${money(m.maxPrice)}` : ''}</div><div class="monitor-spec">${icon('clock', 15)} ${m.provider === 'import' ? 'Manual imports' : `Every ${m.intervalMinutes} minutes`} · ${ago(m.lastRun)}</div>${m.error ? `<p class="error-text">${esc(m.error)}</p>` : ''}<hr><div class="monitor-actions"><button data-action="edit" data-id="${m.id}">Edit search</button>${m.provider === 'import' ? '' : `<button data-action="scan" data-id="${m.id}" ${status.running !== null ? 'disabled' : ''}>${icon('refresh', 13)} Scan now</button>`}<button data-action="import" data-id="${m.id}">Import inventory</button><button data-action="toggle" data-id="${m.id}">${m.enabled ? 'Pause' : 'Enable'}</button><button class="danger" data-action="delete" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">Delete</button></div></section>`).join('')}</div>`)
  );
}
function settingsMarkup() {
  const s = status.settings;
  return (
    heading(
      'Workspace preferences',
      'Settings',
      'Configure scanning, notifications, and your integrations.',
    ) +
    `<div class="settings-layout"><section class="panel"><div class="panel-head"><h2>Monitoring & notifications</h2></div><form id="settings-form" class="settings-form"><div class="form-grid"><label class="check full"><input name="paused" type="checkbox" ${s.paused ? 'checked' : ''}> Pause all scheduled scans</label><label class="field">Request spacing (seconds)<input name="requestGapSeconds" type="number" min="2" max="120" value="${s.requestGapSeconds}" required><small>Global spacing between provider requests.</small></label><label class="field">Retention (days)<input name="retentionDays" type="number" min="7" max="3650" value="${s.retentionDays}" required><small>Activity, delivered alerts, and stale unsaved listings.</small></label><label class="field">Discord alerts<select name="notificationMode"><option value="instant" ${s.notificationMode === 'instant' ? 'selected' : ''}>Individual alerts</option><option value="digest" ${s.notificationMode === 'digest' ? 'selected' : ''}>Batched digest</option><option value="off" ${s.notificationMode === 'off' ? 'selected' : ''}>Off</option></select></label><label class="field">Digest window (minutes)<input name="digestMinutes" type="number" min="5" max="1440" value="${s.digestMinutes}" required><small>Alerts wait for this window, then send in batches of 10.</small></label></div><div class="form-footer"><button class="primary">Save settings</button></div></form></section><section class="panel"><div class="panel-head"><h2>Integrations</h2></div>${[
      [
        'Discord webhook',
        status.integrations.webhook,
        'DISCORD_WEBHOOK_URL',
        'Send new matches and price drops to a Discord channel.',
      ],
      [
        'Discord bot',
        status.integrations.bot,
        'DISCORD_BOT_TOKEN',
        'Run the bot process to use /scout commands. Token presence does not confirm bot connectivity.',
      ],
      [
        'Inventory feeds',
        status.integrations.feeds,
        'FEED_HOSTS',
        'Allow exact HTTPS hostnames for inventory feeds.',
      ],
      [
        'Car-Part adapter',
        status.integrations.carpart,
        'CAR_PART_ENABLED',
        'Enable automated access after obtaining provider permission.',
      ],
    ]
      .map(
        ([title, on, env, detail]) =>
          `<div class="integration"><div class="integration-head"><h3>${title}</h3><span class="pill ${on ? '' : 'gray'}">${on ? 'Configured' : 'Not configured'}</span></div><p>${detail}</p><code>${env}</code></div>`,
      )
      .join(
        '',
      )}</section><section class="panel"><div class="panel-head"><h2>Data & configuration</h2></div><div class="settings-form"><p><small>Export your searches and settings, or move them to another instance. Configuration imports add monitors. Secrets remain in the server environment.</small></p><div class="monitor-actions"><button data-action="export-config">${icon('download', 14)} Export configuration</button><button data-action="import-config">Import configuration</button><button data-action="export-csv">Export inventory CSV</button></div></div></section><section class="panel"><div class="panel-head"><h2>About Part Scout</h2></div><div class="settings-form"><p><small>Version ${esc(status.version)} · A self-hosted workspace for parts inventory.</small></p><p><small>Original concept by <a href="https://github.com/dzt/car-part-monitor" target="_blank" rel="noreferrer">Peter Soboyejo (dzt) ↗</a>.</small></p><button data-action="disconnect">Disconnect browser session</button></div></section></div>`
  );
}
async function render() {
  const version = ++requestVersion;
  const current = route();
  loading = true;
  try {
    const nextStatus = await api('/status');
    if (version !== requestVersion) return;
    status = nextStatus;
    $('#nav-count').textContent = status.total;
    $('#discord-dot').classList.toggle('connected', status.integrations.webhook);
    $('#system-status').firstChild.textContent = status.settings.paused
      ? 'Scheduler paused'
      : status.running
        ? 'Scanning inventory'
        : 'System ready';
    $('#system-sub').textContent = status.failedDeliveries
      ? `${status.failedDeliveries} alerts need attention`
      : `${status.monitors.length} monitors configured`;
    $('#demo-label').hidden = !status.demo;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === current));
    $('#crumb').textContent = {
      overview: 'Overview',
      inventory: 'Inventory',
      monitors: 'Monitors',
      saved: 'Saved parts',
      activity: 'Activity',
      settings: 'Settings',
    }[current];
    let html;
    if (current === 'overview') {
      const [data, analytics] = await Promise.all([
        api('/listings?limit=30'),
        api(`/analytics?days=${dayBoundaries().join(',')}`),
      ]);
      html = overview(data, analytics);
    }
    if (current === 'inventory' || current === 'saved') {
      const data = await api(
        `/listings?${new URLSearchParams({ q: search, monitor: monitorFilter, sort, page: String(page), saved: String(current === 'saved'), active: String(active) })}`,
      );
      html =
        heading(
          current === 'saved' ? 'Your shortlist' : 'Parts catalog',
          current === 'saved' ? 'Saved parts' : 'Inventory',
          current === 'saved'
            ? 'Bookmarked listings and notes for your next project.'
            : 'Browse your matches. Compare prices, condition, and recyclers.',
          `<button data-action="export-csv">${icon('download', 15)} Export CSV</button>${addButton}`,
        ) +
        toolbar() +
        `<div id="inventory-results">${inventoryMarkup(data)}<div class="pagination"><span>${data.total ? (page - 1) * 30 + 1 : 0}–${Math.min(page * 30, data.total)} of ${data.total} matches</span><div><button data-action="prev" ${page <= 1 ? 'disabled' : ''}>Previous</button><button data-action="next" ${page * 30 >= data.total ? 'disabled' : ''}>Next</button></div></div></div>`;
    }
    if (current === 'monitors') html = monitorsMarkup();
    if (current === 'settings') html = settingsMarkup();
    if (current === 'activity') {
      const rows = await api(activityView === 'scans' ? '/runs' : '/deliveries');
      html =
        heading(
          'Operational history',
          'Activity',
          'Review scans, provider errors, and Discord delivery attempts.',
        ) +
        `<div class="activity-tabs"><button data-action="scans" class="${activityView === 'scans' ? 'selected' : ''}">Scan history</button><button data-action="deliveries" class="${activityView === 'deliveries' ? 'selected' : ''}">Discord deliveries ${status.deliveries ? `(${status.deliveries})` : ''}</button></div>` +
        (!rows.length
          ? empty(
              'No activity yet',
              'Completed scans and queued alerts will appear here.',
              '<a class="text-link" href="#monitors">Go to monitors →</a>',
            )
          : `<div class="panel table-wrap"><table class="table"><thead><tr>${(activityView === 'scans' ? ['Monitor', 'Status', 'Results', 'Duration', 'Time'] : ['Delivery', 'Status', 'Attempts', 'Next attempt', 'Action']).map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => (activityView === 'scans' ? `<tr><td>${esc(r.name)}<small>${r.error ? esc(r.error) : `Scan #${r.id}`}</small></td><td><span class="pill ${r.status === 'failed' ? 'error' : ''}">${r.status}</span></td><td>${r.seen} seen<small>${r.added} new · ${r.drops} drops</small></td><td>${(r.duration / 1000).toFixed(1)}s</td><td>${ago(r.started)}<small>${new Date(r.started).toLocaleString()}</small></td></tr>` : `<tr><td>#${r.id}<small>${r.error ? esc(r.error) : date(r.created)}</small></td><td><span class="pill ${r.status === 'failed' ? 'error' : r.status === 'sent' ? '' : 'gray'}">${r.status}</span></td><td>${r.attempts}</td><td>${r.status === 'pending' ? new Date(r.due).toLocaleString() : '—'}</td><td>${r.status === 'failed' ? `<button data-action="retry" data-id="${r.id}">Retry</button>` : '—'}</td></tr>`)).join('')}</tbody></table></div>`);
    }
    if (version !== requestVersion) return;
    const focused = document.activeElement?.id === 'search',
      cursor = focused ? $('#search').selectionStart : null;
    $('#content').innerHTML = html;
    // CSP uses an external stylesheet; dynamic chart sizes are applied as style properties.
    $$('.chart-bar').forEach((el) => {
      el.style.height = `${el.dataset.height}px`;
    });
    bindForms();
    if (focused && $('#search')) {
      $('#search').focus();
      $('#search').setSelectionRange(cursor, cursor);
    }
  } finally {
    loading = false;
  }
}
function dialog(title, body) {
  $('#dialog-content').innerHTML =
    `<div class="dialog-header"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close', 20)}</button></div><div class="dialog-body">${body}</div>`;
  if (!$('#dialog').open) $('#dialog').showModal();
}
const fields = [
  ['name', 'Monitor name', 'text'],
  ['model', 'Vehicle model', 'text'],
  ['part', 'Part name', 'text'],
  ['zip', 'ZIP code', 'text'],
  ['yearStart', 'Starting year', 'number'],
  ['yearEnd', 'Ending year', 'number'],
  ['region', 'Provider region', 'text'],
  ['variant', 'Interchange variant', 'text'],
  ['intervalMinutes', 'Scan interval (minutes)', 'number'],
  ['maxPrice', 'Maximum price ($)', 'number'],
  ['maxMiles', 'Maximum mileage', 'number'],
  ['maxDistance', 'Maximum distance (mi)', 'number'],
  ['include', 'Required keywords (comma separated)', 'text'],
  ['exclude', 'Excluded keywords (comma separated)', 'text'],
  ['states', 'States (e.g. MA, CT)', 'text'],
  ['grades', 'Grades (e.g. A, B)', 'text'],
  ['pageLimit', 'Provider page limit (1–20)', 'number'],
];
function editor(id) {
  const m = id
    ? { pageLimit: 5, ...status.monitors.find((m) => m.id === Number(id)) }
    : {
        name: '',
        model: '',
        part: '',
        zip: '',
        yearStart: 2000,
        yearEnd: 2005,
        region: '',
        variant: '',
        provider: 'import',
        feedUrl: '',
        intervalMinutes: 60,
        pageLimit: 5,
        maxPrice: null,
        maxMiles: null,
        maxDistance: null,
        include: '',
        exclude: '',
        states: '',
        grades: '',
        enabled: true,
        allowUnknownPrice: true,
        allowUnknownMiles: true,
        allowUnknownDistance: true,
        notifyInitial: false,
        notifyNew: true,
        notifyDrops: true,
      };
  dialog(
    id ? 'Edit monitor' : 'Add a monitor',
    `<form id="monitor-form"><div class="form-section">Search details</div><div class="form-grid">${fields.map(([name, label, type], i) => `${i === 8 ? '<div class="form-section full">Schedule & filters</div>' : ''}<label class="field">${label}<input name="${name}" type="${type}" value="${esc(m[name] ?? '')}" ${['name', 'model', 'part', 'zip', 'yearStart', 'yearEnd', 'intervalMinutes'].includes(name) ? 'required' : ''} ${name === 'zip' ? 'pattern="[0-9]{5}" maxlength="5"' : type === 'number' ? `min="${name === 'intervalMinutes' ? 15 : name.startsWith('year') ? 1900 : 0}" ${name.startsWith('year') ? 'max="2100"' : ''} step="${name === 'maxPrice' ? '0.01' : '1'}"` : ''}></label>`).join('')}<div class="form-section full">Inventory source</div><label class="field">Provider<select name="provider">${[
      ['import', 'File import'],
      ['feed', 'HTTPS JSON feed'],
      ['carpart', 'Car-Part (authorized access)'],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}" ${m.provider === v ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label><label class="field">Feed URL<input name="feedUrl" value="${esc(m.feedUrl)}" placeholder="https://inventory.example.com/feed"><small>Feed host must be in FEED_HOSTS.</small></label><div class="form-section full">Alert preferences</div><label class="field full">Discord destination<select name="destination">${[...new Set(['default', ...(status.destinations || []), m.destination || 'default'])].map((name) => `<option value="${esc(name)}" ${name === (m.destination || 'default') ? 'selected' : ''}>${esc(name)}${status.destinations?.includes(name) ? '' : ' (not configured)'}</option>`).join('')}</select><small>Webhook credentials stay on the server.</small></label>${[
      ['enabled', 'Enable scheduled scans'],
      ['allowUnknownPrice', 'Include unknown prices'],
      ['allowUnknownMiles', 'Include unknown mileage'],
      ['allowUnknownDistance', 'Include unknown distance'],
      ['notifyInitial', 'Alert on the first import or scan'],
      ['notifyNew', 'Alert on new matches'],
      ['notifyDrops', 'Alert on price drops'],
    ]
      .map(
        ([name, label]) =>
          `<label class="check"><input type="checkbox" name="${name}" ${m[name] ? 'checked' : ''}>${label}</label>`,
      )
      .join(
        '',
      )}</div><div class="form-footer"><button type="button" data-action="close">Cancel</button><button class="primary">${id ? 'Save changes' : 'Create monitor'}</button></div></form>`,
  );
  $('#monitor-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const config = {};
    for (const [name, , type] of fields)
      config[name] =
        type === 'number'
          ? String(form.get(name)).trim() === ''
            ? null
            : Number(form.get(name))
          : form.get(name);
    for (const name of ['provider', 'feedUrl', 'destination']) config[name] = form.get(name);
    for (const name of [
      'enabled',
      'allowUnknownPrice',
      'allowUnknownMiles',
      'allowUnknownDistance',
      'notifyInitial',
      'notifyNew',
      'notifyDrops',
    ])
      config[name] = form.has(name);
    const button = $('button.primary', e.target);
    button.disabled = true;
    try {
      await api(id ? `/monitors/${id}` : '/monitors', id ? 'PUT' : 'POST', config);
      $('#dialog').close();
      toast(id ? 'Monitor updated' : 'Monitor created');
      await render();
    } catch (e) {
      toast(e.message);
    } finally {
      button.disabled = false;
    }
  };
}
async function detail(id) {
  const l = await api(`/listings/${id}`);
  const prices = l.history.filter((p) => p.price !== null);
  const max = Math.max(1, ...prices.map((p) => p.price));
  const min = Math.min(...prices.map((p) => p.price));
  const range = max - min || 1;
  const points = prices
    .map(
      (p, i) =>
        `${30 + (i / Math.max(1, prices.length - 1)) * 500},${105 - ((p.price - min) / range) * 75}`,
    )
    .join(' ');
  dialog(
    `${l.year} ${esc(l.model)}`,
    `<div class="eyebrow">${esc(l.part)} · STOCK ${esc(l.stock)}</div><div class="detail-price">${money(l.price)}</div><p>${esc(l.description || 'No description provided')}</p><div class="detail-spec">${[
      ['Recycler', l.dealer],
      ['Location', [l.city, l.state].filter(Boolean).join(', ') || 'Unknown'],
      ['Mileage', l.miles === null ? 'Unknown' : `${l.miles.toLocaleString()} mi`],
      ['Grade', l.grade || 'Unknown'],
      ['Phone', l.phone || 'Not provided'],
      ['Distance', l.distance === null ? 'Unknown' : `${l.distance} mi`],
    ]
      .map(([label, value]) => `<div><small>${label}</small>${esc(value)}</div>`)
      .join('')}</div><div class="form-section">Price history</div>${
      prices.length
        ? `<svg class="price-chart" viewBox="0 0 560 140" role="img" aria-label="${prices.map((p) => `${money(p.price)} on ${date(p.at)}`).join(', ')}"><path d="M30 110h500M30 65h500M30 20h500" stroke="#e1e9d9" fill="none"/><polyline points="${points}" stroke="#668856" stroke-width="2.5" fill="none"/>${prices.map((p, i) => `<circle cx="${30 + (i / Math.max(1, prices.length - 1)) * 500}" cy="${105 - ((p.price - min) / range) * 75}" r="4" fill="#668856"/>`).join('')}</svg><div class="detail-history"><span>${date(prices[0].at)}</span><span>${date(prices.at(-1).at)}</span></div><div class="price-list">${prices
            .slice(-10)
            .map((p) => `<span>${date(p.at)} · ${money(p.price)}</span>`)
            .join('')}</div>`
        : '<p>No quoted price recorded yet.</p>'
    }<form id="note-form"><label class="field">Your notes<textarea name="note" rows="3" maxlength="2000" placeholder="Compatibility, contact details, or next steps…">${esc(l.note)}</textarea></label><label class="check"><input type="checkbox" name="saved" ${l.saved ? 'checked' : ''}> Save this part</label><div class="form-footer">${l.url ? `<a class="text-link" href="${esc(l.url)}" target="_blank" rel="noreferrer">Open recycler listing ↗</a>` : ''}<button class="primary">Save notes</button></div></form>`,
  );
  $('#note-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      await api(`/listings/${id}`, 'PATCH', { saved: data.has('saved'), note: data.get('note') });
      toast('Notes saved');
      $('#dialog').close();
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
function importInventory(id) {
  dialog(
    'Import inventory',
    `<form id="inventory-import-form"><p>Choose a JSON inventory file or a saved Car-Part results page. Partial snapshots add or update listings without aging unseen inventory.</p><label class="field">Inventory file<input name="file" type="file" accept=".json,.html,.htm" required></label><p><label class="check"><input name="complete" type="checkbox"> This JSON file contains a complete snapshot</label></p><div class="form-footer"><button type="button" data-action="close">Cancel</button><button class="primary">Import inventory</button></div></form>`,
  );
  $('#inventory-import-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const file = form.get('file');
    if (file.size > 5_000_000) return toast('Choose a file smaller than 5 MB.');
    try {
      const text = await file.text();
      const data = /\.html?$/i.test(file.name)
        ? { html: text }
        : {
            listings: Array.isArray(JSON.parse(text))
              ? JSON.parse(text)
              : JSON.parse(text).listings,
            complete: form.has('complete'),
          };
      const result = await api(`/monitors/${id}/import`, 'POST', data);
      $('#dialog').close();
      toast(`${result.seen} listings imported · ${result.added} new matches`);
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
async function download(path, name) {
  const response = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Export failed. Check your connection.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export downloaded');
}
function bindForms() {
  let timer;
  if ($('#search'))
    $('#search').oninput = (e) => {
      search = e.target.value;
      page = 1;
      clearTimeout(timer);
      timer = setTimeout(() => render().catch((e) => toast(e.message)), 250);
    };
  if ($('#monitor-filter'))
    $('#monitor-filter').onchange = (e) => {
      monitorFilter = e.target.value;
      page = 1;
      void render().catch((e) => toast(e.message));
    };
  if ($('#sort'))
    $('#sort').onchange = (e) => {
      sort = e.target.value;
      page = 1;
      void render().catch((e) => toast(e.message));
    };
  if ($('#active-filter'))
    $('#active-filter').onchange = (e) => {
      active = e.target.checked;
      page = 1;
      void render().catch((e) => toast(e.message));
    };
  if ($('#settings-form'))
    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/settings', 'PUT', {
          paused: f.has('paused'),
          retentionDays: Number(f.get('retentionDays')),
          requestGapSeconds: Number(f.get('requestGapSeconds')),
          notificationMode: f.get('notificationMode'),
          digestMinutes: Number(f.get('digestMinutes')),
        });
        toast('Settings saved');
        await render();
      } catch (e) {
        toast(e.message);
      }
    };
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action,
    id = b.dataset.id;
  try {
    if (action === 'close') return $('#dialog').close();
    if (action === 'add' || action === 'edit') return editor(id);
    if (action === 'detail') return await detail(id);
    if (action === 'import') return importInventory(id);
    if (action === 'save') {
      const l = await api(`/listings/${id}`);
      await api(`/listings/${id}`, 'PATCH', { saved: !l.saved, note: l.note });
      toast(l.saved ? 'Part removed from saved' : 'Part saved');
    }
    if (action === 'scan') {
      b.disabled = true;
      b.textContent = 'Scanning…';
      const result = await api(`/monitors/${id}/scan`, 'POST');
      toast(`${result.seen} listings · ${result.added} new · ${result.drops} drops`);
    }
    if (action === 'toggle') {
      const {
        lastRun,
        nextRun,
        error,
        failures,
        initialized,
        id: mid,
        ...m
      } = status.monitors.find((m) => String(m.id) === id);
      await api(`/monitors/${id}`, 'PUT', { ...m, enabled: !m.enabled });
    }
    if (action === 'delete') {
      dialog(
        'Delete monitor?',
        `<p>This removes the search and its inventory associations. Saved listing records remain in the database. Export your configuration first if you may need this search again.</p><div class="form-footer"><button data-action="close">Cancel</button><button class="danger" data-action="confirm-delete" data-id="${id}">Delete monitor</button></div>`,
      );
      return;
    }
    if (action === 'confirm-delete') {
      await api(`/monitors/${id}`, 'DELETE');
      $('#dialog').close();
      toast('Monitor deleted');
    }
    if (action === 'retry') {
      await api(`/deliveries/${id}/retry`, 'POST');
      toast('Delivery queued for retry');
    }
    if (action === 'grid' || action === 'list') view = action;
    if (action === 'scans' || action === 'deliveries') activityView = action;
    if (action === 'prev') page = Math.max(1, page - 1);
    if (action === 'next') page++;
    if (action === 'clear') {
      search = '';
      monitorFilter = '';
      page = 1;
    }
    if (action === 'export-csv')
      return await download('/export/listings', 'part-scout-inventory.csv');
    if (action === 'export-config')
      return await download('/export/config', 'part-scout-config.json');
    if (action === 'import-config') {
      dialog(
        'Import configuration',
        '<form id="config-import-form"><p>This adds the searches from your export and applies its workspace settings.</p><label class="field">Configuration JSON<input type="file" name="file" accept=".json" required></label><div class="form-footer"><button class="primary">Import configuration</button></div></form>',
      );
      $('#config-import-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const file = new FormData(e.target).get('file');
          if (file.size > 1_000_000) throw new Error('Configuration file is too large.');
          const result = await api('/import/config', 'POST', JSON.parse(await file.text()));
          $('#dialog').close();
          toast(`${result.added} monitors imported`);
          await render();
        } catch (e) {
          toast(e.message);
        }
      };
      return;
    }
    if (action === 'disconnect') {
      token = '';
      return auth();
    }
    await render();
  } catch (e) {
    toast(e.message);
    if (action === 'scan') await render().catch(() => {});
  }
});
$('#refresh').onclick = () => render().catch((e) => toast(e.message));
$('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
window.addEventListener('hashchange', () => {
  page = 1;
  search = '';
  monitorFilter = '';
  active = route() !== 'saved';
  $('.sidebar').classList.remove('open');
  render().catch((e) => toast(e.message));
});
$('#dialog').addEventListener('click', (e) => {
  if (e.target === $('#dialog')) {
    const r = $('#dialog').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      $('#dialog').close();
  }
});
setInterval(() => {
  if (
    status &&
    !loading &&
    !$('#dialog').open &&
    !['settings'].includes(route()) &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
  )
    render().catch(() => {});
}, 30000);
active = route() !== 'saved';
render().catch((e) => {
  if (!$('#auth-form')) {
    $('#content').innerHTML = empty(
      'Unable to connect',
      esc(e.message),
      '<button data-action="clear">Try again</button>',
    );
  }
});

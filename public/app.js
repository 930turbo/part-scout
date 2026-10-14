import { icon } from './icons.js';
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (n, currency = 'USD') =>
  n === null
    ? 'Ask for price'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: n % 1 ? 2 : 0,
      }).format(n);
const ago = (t) =>
  !t
    ? 'Not scanned'
    : Date.now() - t < 60000
      ? 'Just now'
      : Date.now() - t < 3600000
        ? `${Math.floor((Date.now() - t) / 60000)}m ago`
        : Date.now() - t < 86400000
          ? `${Math.floor((Date.now() - t) / 3600000)}h ago`
          : `${Math.floor((Date.now() - t) / 86400000)}d ago`;
const date = (t) => new Date(t).toLocaleString();
const labels = {
  overview: 'Overview',
  garage: 'Your garage',
  inventory: 'Inventory',
  monitors: 'Monitors',
  saved: 'Saved parts',
  activity: 'Activity',
  settings: 'Settings',
};
const route = () =>
  Object.hasOwn(labels, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let token = '',
  state = null,
  catalog = [],
  version = 0,
  page = 1,
  query = '',
  monitorFilter = '',
  sort = 'newest',
  view = 'grid',
  active = route() !== 'saved',
  activityTab = 'scans',
  streamAbort,
  detailListing,
  photoIndex = 0,
  lastRefresh = 0;
const referencePhotos = {
  Transmission: {
    url: '/reference/transmission.png',
    source: 'https://toppng.com/show_download/135498/transmission-png',
  },
  Turbocharger: {
    url: 'https://www.pngfind.com/pngs/m/468-4680389_turbo-png-transparent-background-garrett-turbo-png-download.png',
    source:
      'https://www.pngfind.com/mpng/hixwRJw_turbo-png-transparent-background-garrett-turbo-png-download/',
  },
  Caliper: {
    url: 'https://www.vhv.rs/dpng/d/558-5584293_brembo-png-download-brembo-png-transparent-png.png',
    source: 'https://www.vhv.rs/viewpic/TRmwxJi_brembo-png-download-brembo-png-transparent-png/',
  },
  Headlight: {
    url: 'https://image.pngaaa.com/759/1149759-middle.png',
    source: 'https://www.pngaaa.com/detail/1149759',
  },
  Alternator: {
    url: 'https://e7.pngegg.com/pngimages/584/138/png-clipart-car-toyota-tundra-alternator-electricity-automotive-industry-lincoln-motor-company-vehicle-transport.png',
    source: 'https://www.pngegg.com/ar/png-zlqde',
  },
};
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
    throw new Error('Enter the admin token to connect.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function auth() {
  streamAbort?.abort();
  state = null;
  $('#content').innerHTML =
    `<div class="empty"><form id="auth-form" class="auth-form"><h2>Connect to Part Scout</h2><p>Enter your server's admin token. Desktop sessions connect automatically.</p><input name="token" type="password" aria-label="Admin token" autocomplete="off" required><button class="primary">Connect</button></form></div>`;
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    token = new FormData(e.target).get('token');
    try {
      await render();
      connectEvents();
    } catch (e) {
      toast(e.message);
    }
  };
}
function applyTheme() {
  const s = state.settings;
  document.documentElement.dataset.theme =
    s.theme === 'system'
      ? matchMedia('(prefers-color-scheme:dark)').matches
        ? 'dark'
        : 'light'
      : s.theme;
  document.documentElement.dataset.accent = s.accent;
  document.documentElement.dataset.motion = s.animations ? 'on' : 'off';
  if (window.scoutDesktop) {
    document.documentElement.dataset.desktop = 'true';
    void window.scoutDesktop.appearance(s.theme).catch(() => {});
  }
  localStorage.setItem('scout-theme', JSON.stringify({ theme: s.theme, accent: s.accent }));
}
try {
  const p = JSON.parse(localStorage.getItem('scout-theme') || 'null');
  if (p) {
    document.documentElement.dataset.theme =
      p.theme === 'system'
        ? matchMedia('(prefers-color-scheme:dark)').matches
          ? 'dark'
          : 'light'
        : p.theme;
    document.documentElement.dataset.accent = p.accent;
  }
} catch {}
const action = (name, label, style = '', id = '') =>
  `<button class="${style}" data-action="${name}" ${id ? `data-id="${esc(id)}"` : ''}>${label}</button>`;
const addButton = action('add', `${icon('plus')} Add monitor`, 'primary');
const heading = (label, title, description, buttons = '') =>
  `<div class="heading"><div><div class="eyebrow">${esc(label)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${buttons}</div></div>`;
const empty = (title, text, buttons = addButton) =>
  `<div class="empty"><div class="empty-mark">${icon('radar', 32)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="empty-actions">${buttons}</div></div>`;
const pill = (m) =>
  `<span class="pill ${m.error ? 'error' : !m.enabled || m.provider === 'import' ? 'gray' : ''}">${m.error ? 'Needs attention' : !m.enabled ? 'Paused' : m.provider === 'import' ? 'Import only' : state.running === m.id ? 'Scanning' : 'Monitoring'}</span>`;
const photos = (l) => [...new Set([l.image, ...(l.images || [])].filter(Boolean))];
const reference = (l) =>
  state.monitors.find((m) => m.referencePhoto && l.monitors?.includes(m.id))?.referencePhoto ||
  (l.part === 'Engine' && /BMW.*(325|E30|M20)/i.test(l.model)
    ? '/reference/bmw-m20.png'
    : l.part === 'Hood' && /Porsche.*911/i.test(l.model)
      ? '/reference/porsche-911-hood.png'
      : referencePhotos[l.part]?.url);
function card(l) {
  const images = photos(l),
    photo = images[0] || reference(l);
  return `<article class="listing-card"><div class="part-preview">${photo ? `<img src="${esc(photo)}" alt="${esc(l.part)} ${images.length ? 'seller photo' : 'reference photo'}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="photo-missing">No seller photo</span>'}<span class="preview-badge">${images.length ? `${esc(l.source)} · ${images.length} photo${images.length === 1 ? '' : 's'}` : photo ? 'Reference photo' : 'Photo unavailable'}</span><button class="save-button ${l.saved ? 'saved' : ''}" data-action="save" data-id="${l.id}" aria-label="${l.saved ? 'Unsave' : 'Save'} ${esc(l.part)}" aria-pressed="${l.saved}">${icon('bookmark', 17)}</button></div><div class="listing-body"><div class="listing-type">${esc(l.part)} <span>${l.active ? 'Active' : 'Stale'}</span></div><button class="listing-title" data-action="detail" data-id="${l.id}">${l.year} ${esc(l.model)}</button><p class="listing-desc">${esc(l.description || 'No description provided')}</p><div class="listing-meta"><span>${esc(l.condition || `Grade ${l.grade || 'unknown'}`)}</span><span>${l.miles === null ? 'Mileage unknown' : `${l.miles.toLocaleString()} mi`}</span></div><div class="listing-price"><strong class="price">${money(l.price, l.currency)}</strong><small>${ago(l.firstSeen)}</small></div><div class="dealer-row">${icon('pin', 13)}<span>${esc(l.dealer)}</span><small>${esc([l.city, l.state].filter(Boolean).join(', '))}</small></div><div class="card-actions">${action('detail', 'View details', '', l.id)}${l.url ? action('seller', l.buyingOptions.includes('AUCTION') ? 'View / bid' : l.buyingOptions.includes('FIXED_PRICE') ? 'Buy from seller' : l.urlKind === 'seller' ? 'Visit seller' : 'Open listing', 'primary', l.id) : ''}</div></div></article>`;
}
function inventoryMarkup(data) {
  if (!data.items.length)
    return empty(
      query || monitorFilter ? 'No matching parts' : 'No parts found yet',
      query || monitorFilter
        ? 'Adjust your search or monitor filter.'
        : 'Connect a source and run a monitor, or import a saved results file.',
      query || monitorFilter ? action('clear', 'Clear filters') : addButton,
    );
  if (view === 'grid') return `<div class="listing-grid">${data.items.map(card).join('')}</div>`;
  return `<div class="panel table-wrap"><table class="table"><thead><tr><th>Vehicle / part</th><th>Price</th><th>Condition</th><th>Seller</th><th>Found</th><th>Actions</th></tr></thead><tbody>${data.items.map((l) => `<tr><td><button class="listing-title" data-action="detail" data-id="${l.id}">${l.year} ${esc(l.model)}</button><small>${esc(l.part)} · ${esc(l.stock)}</small></td><td>${money(l.price, l.currency)}</td><td>${esc(l.condition || l.grade || 'Unknown')}</td><td>${esc(l.dealer)}<small>${esc(l.city)}, ${esc(l.state)}</small></td><td>${ago(l.firstSeen)}</td><td>${action('save', icon('bookmark'), '', l.id)}${l.url ? action('seller', 'Open', '', l.id) : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
const boundaries = () =>
  Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
function overview(data, analytics) {
  const today = analytics.at(-1),
    maximum = Math.max(1, ...analytics.map((d) => d.added));
  return (
    heading(
      'Personal workspace',
      'Garage overview',
      'Inventory, projects, and searches at a glance.',
      `${action('garage-edit', 'Edit garage')}${addButton}`,
    ) +
    (!state.monitors.length
      ? `<div class="onboarding panel"><div><span class="tag">GET STARTED</span><h2>Set up your real workspace</h2><p>Add your car, choose the parts you need, then connect Discord and an inventory source.</p></div><div>${action('car-add', `${icon('car')} Add a car`, 'primary')}<a class="button" href="#settings">Connect sources ${icon('arrow')}</a></div></div>`
      : '') +
    `<div class="stats">${[
      ['box', 'Active matches', state.total, `${today.added} new today`],
      [
        'radar',
        'Monitors',
        state.monitors.filter((m) => m.enabled && m.provider !== 'import').length,
        `${state.monitors.length} configured`,
      ],
      [
        'car',
        'Garage projects',
        state.cars.length,
        `${state.cars.reduce((n, c) => n + c.checklist.filter((p) => p.status === 'wanted').length, 0)} wanted parts`,
      ],
      ['trend', 'Price drops', today.drops, 'From successful scans today'],
    ]
      .map(
        ([i, label, value, foot]) =>
          `<div class="stat"><div class="stat-label">${label}${icon(i, 19)}</div><div class="stat-value">${value}</div><div class="stat-footer">${foot}</div></div>`,
      )
      .join(
        '',
      )}</div><div class="overview-grid"><section class="panel"><div class="panel-head"><div><h2>Inventory activity</h2><small>New matches over the last seven days</small></div><span class="live-tag"><span></span> LIVE</span></div><div class="chart" role="img" aria-label="Daily new inventory matches">${analytics.map((d, i) => `<div class="chart-column"><div class="chart-bar" data-height="${Math.max(3, (d.added / maximum) * 110)}"><span>${d.added}</span></div><span>${new Date(boundaries()[i]).toLocaleDateString('en-US', { weekday: 'short' })}</span></div>`).join('')}</div><div class="chart-caption"><span>${analytics.reduce((n, d) => n + d.scans, 0)} successful scans this week</span><a href="#activity">View activity →</a></div></section><section class="panel"><div class="panel-head"><div><h2>Monitoring</h2><small>${state.running === null ? 'Scheduler ready' : 'Scan in progress'}</small></div><a href="#monitors" class="text-link">Manage →</a></div>${
      state.monitors
        .slice(0, 3)
        .map(
          (m) =>
            `<div class="monitor-mini"><div class="vehicle-icon">${icon('radar', 21)}</div><div><h3>${esc(m.name)}</h3><small>${esc(m.provider)} · ${ago(m.lastRun)}</small></div>${pill(m)}</div>`,
        )
        .join('') ||
      '<div class="monitor-mini"><small>Your monitors will appear here.</small></div>'
    }<div class="chart-caption"><span>${state.deliveries} queued Discord alerts</span><a href="#settings">Connections →</a></div></section></div><div class="section-head"><h2>Latest matches <small>${data.total} total</small></h2><a class="text-link" href="#inventory">View inventory →</a></div>${inventoryMarkup({ ...data, items: data.items.slice(0, 6) })}`
  );
}
function monitorsMarkup() {
  return (
    heading(
      'Saved searches',
      'Your monitors',
      'Track vehicles and parts across supported inventory sources.',
      `${action('templates', `${icon('grid')} Part presets`)}${addButton}`,
    ) +
    (!state.monitors.length
      ? empty(
          'Create your first monitor',
          'Use a preset or build your own search. Source setup is available in Settings.',
          `${action('templates', 'Browse 48 part presets')}${addButton}`,
        )
      : `<div class="monitor-grid">${state.monitors.map((m) => `<section class="panel monitor-card"><div class="monitor-title"><div><div class="eyebrow">${esc(m.provider)} · MONITOR ${m.id}</div><h2>${esc(m.name)}</h2></div>${pill(m)}</div><div class="monitor-spec">${icon('car')} ${m.yearStart}–${m.yearEnd} ${esc(m.model)}</div><div class="monitor-spec">${icon('box')} ${esc(m.part)}${m.variant ? ` · ${esc(m.variant)}` : ''}</div><div class="monitor-spec">${icon('pin')} ${esc(m.zip)} ${m.maxPrice !== null ? `· Up to ${money(m.maxPrice)}` : ''}</div><div class="monitor-spec">${icon('clock')} ${m.provider === 'import' ? 'Manual imports' : `Every ${m.intervalMinutes} minutes`} · ${ago(m.lastRun)}</div>${m.error ? `<p class="error-text">${esc(m.error)}</p>` : ''}<hr><div class="monitor-actions">${action('edit', 'Edit search', '', m.id)}${m.provider === 'import' ? '' : action('scan', `${icon('refresh', 13)} Scan now`, '', m.id)}${action('import', 'Import inventory', '', m.id)}${action('monitor-export', `${icon('download', 13)} Excel export`, '', m.id)}${action('toggle', m.enabled ? 'Pause' : 'Enable', '', m.id)}<button class="danger" data-action="delete" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">Delete</button></div></section>`).join('')}</div>`)
  );
}
function garageMarkup() {
  return (
    heading(
      'Project cars',
      state.garage.name,
      'Your cars, parts checklists, purchases, and build notes.',
      `${action('garage-edit', 'Edit garage')}${action('car-add', `${icon('plus')} Add a car`, 'primary')}`,
    ) +
    (!state.cars.length
      ? empty(
          'Add your first car',
          'Upload photos, make a parts checklist, and keep track of what you have bought.',
          action('car-add', 'Add a car', 'primary'),
        )
      : `<div class="garage-grid">${state.cars.map((c) => `<section class="panel car-card"><div class="car-photo">${c.photos[0] ? `<img src="${esc(c.photos[0])}" alt="${esc(c.nickname)}">` : `<div class="empty-car">${icon('car', 42)}<span>Add a car photo</span></div>`}${action('car-edit', 'Edit car', 'floating', c.id)}</div><div class="car-body"><div class="eyebrow">${c.year} ${esc(c.make)} ${esc(c.model)} · ${esc(c.trim)}</div><h2>${esc(c.nickname)}</h2><p>${esc(c.notes || 'Add build notes and a parts checklist.')}</p><div class="build-progress"><span>${c.checklist.filter((p) => ['bought', 'installed'].includes(p.status)).length} / ${c.checklist.length} parts acquired</span><strong>${money(c.checklist.reduce((n, p) => n + (p.paid || 0), 0))} spent</strong></div><div class="checklist">${c.checklist.map((p) => `<button class="checklist-row" data-action="part-edit" data-id="${p.id}" data-car="${c.id}"><span class="checklist-state ${p.status}">${['installed', 'bought'].includes(p.status) ? '✓' : p.status === 'ordered' ? '↗' : '○'}</span><span>${esc(p.part)}<small>${esc(p.status)}${p.seller ? ` · ${esc(p.seller)}` : ''}</small></span><strong>${p.paid !== null ? money(p.paid) : p.budget !== null ? `${money(p.budget)} budget` : '—'}</strong></button>`).join('') || '<p class="muted">No parts on this checklist yet.</p>'}</div><div class="monitor-actions">${action('part-add', `${icon('plus', 14)} Add wanted part`, '', c.id)}${action('car-monitor', 'Create monitor', 'primary', c.id)}</div></div></section>`).join('')}</div>`)
  );
}
function settingsMarkup() {
  const s = state.settings,
    c = state.connections;
  return (
    heading(
      'Preferences & connections',
      'Settings',
      'Make Part Scout yours, then connect inventory and alerts.',
    ) +
    `<div class="settings-layout"><section class="panel"><div class="panel-head"><h2>Appearance & monitoring</h2></div><form id="settings-form" class="settings-form"><div class="form-grid"><label class="field">Color mode<select name="theme">${['dark', 'light', 'system'].map((v) => `<option ${s.theme === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="field">Accent color<select name="accent">${['mint', 'violet', 'blue', 'amber', 'rose'].map((v) => `<option ${s.accent === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="check"><input name="animations" type="checkbox" ${s.animations ? 'checked' : ''}> Interface animations</label><label class="check"><input name="paused" type="checkbox" ${s.paused ? 'checked' : ''}> Pause all scheduled scans</label><label class="field">Auto-refresh (seconds)<input name="refreshSeconds" type="number" min="5" max="120" value="${s.refreshSeconds}" required></label><label class="field">Retention (days)<input name="retentionDays" type="number" min="7" max="3650" value="${s.retentionDays}" required></label><label class="field">Request spacing (seconds)<input name="requestGapSeconds" type="number" min="2" max="120" value="${s.requestGapSeconds}" required></label><label class="field">Discord alerts<select name="notificationMode">${[
      ['instant', 'Individual alerts'],
      ['digest', 'Batched digest'],
      ['off', 'Off'],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}" ${s.notificationMode === v ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label><label class="field">Digest window (minutes)<input name="digestMinutes" type="number" min="5" max="1440" value="${s.digestMinutes}" required></label><label class="check full"><input name="backgroundMonitoring" type="checkbox" ${s.backgroundMonitoring ? 'checked' : ''}> Keep desktop monitoring in the system tray when closed</label><div class="form-section full">Phone alerts</div><label class="check full"><input name="phonePush" type="checkbox" ${s.phonePush ? 'checked' : ''}> Mention me in Discord alerts</label><label class="field full">Your Discord user ID<input name="discordUserId" value="${esc(s.discordUserId)}" placeholder="Enable Discord Developer Mode → Copy User ID"><small>Mentions can trigger phone notifications. Enable Mobile Push Notifications in Discord and allow notifications on your phone. Part Scout cannot change those device settings.</small></label></div><div class="form-footer"><button class="primary">Save settings</button></div></form></section><section class="panel"><div class="panel-head"><h2>Connect your Discord server</h2><span class="pill ${c.discord ? '' : 'gray'}">${c.discordVerified ? 'Verified' : c.discord ? 'Configured' : 'Not connected'}</span></div><form id="connections-form" class="settings-form"><p class="muted">In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Paste it once below.</p><label class="field">Channel webhook URL<input name="webhookUrl" type="password" autocomplete="off" placeholder="${c.discord ? 'Connected · leave blank to keep current URL' : 'https://discord.com/api/webhooks/…'}"></label><label class="field">Bot application ID (optional)<input name="applicationId" value="${esc(c.applicationId)}" placeholder="For /scout command access"></label><details><summary>Discord command bot (optional)</summary><div class="form-grid bot-fields">${field('botToken', 'Bot token', '', 'password', 'autocomplete="off"')}${field('guildId', 'Server / guild ID', c.guildId)}${field('userIds', 'Allowed user IDs (comma separated)', c.userIds)}<label class="check"><input name="botEnabled" type="checkbox" ${c.botEnabled ? 'checked' : ''}> Connect bot when Part Scout starts</label></div><div class="monitor-actions">${action('bot-start', 'Connect & register commands')}${action('bot-stop', 'Stop bot')}<span class="pill ${c.botStatus?.connected ? '' : 'gray'}">${c.botStatus?.connected ? 'Bot online' : 'Bot offline'}</span></div></details>${c.inviteUrl ? `<a class="button" href="${esc(c.inviteUrl)}" target="_blank" rel="noreferrer">Invite bot to your server ↗</a>` : ''}<div class="monitor-actions">${action('discord-test', 'Send test message')}${action('discord-disconnect', 'Disconnect', 'danger')}</div><div class="form-section">Inventory sources</div><label class="field">eBay production client ID<input name="ebayClientId" type="password" autocomplete="off" placeholder="${c.ebay ? 'Configured · leave blank to retain' : 'App ID from eBay Developers'}"></label><label class="field">eBay client secret<input name="ebayClientSecret" type="password" autocomplete="off" placeholder="Client secret"></label><label class="field">eBay access token (optional)<input name="ebayAccessToken" type="password" autocomplete="off" placeholder="Use a token instead of client credentials"></label><div class="monitor-actions">${action('ebay-test', 'Test eBay access')}${action('ebay-disconnect', 'Disconnect eBay', 'danger')}</div><label class="field">Allowed feed hosts<input name="feedHosts" value="${esc(c.feedHosts)}" placeholder="inventory.example.com"></label><label class="check"><input name="carPartEnabled" type="checkbox" ${c.carPartEnabled ? 'checked' : ''}> I have Car-Part permission for automated access</label><p class="muted">Saved HTML imports work without automated access. Credentials are encrypted locally and never included in exports.</p><div class="form-footer"><button class="primary">Save connections</button></div></form></section><section class="panel"><div class="panel-head"><h2>Data & workspace</h2></div><div class="settings-form"><p class="muted">Export searches and settings to move your configuration. Inventory exports are available per monitor with a date range.</p><div class="monitor-actions">${action('export-config', 'Export configuration')}${action('import-config', 'Import configuration')}${action('export-csv', 'Inventory CSV')}${window.scoutDesktop ? action('data-folder', 'Open data folder') : ''}</div></div></section><section class="panel"><div class="panel-head"><h2>Part Scout ${esc(state.version)}</h2></div><div class="settings-form"><p class="muted">Original concept by <a href="https://github.com/dzt/car-part-monitor" target="_blank" rel="noreferrer">Peter Soboyejo (dzt) ↗</a>.</p>${action('disconnect', 'Disconnect browser session')}</div></section></div>`
  );
}
async function activityMarkup() {
  const rows = await api(activityTab === 'scans' ? '/runs' : '/deliveries');
  return (
    heading(
      'Live operational history',
      'Activity',
      'Scan outcomes and Discord deliveries update automatically.',
      `<span class="live-tag"><span></span> ${state.running === null ? 'LISTENING' : 'SCANNING'}</span>`,
    ) +
    `<div class="activity-tabs">${action('scans', 'Scan history', activityTab === 'scans' ? 'selected' : '')}${action('deliveries', `Discord deliveries (${state.deliveries})`, activityTab === 'deliveries' ? 'selected' : '')}</div>` +
    (!rows.length
      ? empty(
          'Waiting for your first scan',
          'Run a monitor or import inventory to populate your activity log.',
          `<a class="button" href="#monitors">Open monitors →</a>`,
        )
      : `<div class="panel table-wrap"><table class="table"><thead><tr>${(activityTab === 'scans' ? ['Monitor', 'Status', 'Results', 'Duration', 'Time'] : ['Delivery', 'Status', 'Attempts', 'Next attempt', 'Action']).map((s) => `<th>${s}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => (activityTab === 'scans' ? `<tr class="activity-row"><td>${esc(r.name)}<small>${esc(r.error || `Scan #${r.id}`)}</small></td><td><span class="pill ${r.status === 'failed' ? 'error' : ''}">${r.status}</span></td><td>${r.seen} seen<small>${r.added} new · ${r.drops} drops</small></td><td>${(r.duration / 1000).toFixed(1)}s</td><td>${ago(r.started)}<small>${date(r.started)}</small></td></tr>` : `<tr class="activity-row"><td>#${r.id}<small>${esc(r.error || date(r.created))}</small></td><td><span class="pill ${r.status === 'failed' ? 'error' : r.status === 'sent' ? '' : 'gray'}">${r.status}</span></td><td>${r.attempts}</td><td>${r.status === 'pending' ? date(r.due) : '—'}</td><td>${r.status === 'failed' ? action('retry', 'Retry', '', r.id) : '—'}</td></tr>`)).join('')}</tbody></table></div>`)
  );
}
async function render() {
  const run = ++version,
    current = route();
  const next = await api('/status');
  if (run !== version) return;
  state = next;
  applyTheme();
  $('#garage-name').textContent = state.garage.name;
  $('#garage-owner').textContent = state.garage.owner || 'Personal workspace';
  $$('.workspace-avatar,.top-avatar').forEach(
    (el) => (el.textContent = (state.garage.owner || state.garage.name).slice(0, 1).toUpperCase()),
  );
  $('#nav-count').textContent = state.total;
  $('#demo-label').hidden = !state.demo;
  $('#discord-dot').classList.toggle('connected', state.connections.discord);
  $('#system-status').firstChild.textContent =
    state.running !== null
      ? 'Scanning inventory'
      : state.settings.paused
        ? 'Scheduler paused'
        : 'Workspace ready';
  $('#system-sub').textContent = state.failedDeliveries
    ? `${state.failedDeliveries} alerts need attention`
    : `${state.monitors.length} monitors · ${state.cars.length} cars`;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === current));
  $('#crumb').textContent = labels[current];
  let html;
  if (current === 'overview') {
    const [inventory, analytics] = await Promise.all([
      api('/listings'),
      api(`/analytics?days=${boundaries().join(',')}`),
    ]);
    html = overview(inventory, analytics);
  }
  if (current === 'garage') html = garageMarkup();
  if (current === 'monitors') html = monitorsMarkup();
  if (current === 'settings') html = settingsMarkup();
  if (current === 'activity') html = await activityMarkup();
  if (current === 'inventory' || current === 'saved') {
    const data = await api(
      `/listings?${new URLSearchParams({ q: query, monitor: monitorFilter, sort, page: String(page), saved: String(current === 'saved'), active: String(active) })}`,
    );
    html =
      heading(
        current === 'saved' ? 'Your shortlist' : 'Parts inventory',
        labels[current],
        current === 'saved'
          ? 'Saved listings and notes for your projects.'
          : 'Seller photos, prices, condition, and listing details.',
        `${action('export-csv', 'Export CSV')}${addButton}`,
      ) +
      `<div class="toolbar"><div class="search">${icon('search')}<input id="search" aria-label="Search inventory" placeholder="Search parts, vehicles, sellers…" value="${esc(query)}"></div><select id="monitor-filter" aria-label="Filter by monitor"><option value="">All monitors</option>${state.monitors.map((m) => `<option value="${m.id}" ${String(m.id) === monitorFilter ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><select id="sort" aria-label="Sort inventory">${[
        ['newest', 'Newest first'],
        ['price', 'Price: low to high'],
        ['oldest', 'Oldest first'],
      ]
        .map(([v, s]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${s}</option>`)
        .join(
          '',
        )}</select><label class="check"><input id="active-filter" type="checkbox" ${active ? 'checked' : ''}> Active only</label><div class="view-toggle"><button data-action="grid" class="${view === 'grid' ? 'selected' : ''}" aria-label="Card view">${icon('grid')}</button><button data-action="list" class="${view === 'list' ? 'selected' : ''}" aria-label="Table view">${icon('list')}</button></div></div>${inventoryMarkup(data)}<div class="pagination"><span>${data.total ? Math.min((page - 1) * 30 + 1, data.total) : 0}–${Math.min(page * 30, data.total)} of ${data.total} matches</span><div><button data-action="prev" ${page === 1 ? 'disabled' : ''}>Previous</button><button data-action="next" ${page * 30 >= data.total ? 'disabled' : ''}>Next</button></div></div>`;
  }
  if (run !== version) return;
  const focused = document.activeElement?.id === 'search',
    cursor = focused ? $('#search').selectionStart : null;
  $('#content').innerHTML = html;
  $$('.chart-bar').forEach((el) => (el.style.height = `${el.dataset.height}px`));
  $$('.part-preview img').forEach(
    (img) =>
      (img.onerror = () => {
        img.hidden = true;
        img
          .closest('.part-preview')
          .insertAdjacentHTML('beforeend', '<span class="photo-missing">Photo unavailable</span>');
      }),
  );
  bindForms();
  if (focused && $('#search')) {
    $('#search').focus();
    $('#search').setSelectionRange(cursor, cursor);
  }
  lastRefresh = Date.now();
}
function dialog(title, body) {
  $('#dialog-content').innerHTML =
    `<div class="dialog-header"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close', 20)}</button></div><div class="dialog-body">${body}</div>`;
  if (!$('#dialog').open) $('#dialog').showModal();
}
const field = (name, label, value = '', type = 'text', extra = '') =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value ?? '')}" ${extra}></label>`;
const textArea = (name, label, value = '') =>
  `<label class="field full">${label}<textarea name="${name}" rows="3">${esc(value)}</textarea></label>`;
const footer = (submit = 'Save') =>
  `<div class="form-footer"><button type="button" data-action="close">Cancel</button><button class="primary">${submit}</button></div>`;
const numeric = new Set([
  'yearStart',
  'yearEnd',
  'intervalMinutes',
  'pageLimit',
  'maxPrice',
  'maxMiles',
  'maxDistance',
]);
function monitorEditor(id, preset = {}, carId = null) {
  const existing = id ? state.monitors.find((m) => m.id === Number(id)) : {};
  const car = state.cars.find((c) => c.id === Number(carId));
  const m = {
    name: '',
    model: '',
    part: '',
    zip: state.garage.zip || '',
    yearStart: 2000,
    yearEnd: 2005,
    provider: 'import',
    region: '',
    variant: '',
    feedUrl: '',
    keywords: '',
    intervalMinutes: 60,
    pageLimit: 5,
    maxPrice: null,
    maxMiles: null,
    maxDistance: null,
    include: '',
    exclude: '',
    states: '',
    grades: '',
    referencePhoto: '',
    enabled: true,
    allowUnknownPrice: true,
    allowUnknownMiles: true,
    allowUnknownDistance: true,
    notifyInitial: false,
    notifyNew: true,
    notifyDrops: true,
    destination: 'default',
    carId: null,
    ...preset,
    ...(car
      ? {
          carId: car.id,
          name: `${car.nickname} · ${preset.part || 'Parts'}`,
          model: `${car.make} ${car.model}`,
          yearStart: car.year,
          yearEnd: car.year,
        }
      : {}),
    ...existing,
  };
  const fields = [
    ['name', 'Monitor name'],
    ['model', 'Vehicle model'],
    ['part', 'Part name'],
    ['zip', 'ZIP code'],
    ['yearStart', 'Starting year'],
    ['yearEnd', 'Ending year'],
    ['variant', 'Interchange variant'],
    ['region', 'Provider region'],
    ['keywords', 'eBay search keywords'],
    ['intervalMinutes', 'Scan interval (minutes)'],
    ['pageLimit', 'Provider page limit (1–20)'],
    ['maxPrice', 'Maximum price ($)'],
    ['maxMiles', 'Maximum mileage'],
    ['maxDistance', 'Maximum distance (mi)'],
    ['include', 'Required keywords (comma separated)'],
    ['exclude', 'Excluded keywords (comma separated)'],
    ['states', 'States (MA, CT)'],
    ['grades', 'Grades (A, B)'],
  ];
  dialog(
    id ? 'Edit monitor' : 'Add a monitor',
    `<form id="monitor-form"><div class="form-grid">${fields.map(([name, label]) => field(name, label, m[name], numeric.has(name) ? 'number' : 'text', ['name', 'model', 'part', 'zip', 'yearStart', 'yearEnd', 'intervalMinutes', 'pageLimit'].includes(name) ? `required ${name === 'zip' ? 'pattern="[0-9]{5}" maxlength="5"' : numeric.has(name) ? `min="${name === 'intervalMinutes' ? 15 : name === 'pageLimit' ? 1 : name.startsWith('year') ? 1900 : 0}" step="${name === 'maxPrice' ? '0.01' : '1'}"` : ''}` : '')).join('')}<div class="form-section full">Source & project</div><label class="field">Inventory provider<select name="provider">${[
      ['import', 'File import'],
      ['ebay', 'eBay API'],
      ['feed', 'HTTPS JSON feed'],
      ['carpart', 'Car-Part (authorized)'],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}" ${m.provider === v ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label><label class="field">Garage car<select name="carId"><option value="">No linked car</option>${state.cars.map((c) => `<option value="${c.id}" ${m.carId === c.id ? 'selected' : ''}>${esc(c.nickname)}</option>`).join('')}</select></label>${field('feedUrl', 'Feed URL', m.feedUrl)}${field('referencePhoto', 'Reference part photo URL', m.referencePhoto, 'url')}<div class="form-section full">Discord alerts</div><label class="field full">Discord destination<select name="destination">${[...new Set(['default', ...state.destinations, m.destination])].map((v) => `<option ${m.destination === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>${[
      ['enabled', 'Enable scheduled scans'],
      ['allowUnknownPrice', 'Include unknown prices'],
      ['allowUnknownMiles', 'Include unknown mileage'],
      ['allowUnknownDistance', 'Include unknown distance'],
      ['notifyInitial', 'Alert on the first scan or import'],
      ['notifyNew', 'Alert on new matches'],
      ['notifyDrops', 'Alert on price drops'],
    ]
      .map(
        ([name, label]) =>
          `<label class="check"><input type="checkbox" name="${name}" ${m[name] ? 'checked' : ''}> ${label}</label>`,
      )
      .join('')}</div>${footer(id ? 'Save changes' : 'Create monitor')}</form>`,
  );
  $('#monitor-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      config = {};
    for (const [key, value] of f)
      config[key] = numeric.has(key) ? (value === '' ? null : Number(value)) : value;
    config.carId = f.get('carId') ? Number(f.get('carId')) : null;
    for (const k of [
      'enabled',
      'allowUnknownPrice',
      'allowUnknownMiles',
      'allowUnknownDistance',
      'notifyInitial',
      'notifyNew',
      'notifyDrops',
    ])
      config[k] = f.has(k);
    try {
      await api(id ? `/monitors/${id}` : '/monitors', id ? 'PUT' : 'POST', config);
      $('#dialog').close();
      toast(id ? 'Monitor updated' : 'Monitor created');
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
async function templates(carId = null) {
  if (!catalog.length) catalog = await api('/catalog');
  dialog(
    'Part monitor presets',
    `<p>Select a common part, then customize the vehicle and source. Presets become real monitors only when you save them.</p><div class="preset-grid">${catalog.map((p) => `<button data-action="preset" data-part="${esc(p.name)}" ${carId ? `data-car="${carId}"` : ''}><span>${esc(p.name)}</span><small>${esc(p.category)}</small></button>`).join('')}</div>`,
  );
}
function garageEditor() {
  dialog(
    'Edit your garage',
    `<form id="garage-form"><div class="form-grid">${field('name', 'Garage name', state.garage.name, 'text', 'required')}${field('owner', 'Your name', state.garage.owner)}${field('zip', 'Default ZIP code', state.garage.zip, 'text', 'pattern="[0-9]{5}" maxlength="5"')}</div>${footer('Save garage')}</form>`,
  );
  $('#garage-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/garage', 'PUT', Object.fromEntries(new FormData(e.target)));
      $('#dialog').close();
      toast('Garage updated');
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
const fileData = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
async function uploadFiles(files) {
  const result = [];
  for (const file of files) {
    if (file.size > 4_000_000) throw new Error('Choose photos smaller than 4 MB.');
    result.push((await api('/upload', 'POST', { data: await fileData(file) })).url);
  }
  return result;
}
function carEditor(id) {
  const c = id
    ? state.cars.find((c) => c.id === Number(id))
    : {
        nickname: '',
        year: new Date().getFullYear(),
        make: '',
        model: '',
        trim: '',
        vin: '',
        notes: '',
        photos: [],
      };
  dialog(
    id ? 'Edit car' : 'Add your car',
    `<form id="car-form"><div class="form-grid">${field('nickname', 'Car nickname', c.nickname, 'text', 'required')}${field('year', 'Year', c.year, 'number', 'min="1900" max="2100" required')}${field('make', 'Make', c.make, 'text', 'required')}${field('model', 'Model', c.model, 'text', 'required')}${field('trim', 'Trim / engine', c.trim)}${field('vin', 'VIN (optional)', c.vin)}${textArea('notes', 'Build notes', c.notes)}<label class="field full">Car photos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>JPG, PNG, or WebP. Up to 15 photos, 4 MB each.</small></label><div class="photo-strip full">${c.photos.map((photo, i) => `<label><img src="${esc(photo)}" alt="Car photo ${i + 1}"><span><input type="checkbox" name="remove-${i}"> Remove</span></label>`).join('')}</div></div>${footer(id ? 'Save car' : 'Add car')}</form>`,
  );
  $('#car-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const photos = c.photos.filter((_, i) => !f.has(`remove-${i}`));
      photos.push(...(await uploadFiles($('[name=photos]', e.target).files)));
      const data = {
        ...Object.fromEntries(
          ['nickname', 'make', 'model', 'trim', 'vin', 'notes'].map((k) => [k, f.get(k)]),
        ),
        year: Number(f.get('year')),
        photos,
      };
      await api(id ? `/cars/${id}` : '/cars', id ? 'PUT' : 'POST', data);
      $('#dialog').close();
      toast('Car saved');
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
function checklistEditor(carId, id, preset = {}) {
  const car = state.cars.find((c) => c.id === Number(carId));
  const p = id
    ? car.checklist.find((p) => p.id === Number(id))
    : {
        part: '',
        status: 'wanted',
        budget: null,
        paid: null,
        seller: '',
        listingUrl: '',
        purchasedAt: '',
        notes: '',
        ...preset,
      };
  dialog(
    id ? 'Edit checklist part' : 'Add wanted part',
    `<form id="part-form"><div class="form-grid">${field('part', 'Part', p.part, 'text', 'required')}<label class="field">Status<select name="status" aria-label="Status">${['wanted', 'ordered', 'bought', 'installed'].map((v) => `<option ${p.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${field('budget', 'Budget ($)', p.budget, 'number', 'min="0" step="0.01"')}${field('paid', 'Amount paid ($)', p.paid, 'number', 'min="0" step="0.01"')}${field('seller', 'Seller', p.seller)}${field('purchasedAt', 'Purchase date', p.purchasedAt, 'date')}${field('listingUrl', 'Listing URL', p.listingUrl, 'url')}${textArea('notes', 'Notes', p.notes)}</div>${footer('Save part')}</form>`,
  );
  $('#part-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      data = Object.fromEntries(f);
    data.budget = f.get('budget') === '' ? null : Number(f.get('budget'));
    data.paid = f.get('paid') === '' ? null : Number(f.get('paid'));
    try {
      await api(`/cars/${carId}/parts${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', data);
      $('#dialog').close();
      toast('Checklist updated');
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
function galleryMarkup(l) {
  const images = photos(l);
  if (!images.length)
    return `<div class="gallery-empty">No seller photos provided.${reference(l) ? `<img src="${esc(reference(l))}" alt="Reference part photo"><small>Reference photo · not the item for sale</small>` : ''}</div>`;
  photoIndex = Math.max(0, Math.min(photoIndex, images.length - 1));
  return `<div class="gallery"><img id="gallery-photo" src="${esc(images[photoIndex])}" alt="Seller photo ${photoIndex + 1} of ${images.length}" referrerpolicy="no-referrer">${images.length > 1 ? `<button class="gallery-prev" data-action="photo-prev" aria-label="Previous listing photo">‹</button><button class="gallery-next" data-action="photo-next" aria-label="Next listing photo">›</button>` : ''}<span class="gallery-count">${photoIndex + 1} / ${images.length}</span></div><div class="gallery-thumbs">${images.map((url, i) => `<button class="${i === photoIndex ? 'selected' : ''}" data-action="photo" data-index="${i}" aria-label="Listing photo ${i + 1}"><img src="${esc(url)}" alt=""></button>`).join('')}</div>`;
}
function showDetail(l) {
  detailListing = l;
  const prices = l.history.filter((p) => p.price !== null),
    max = Math.max(1, ...prices.map((p) => p.price)),
    min = Math.min(...prices.map((p) => p.price)),
    range = max - min || 1;
  dialog(
    `${l.year} ${esc(l.model)}`,
    `<div class="eyebrow">${esc(l.source)} · ${esc(l.part)} · STOCK ${esc(l.stock)}</div><div id="gallery-region">${galleryMarkup(l)}</div><div class="detail-price">${money(l.price, l.currency)}</div><p>${esc(l.description)}</p><div class="detail-actions">${l.url ? action('seller', l.buyingOptions.includes('AUCTION') ? 'View / bid with seller' : l.buyingOptions.includes('FIXED_PRICE') ? 'Buy from seller' : l.urlKind === 'seller' ? 'Visit seller' : 'Open listing', 'primary', l.id) : ''}${l.source === 'eBay' ? action('enrich', 'Load full seller gallery', '', l.id) : ''}${state.cars.length ? action('record-purchase', 'Add to car checklist', '', l.id) : ''}</div><p class="muted">Seller checkout opens inside the desktop app. Review fitment, shipping, and price before completing a purchase or bid.</p><div class="detail-spec">${[
      ['Seller', l.dealer],
      ['Location', [l.city, l.state].filter(Boolean).join(', ') || 'Not provided'],
      ['Mileage', l.miles === null ? 'Unknown' : `${l.miles.toLocaleString()} mi`],
      ['Condition', l.condition || l.grade || 'Not provided'],
      ['Phone', l.phone || 'Not provided'],
      ['Shipping', l.shipping === null ? 'See seller' : money(l.shipping, l.currency)],
      ['Email', l.email || 'Not provided'],
      ['Address', l.address || 'Not provided'],
    ]
      .map(([k, v]) => `<div><small>${k}</small>${esc(v)}</div>`)
      .join('')}</div>${
      Object.keys(l.attributes).length
        ? `<details><summary>All source information</summary><dl class="attributes">${Object.entries(
            l.attributes,
          )
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join('')}</dl></details>`
        : ''
    }<details><summary>Original provider data</summary><pre class="provider-json">${esc(JSON.stringify(l.raw, null, 2))}</pre></details><div class="form-section">Price history</div>${
      prices.length
        ? `<svg class="price-chart" viewBox="0 0 560 140" role="img" aria-label="Recorded price history"><path d="M30 110h500M30 65h500M30 20h500" stroke="currentColor" opacity=".1"/><polyline points="${prices.map((p, i) => `${30 + (i / Math.max(1, prices.length - 1)) * 500},${105 - ((p.price - min) / range) * 75}`).join(' ')}" stroke="currentColor" stroke-width="2.5" fill="none"/></svg><div class="price-list">${prices
            .slice(-10)
            .map(
              (p) =>
                `<span>${new Date(p.at).toLocaleDateString()} · ${money(p.price, l.currency)}</span>`,
            )
            .join('')}</div>`
        : '<p>No quoted price recorded.</p>'
    }<form id="note-form">${textArea('note', 'Your notes', l.note)}<label class="check"><input name="saved" type="checkbox" ${l.saved ? 'checked' : ''}> Save this part</label><div class="form-footer"><button class="primary">Save notes</button></div></form>`,
  );
  $('#note-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api(`/listings/${l.id}`, 'PATCH', { saved: f.has('saved'), note: f.get('note') });
      $('#dialog').close();
      toast('Notes saved');
      await render();
    } catch (e) {
      toast(e.message);
    }
  };
}
async function detail(id) {
  photoIndex = 0;
  showDetail(await api(`/listings/${id}`));
}
function exportMonitor(id) {
  const now = new Date(Date.now() + 60000),
    start = new Date(Date.now() - 7 * 86400000);
  const local = (d) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  dialog(
    'Export monitor to Excel',
    `<form id="monitor-export-form"><p>Export listings first found by this monitor within the selected period, with listing links, photos, and recorded prices.</p><div class="form-grid">${field('from', 'From', local(start), 'datetime-local', 'required')}${field('to', 'Until (exclusive)', local(now), 'datetime-local', 'required')}</div>${footer('Download Excel')}</form>`,
  );
  $('#monitor-export-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await download(
        `/monitors/${id}/export?${new URLSearchParams({ from: new Date(f.get('from')).toISOString(), to: new Date(f.get('to')).toISOString() })}`,
        `part-scout-monitor-${id}.xlsx`,
      );
      $('#dialog').close();
    } catch (e) {
      toast(e.message);
    }
  };
}
function importInventory(id) {
  dialog(
    'Import inventory',
    `<form id="inventory-import-form"><p>Choose JSON inventory or a saved Car-Part HTML results page. Partial imports preserve unseen inventory.</p><label class="field">Inventory file<input name="file" type="file" accept=".json,.html,.htm" required></label><label class="check"><input name="complete" type="checkbox"> This JSON file contains a complete snapshot</label>${footer('Import inventory')}</form>`,
  );
  $('#inventory-import-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      file = f.get('file');
    try {
      if (file.size > 5_000_000) throw new Error('Choose a file smaller than 5 MB.');
      const text = await file.text(),
        parsed = /\.html?$/i.test(file.name) ? null : JSON.parse(text),
        data = parsed
          ? {
              listings: Array.isArray(parsed) ? parsed : parsed.listings,
              complete: f.has('complete'),
            }
          : { html: text };
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
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Export failed');
  }
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export downloaded');
}
function connectionInput() {
  const form = $('#connections-form');
  if (!form) return {};
  const f = new FormData(form);
  return {
    ...Object.fromEntries([...f].filter(([k]) => !['carPartEnabled', 'botEnabled'].includes(k))),
    carPartEnabled: f.has('carPartEnabled'),
    botEnabled: f.has('botEnabled'),
  };
}
async function saveConnections(extra = {}) {
  await api('/connections', 'PUT', { ...connectionInput(), ...extra });
}
function bindForms() {
  let debounce;
  if ($('#search'))
    $('#search').oninput = (e) => {
      query = e.target.value;
      page = 1;
      clearTimeout(debounce);
      debounce = setTimeout(() => render().catch((e) => toast(e.message)), 250);
    };
  for (const [selector, set] of [
    ['#monitor-filter', (v) => (monitorFilter = v)],
    ['#sort', (v) => (sort = v)],
  ])
    if ($(selector))
      $(selector).onchange = (e) => {
        set(e.target.value);
        page = 1;
        render().catch((e) => toast(e.message));
      };
  if ($('#active-filter'))
    $('#active-filter').onchange = (e) => {
      active = e.target.checked;
      page = 1;
      render().catch((e) => toast(e.message));
    };
  if ($('#settings-form'))
    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        s = { ...state.settings };
      for (const k of ['theme', 'accent', 'notificationMode', 'discordUserId']) s[k] = f.get(k);
      for (const k of ['refreshSeconds', 'retentionDays', 'requestGapSeconds', 'digestMinutes'])
        s[k] = Number(f.get(k));
      for (const k of ['paused', 'phonePush', 'animations', 'backgroundMonitoring'])
        s[k] = f.has(k);
      if (s.phonePush && !s.discordUserId)
        return toast('Enter your Discord user ID to enable mention alerts.');
      try {
        await api('/settings', 'PUT', s);
        toast('Settings saved');
        await render();
      } catch (e) {
        toast(e.message);
      }
    };
  if ($('#connections-form'))
    $('#connections-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await saveConnections();
        toast('Connections saved');
        await render();
      } catch (e) {
        toast(e.message);
      }
    };
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  try {
    if (a === 'close') return $('#dialog').close();
    if (a === 'add' || a === 'edit') return monitorEditor(id);
    if (a === 'templates') return await templates();
    if (a === 'preset')
      return monitorEditor(
        null,
        {
          part: b.dataset.part,
          name: `${b.dataset.part} search`,
          provider: state.connections.ebay ? 'ebay' : 'import',
        },
        b.dataset.car,
      );
    if (a === 'garage-edit') return garageEditor();
    if (a === 'car-add' || a === 'car-edit') return carEditor(id);
    if (a === 'car-monitor') return await templates(id);
    if (a === 'part-add') return checklistEditor(id);
    if (a === 'part-edit') return checklistEditor(b.dataset.car, id);
    if (a === 'detail') return await detail(id);
    if (a === 'import') return importInventory(id);
    if (a === 'monitor-export') return exportMonitor(id);
    if (a === 'photo-next' || a === 'photo-prev' || a === 'photo') {
      const count = photos(detailListing).length;
      photoIndex =
        a === 'photo'
          ? Number(b.dataset.index)
          : (photoIndex + (a === 'photo-next' ? 1 : -1) + count) % count;
      $('#gallery-region').innerHTML = galleryMarkup(detailListing);
      return;
    }
    if (a === 'seller') {
      const l = await api(`/listings/${id}`);
      if (!l.url) throw new Error('No seller link was provided for this listing.');
      if (window.scoutDesktop) return await window.scoutDesktop.openSeller(l.url);
      dialog(
        'Open seller listing',
        `<p>Seller checkout is embedded in the Windows app. In the browser version, use the seller link below.</p><a class="button primary" href="${esc(l.url)}" target="_blank" rel="noreferrer">Open ${esc(l.source)} listing ↗</a>`,
      );
      return;
    }
    if (a === 'enrich') {
      b.disabled = true;
      b.textContent = 'Loading seller photos…';
      const l = await api(`/listings/${id}/enrich`, 'POST');
      photoIndex = 0;
      showDetail(l);
      return;
    }
    if (a === 'record-purchase') {
      dialog(
        'Choose a garage car',
        `<div class="preset-grid">${state.cars.map((c) => `<button data-action="purchase-car" data-car="${c.id}">${esc(c.nickname)}</button>`).join('')}</div>`,
      );
      return;
    }
    if (a === 'purchase-car')
      return checklistEditor(b.dataset.car, null, {
        part: detailListing.part,
        status: 'wanted',
        seller: detailListing.dealer,
        listingUrl: detailListing.url || '',
        budget: detailListing.price,
      });
    if (a === 'save') {
      const l = await api(`/listings/${id}`);
      await api(`/listings/${id}`, 'PATCH', { saved: !l.saved, note: l.note });
      toast(l.saved ? 'Part unsaved' : 'Part saved');
    }
    if (a === 'scan') {
      b.disabled = true;
      await api(`/monitors/${id}/scan?async=true`, 'POST');
      toast('Scan started. Results update in Activity.');
    }
    if (a === 'toggle') {
      const m = state.monitors.find((m) => m.id === Number(id));
      await api(`/monitors/${id}`, 'PUT', { ...m, enabled: !m.enabled });
    }
    if (a === 'delete') {
      dialog(
        'Delete monitor?',
        `<p>This removes the search and its inventory associations. Saved records remain available.</p><div class="form-footer">${action('close', 'Cancel')}${action('confirm-delete', 'Delete monitor', 'danger', id)}</div>`,
      );
      return;
    }
    if (a === 'confirm-delete') {
      await api(`/monitors/${id}`, 'DELETE');
      $('#dialog').close();
      toast('Monitor deleted');
    }
    if (a === 'retry') {
      await api(`/deliveries/${id}/retry`, 'POST');
      toast('Alert requeued');
    }
    if (a === 'grid' || a === 'list') view = a;
    if (a === 'scans' || a === 'deliveries') activityTab = a;
    if (a === 'prev') page = Math.max(1, page - 1);
    if (a === 'next') page++;
    if (a === 'clear') {
      query = '';
      monitorFilter = '';
      page = 1;
    }
    if (a === 'export-csv') return await download('/export/listings', 'part-scout-inventory.csv');
    if (a === 'export-config') return await download('/export/config', 'part-scout-config.json');
    if (a === 'import-config') {
      dialog(
        'Import configuration',
        `<form id="config-import-form"><p>Imported searches are added to this workspace.</p><label class="field">Configuration JSON<input name="file" type="file" accept=".json" required></label>${footer('Import configuration')}</form>`,
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
    if (a === 'discord-test' || a === 'ebay-test') {
      b.disabled = true;
      await saveConnections();
      await api(
        `/connections/${a === 'discord-test' ? 'discord' : 'ebay'}/test`,
        'POST',
        a === 'discord-test' ? { send: true } : {},
      );
      toast(a === 'discord-test' ? 'Test message delivered to Discord' : 'eBay API connected');
    }
    if (a === 'bot-start') {
      b.disabled = true;
      await saveConnections();
      await api('/connections/bot/start', 'POST');
      toast('Discord bot connected and commands registered');
    }
    if (a === 'bot-stop') {
      await api('/connections/bot/stop', 'POST');
      toast('Discord bot stopped');
    }
    if (a === 'discord-disconnect' || a === 'ebay-disconnect') {
      await saveConnections(
        a === 'discord-disconnect' ? { disconnectDiscord: true } : { disconnectEbay: true },
      );
      toast('Connection removed');
    }
    if (a === 'data-folder') return await window.scoutDesktop.dataFolder();
    if (a === 'disconnect') {
      token = '';
      return auth();
    }
    await render();
  } catch (e) {
    toast(e.message);
    b.disabled = false;
    if (a === 'enrich') b.textContent = 'Load full seller gallery';
  }
});
$('#refresh').onclick = () => render().catch((e) => toast(e.message));
$('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
window.addEventListener('hashchange', () => {
  page = 1;
  query = '';
  monitorFilter = '';
  active = route() !== 'saved';
  $('.sidebar').classList.remove('open');
  render().catch((e) => toast(e.message));
});
function canRefresh() {
  return (
    state &&
    !$('#dialog').open &&
    !['settings', 'garage'].includes(route()) &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
  );
}
setInterval(() => {
  if (canRefresh() && Date.now() - lastRefresh >= state.settings.refreshSeconds * 1000)
    render().catch(() => {});
}, 1000);
async function connectEvents() {
  streamAbort?.abort();
  streamAbort = new AbortController();
  try {
    const response = await fetch('/api/events', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: streamAbort.signal,
    });
    if (!response.ok) return;
    const reader = response.body.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message.startsWith('data:') && canRefresh() && Date.now() - lastRefresh > 750)
          render().catch(() => {});
      }
    }
  } catch {}
  if (state) setTimeout(connectEvents, 5000);
}
$$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
render()
  .then(connectEvents)
  .catch((e) => {
    if (!$('#auth-form'))
      $('#content').innerHTML = empty('Unable to connect', e.message, action('clear', 'Try again'));
  });

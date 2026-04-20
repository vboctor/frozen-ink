import catalogData from "./catalog.json";

interface CatalogEntry {
  title: string;
  url: string;
  description: string;
  crawler: string;
  entityCount?: number;
  sizeInMB?: number;
}

const CRAWLER_COLORS: Record<string, string> = {
  github: "#1a1a2e",
  obsidian: "#7c3aed",
  git: "#e36209",
  mantishub: "#cf222e",
  rss: "#ee802f",
};

const CONTRIBUTE_URL =
  "https://github.com/vboctor/frozen-ink/blob/main/packages/website/src/catalog.json";
const REPO_URL = "https://github.com/vboctor/frozen-ink";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const collections: CatalogEntry[] = [
  ...(catalogData.collections as CatalogEntry[]),
].sort((a, b) =>
  a.title.localeCompare(b.title, "en", { sensitivity: "base" })
);

function formatEntityCount(n: number): string {
  return n.toLocaleString("en-US");
}

function renderStats(c: CatalogEntry): string {
  if (c.entityCount === undefined && c.sizeInMB === undefined) return "";
  const parts: string[] = [];
  if (c.entityCount !== undefined) parts.push(`${formatEntityCount(c.entityCount)} entities`);
  if (c.sizeInMB !== undefined) parts.push(`${c.sizeInMB} MB`);
  return `<div class="catalog-tile-stats">${parts.join(" &bull; ")}</div>`;
}

function renderTile(c: CatalogEntry): string {
  const color = CRAWLER_COLORS[c.crawler] ?? "#555b6e";
  return `<a class="catalog-tile" href="${escapeHtml(c.url)}" target="_blank" rel="noopener" data-title="${escapeHtml(c.title.toLowerCase())}" data-description="${escapeHtml(c.description.toLowerCase())}">
    <div class="catalog-tile-header">
      <span class="catalog-tag" style="background:${color}1a;color:${color};border-color:${color}33;">${escapeHtml(c.crawler)}</span>
    </div>
    <h3 class="catalog-tile-title">
      <span>${escapeHtml(c.title)}</span>
      <svg class="catalog-tile-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </h3>
    <p class="catalog-tile-desc">${escapeHtml(c.description)}</p>
    ${renderStats(c)}
  </a>`;
}

const tilesHtml = collections.map(renderTile).join("\n");

const SITE_URL = "https://frozenink.com";
const PAGE_TITLE = "Catalog — Frozen Ink";
const PAGE_DESC =
  "Browse public Frozen Ink collections. Search and filter by title or description, tagged by crawler type.";

export const catalogPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${PAGE_TITLE}</title>
  <meta name="description" content="${PAGE_DESC}" />
  <link rel="canonical" href="${SITE_URL}/catalog" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Frozen Ink" />
  <meta property="og:title" content="${PAGE_TITLE}" />
  <meta property="og:description" content="${PAGE_DESC}" />
  <meta property="og:url" content="${SITE_URL}/catalog" />
  <meta property="og:image" content="${SITE_URL}/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${PAGE_TITLE}" />
  <meta name="twitter:description" content="${PAGE_DESC}" />
  <meta name="twitter:image" content="${SITE_URL}/og.png" />
  <meta name="theme-color" content="#0969da" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg viewBox='0 0 28 28' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='3' y='16' width='22' height='5' rx='1.5' fill='%23e36209'/%3E%3Crect x='4' y='10' width='20' height='5' rx='1.5' fill='%231a9e8f'/%3E%3Crect x='3' y='4' width='22' height='5' rx='1.5' fill='%23cf222e'/%3E%3C/svg%3E" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #fafbfc;
      --bg-card: #ffffff;
      --text: #1a1a2e;
      --text-secondary: #555b6e;
      --text-muted: #8b8fa3;
      --accent: #0969da;
      --accent-light: #ddf4ff;
      --accent-dark: #0550ae;
      --border: #e1e4e8;
      --radius: 12px;
      --radius-lg: 20px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      --max-width: 1120px;
      --gradient-hero: linear-gradient(135deg, #0969da 0%, #7c3aed 50%, #cf222e 100%);
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font);
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--accent-dark); }

    nav {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 100;
      background: rgba(250, 251, 252, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      height: 60px;
    }
    .nav-inner {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 24px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .nav-brand {
      display: flex; align-items: center; gap: 10px;
      font-weight: 700; font-size: 18px; color: var(--text);
      white-space: nowrap; flex-shrink: 0;
    }
    .nav-brand svg { width: 28px; height: 28px; }
    .nav-links {
      display: flex; align-items: center; gap: 28px; list-style: none;
    }
    .nav-links a {
      color: var(--text-secondary); font-size: 14px; font-weight: 500;
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--text); }
    .nav-links a.active { color: var(--accent); font-weight: 600; }
    .nav-cta {
      background: var(--text); color: #fff !important;
      padding: 8px 18px; border-radius: 8px;
      font-size: 13px; font-weight: 600;
      transition: opacity 0.15s;
    }
    .nav-cta:hover { opacity: 0.85; color: #fff !important; }
    .nav-social { display: flex; align-items: center; gap: 12px; margin-left: 4px; }
    .nav-icon-link {
      display: flex; align-items: center;
      color: var(--text-muted) !important;
      transition: color 0.15s;
    }
    .nav-icon-link:hover { color: var(--text) !important; }
    .nav-mobile-toggle {
      display: none; align-items: center; justify-content: center;
      width: 36px; height: 36px;
      border: 1px solid var(--border); border-radius: 8px;
      cursor: pointer; background: none; flex-shrink: 0;
    }

    main {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 120px 24px 80px;
    }
    .page-header { margin-bottom: 32px; }
    .page-header h1 {
      font-size: clamp(32px, 5vw, 44px);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }
    .page-header .gradient-text {
      background: var(--gradient-hero);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .page-header p {
      font-size: 17px;
      color: var(--text-secondary);
      max-width: 680px;
      line-height: 1.65;
    }

    .catalog-toolbar {
      display: flex; align-items: center; gap: 12px;
      margin: 0 0 24px; flex-wrap: wrap;
    }
    .catalog-search {
      flex: 1; min-width: 240px;
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .catalog-search:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.12);
    }
    .catalog-search svg { color: var(--text-muted); flex-shrink: 0; }
    .catalog-search input {
      flex: 1; border: none; outline: none;
      font-size: 15px; font-family: inherit;
      color: var(--text); background: transparent;
    }
    .catalog-count {
      font-size: 13px; color: var(--text-muted); white-space: nowrap;
    }
    .catalog-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 18px;
      margin: 0 0 32px;
    }
    .catalog-tile {
      display: flex; flex-direction: column; gap: 10px;
      padding: 22px 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #fff;
      color: inherit;
      text-decoration: none;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .catalog-tile:hover {
      border-color: var(--accent);
      box-shadow: 0 4px 20px rgba(9, 105, 218, 0.07);
      transform: translateY(-1px);
    }
    .catalog-tile:hover .catalog-tile-title { color: var(--accent); }
    .catalog-tile:hover .catalog-tile-icon { color: var(--accent); }
    .catalog-tile-header { display: flex; align-items: center; }
    .catalog-tag {
      display: inline-flex; align-items: center;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: lowercase;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid;
    }
    .catalog-tile-title {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 18px; font-weight: 700;
      color: var(--text); margin: 2px 0 0;
      transition: color 0.15s;
    }
    .catalog-tile-icon {
      color: var(--text-muted);
      flex-shrink: 0;
      transition: color 0.15s;
    }
    .catalog-tile-desc {
      font-size: 14px; color: var(--text-secondary);
      line-height: 1.6; margin: 0; flex: 1;
    }
    .catalog-tile-stats {
      font-size: 12px; color: var(--text-muted);
      margin-top: 2px;
    }
    .catalog-empty {
      padding: 40px 20px; text-align: center;
      color: var(--text-muted); font-size: 14px;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }
    .catalog-empty[hidden] { display: none; }

    .catalog-contribute {
      margin-top: 48px;
      padding: 32px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, #f0f7ff 0%, #fff0f3 100%);
    }
    .catalog-contribute h2 {
      font-size: 22px; font-weight: 700;
      margin: 0 0 10px; color: var(--text);
    }
    .catalog-contribute p {
      font-size: 15px; color: var(--text-secondary);
      margin: 0 0 20px; max-width: 640px;
    }
    .catalog-contribute-actions {
      display: flex; gap: 12px; flex-wrap: wrap;
    }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 11px 20px;
      border-radius: 10px;
      font-size: 14px; font-weight: 600;
      text-decoration: none;
      transition: opacity 0.15s, border-color 0.15s;
    }
    .btn-primary { background: var(--text); color: #fff !important; }
    .btn-primary:hover { opacity: 0.85; color: #fff !important; }
    .btn-secondary {
      background: #fff; color: var(--text) !important;
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { border-color: var(--accent); }

    footer {
      border-top: 1px solid var(--border);
      padding: 28px 24px;
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
    }
    footer a { color: var(--text-secondary); }

    @media (max-width: 768px) {
      .nav-mobile-toggle { display: flex; }
      .nav-links { display: none; }
      main { padding: 96px 20px 60px; }
    }
  </style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="/" class="nav-brand">
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="16" width="22" height="5" rx="1.5" fill="#e36209"/>
        <rect x="4" y="10" width="20" height="5" rx="1.5" fill="#1a9e8f"/>
        <rect x="3" y="4" width="22" height="5" rx="1.5" fill="#cf222e"/>
      </svg>
      Frozen Ink
    </a>
    <ul class="nav-links">
      <li><a href="/#why">What &amp; Why</a></li>
      <li><a href="/#how">Getting Started</a></li>
      <li><a href="/#connectors">Connectors</a></li>
      <li><a href="/catalog" class="active">Catalog</a></li>
      <li><a href="/docs/what-is-frozen-ink">Docs</a></li>
      <li><a href="/docs/download" class="nav-cta">Download</a></li>
      <li class="nav-social">
        <a href="${REPO_URL}" target="_blank" rel="noopener" aria-label="GitHub" class="nav-icon-link">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
        </a>
        <a href="https://x.com/vboctor" target="_blank" rel="noopener" aria-label="X (Twitter)" class="nav-icon-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
      </li>
    </ul>
    <button class="nav-mobile-toggle" aria-label="Toggle navigation">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  </div>
</nav>

<main>
  <header class="page-header">
    <h1>Collection <span class="gradient-text">Catalog</span></h1>
    <p>Browse public Frozen Ink collections. Every tile links to a live, searchable, AI-accessible knowledge base — no account required.</p>
  </header>

  <div class="catalog-toolbar">
    <label class="catalog-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="catalog-search-input" type="search" placeholder="Search collections by title or description" autocomplete="off" />
    </label>
    <span class="catalog-count" id="catalog-count">${collections.length} collection${collections.length === 1 ? "" : "s"}</span>
  </div>

  <div class="catalog-grid" id="catalog-grid">
    ${tilesHtml}
  </div>
  <div class="catalog-empty" id="catalog-empty" hidden>No collections match your search.</div>

  <section class="catalog-contribute">
    <h2>Contribute a collection</h2>
    <p>Have a public, passwordless Frozen Ink collection you'd like to share? Add it to the catalog. Password-protected collections can't be listed here.</p>
    <div class="catalog-contribute-actions">
      <a href="${CONTRIBUTE_URL}" target="_blank" rel="noopener" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.02 3.25 9.27 7.76 10.77.57.1.78-.25.78-.55 0-.27-.01-.98-.02-1.92-3.16.69-3.82-1.52-3.82-1.52-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.52-.29-5.18-1.26-5.18-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.44.11-2.99 0 0 .96-.31 3.14 1.16.91-.25 1.88-.38 2.85-.39.97.01 1.94.14 2.85.39 2.18-1.47 3.14-1.16 3.14-1.16.62 1.55.23 2.7.11 2.99.73.79 1.17 1.8 1.17 3.04 0 4.35-2.66 5.31-5.19 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.77-.01 3.15 0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.77C23.34 5.57 18.27.5 12 .5z"/></svg>
        Open a pull request
      </a>
    </div>
  </section>
</main>

<footer>
  <p>Frozen Ink &mdash; local-first knowledge layer for technical work. &nbsp;·&nbsp; <a href="/docs">Documentation</a></p>
</footer>

<script>
(function() {
  var input = document.getElementById('catalog-search-input');
  var grid = document.getElementById('catalog-grid');
  var empty = document.getElementById('catalog-empty');
  var count = document.getElementById('catalog-count');
  if (!input || !grid || !empty || !count) return;
  var tiles = Array.prototype.slice.call(grid.querySelectorAll('.catalog-tile'));
  var total = tiles.length;
  function pluralize(n) { return n + ' collection' + (n === 1 ? '' : 's'); }
  function apply() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    tiles.forEach(function(t) {
      var title = t.getAttribute('data-title') || '';
      var desc = t.getAttribute('data-description') || '';
      var match = q === '' || title.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
      t.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    empty.hidden = shown > 0;
    count.textContent = q === '' ? pluralize(total) : shown + ' of ' + total + ' shown';
  }
  input.addEventListener('input', apply);
})();
</script>
</body>
</html>`;

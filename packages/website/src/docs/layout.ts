export interface TocLink {
  id: string;
  title: string;
  indent?: boolean;
}

export interface DocsPageOptions {
  title: string;
  description: string;
  activePath: string;
  content: string;
  tocLinks?: TocLink[];
}

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [
      { label: "What is Frozen Ink", href: "/docs/what-is-frozen-ink" },
      { label: "Key Scenarios", href: "/docs/key-scenarios" },
    ],
  },
  {
    title: "Setup",
    items: [
      { label: "Getting Started", href: "/docs" },
      { label: "Desktop App", href: "/docs/desktop-app" },
    ],
  },
  {
    title: "Connectors",
    items: [
      { label: "GitHub", href: "/docs/connectors/github" },
      { label: "Obsidian", href: "/docs/connectors/obsidian" },
      { label: "Git", href: "/docs/connectors/git" },
      { label: "MantisBT", href: "/docs/connectors/mantisbt" },
    ],
  },
  {
    title: "Collections",
    items: [
      { label: "Managing Collections", href: "/docs/managing-collections" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Claude Code Integration", href: "/docs/claude-code" },
      { label: "Claude Desktop Integration", href: "/docs/claude-desktop" },
      { label: "Local MCP Setup", href: "/docs/local-mcp" },
      { label: "AnythingLLM MCP Setup", href: "/docs/anythingllm-mcp" },
      { label: "Publishing to Cloudflare", href: "/docs/publishing" },
      { label: "Cloud MCP Access", href: "/docs/cloud-mcp" },
    ],
  },
];

function buildSidebarNav(activePath: string): string {
  return NAV_SECTIONS.map(
    (section) => `
    <div class="sidenav-section">
      <div class="sidenav-section-title">${section.title}</div>
      ${section.items
        .map(
          (item) =>
            `<a href="${item.href}" class="sidenav-link${activePath === item.href ? " active" : ""}">${item.label}</a>`
        )
        .join("")}
    </div>`
  ).join("");
}

function buildToc(links: TocLink[]): string {
  if (!links.length) return "";
  return `
  <div class="page-toc">
    <div class="page-toc-title">On this page</div>
    ${links
      .map(
        (l) =>
          `<a href="#${l.id}" class="page-toc-link${l.indent ? " indent" : ""}">${l.title}</a>`
      )
      .join("")}
  </div>`;
}

export function renderDocsPage(opts: DocsPageOptions): string {
  const { title, description, activePath, content, tocLinks = [] } = opts;
  const sidebarNav = buildSidebarNav(activePath);
  const toc = buildToc(tocLinks);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Frozen Ink Docs</title>
  <meta name="description" content="${description}" />
  <meta name="theme-color" content="#0969da" />
  <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABjSURBVFhH7c0xDQAgDEXRHwcuwP5dMA0TYKAlYeAO9CX/TndnZmZmZmZmZmZm/6Kq1t0fvN3dT7MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzOzv/E6d2dmZmZmZn/WcQC9fg7gL4VGPAAAAABJRU5ErkJggg==" />
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
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      --gradient-hero: linear-gradient(135deg, #0969da 0%, #7c3aed 50%, #cf222e 100%);
      --nav-h: 60px;
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

    /* ===== Top Nav ===== */
    nav {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 200;
      background: rgba(250, 251, 252, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      height: var(--nav-h);
    }

    .nav-inner {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 24px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
      color: var(--text);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .nav-brand svg { width: 28px; height: 28px; }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 28px;
      list-style: none;
    }

    .nav-links a {
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 500;
      transition: color 0.15s;
    }

    .nav-links a:hover { color: var(--text); }
    .nav-links a.active { color: var(--accent); font-weight: 600; }

    .nav-cta {
      background: var(--text);
      color: #fff !important;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      transition: opacity 0.15s;
    }

    .nav-cta:hover { opacity: 0.85; color: #fff !important; }

    /* ===== Mobile nav toggle ===== */
    .nav-mobile-toggle {
      display: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      background: none;
      flex-shrink: 0;
    }

    /* ===== Docs Layout ===== */
    .docs-layout {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 220px;
      max-width: 1400px;
      margin: 0 auto;
      padding-top: var(--nav-h);
      min-height: 100vh;
      align-items: start;
    }

    /* ===== Side nav ===== */
    .docs-sidenav {
      position: sticky;
      top: var(--nav-h);
      height: calc(100vh - var(--nav-h));
      overflow-y: auto;
      border-right: 1px solid var(--border);
      padding: 32px 0 48px;
      background: var(--bg);
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }

    .docs-sidenav::-webkit-scrollbar { width: 4px; }
    .docs-sidenav::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .sidenav-section {
      margin-bottom: 8px;
    }

    .sidenav-section-title {
      padding: 14px 20px 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
    }

    .sidenav-link {
      display: block;
      padding: 8px 20px;
      font-size: 14px;
      color: var(--text-secondary);
      font-weight: 450;
      transition: color 0.15s, background 0.15s;
      border-radius: 0;
      position: relative;
    }

    .sidenav-link:hover {
      color: var(--text);
      background: rgba(9, 105, 218, 0.04);
    }

    .sidenav-link.active {
      color: var(--accent);
      font-weight: 600;
      background: var(--accent-light);
    }

    .sidenav-link.active::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--accent);
      border-radius: 0 2px 2px 0;
    }

    /* ===== Main content ===== */
    .docs-main {
      padding: 52px 56px 80px;
      min-width: 0;
    }

    /* ===== Right in-page TOC ===== */
    .docs-page-toc {
      position: sticky;
      top: var(--nav-h);
      height: calc(100vh - var(--nav-h));
      overflow-y: auto;
      padding: 40px 24px 40px 20px;
      border-left: 1px solid var(--border);
      background: var(--bg);
    }

    .page-toc-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .page-toc-link {
      display: block;
      font-size: 13px;
      color: var(--text-secondary);
      padding: 5px 0;
      transition: color 0.15s;
      line-height: 1.4;
    }

    .page-toc-link:hover { color: var(--accent); }
    .page-toc-link.indent { padding-left: 14px; font-size: 12px; }
    .page-toc-link.toc-active { color: var(--accent); font-weight: 600; }

    /* ===== Article typography ===== */
    .docs-article .docs-breadcrumb {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .docs-breadcrumb a { color: var(--text-muted); }
    .docs-breadcrumb a:hover { color: var(--accent); }

    .docs-article .page-title {
      font-size: clamp(28px, 4vw, 40px);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.02em;
      margin-bottom: 14px;
      color: var(--text);
    }

    .docs-article .page-lead {
      font-size: 18px;
      color: var(--text-secondary);
      line-height: 1.65;
      margin-bottom: 40px;
      padding-bottom: 32px;
      border-bottom: 1px solid var(--border);
      max-width: 640px;
    }

    .docs-article h2 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 48px 0 14px;
      color: var(--text);
      scroll-margin-top: calc(var(--nav-h) + 16px);
    }

    .docs-article h2:first-of-type {
      margin-top: 32px;
    }

    .docs-article h3 {
      font-size: 17px;
      font-weight: 700;
      margin: 28px 0 10px;
      color: var(--text);
      scroll-margin-top: calc(var(--nav-h) + 16px);
    }

    .docs-article h4 {
      font-size: 15px;
      font-weight: 700;
      margin: 20px 0 8px;
      color: var(--text);
    }

    .docs-article p {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.75;
      margin-bottom: 16px;
    }

    .docs-article ul, .docs-article ol {
      padding-left: 22px;
      margin-bottom: 16px;
    }

    .docs-article li {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.75;
      margin-bottom: 6px;
    }

    .docs-article li strong { color: var(--text); }

    .docs-article code {
      font-family: var(--font-mono);
      font-size: 0.875em;
      background: #f0f2f5;
      padding: 2px 7px;
      border-radius: 5px;
      color: var(--text);
      border: 1px solid var(--border);
    }

    .docs-article pre {
      background: #f6f8fa;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px 22px;
      overflow-x: auto;
      margin: 20px 0;
      position: relative;
    }

    .docs-article pre code {
      font-family: var(--font-mono);
      font-size: 13px;
      background: none;
      border: none;
      padding: 0;
      color: var(--text);
      line-height: 1.75;
    }

    .docs-article .pre-label {
      position: absolute;
      top: 0; right: 0;
      background: var(--border);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 3px 10px;
      border-radius: 0 10px 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .docs-article pre .kw { color: #d73a49; }
    .docs-article pre .fn { color: #6f42c1; }
    .docs-article pre .str { color: #032f62; }
    .docs-article pre .cmt { color: #6a737d; font-style: italic; }
    .docs-article pre .flag { color: #005cc5; }
    .docs-article pre .num { color: #e36209; }

    /* ===== Callouts ===== */
    .callout {
      display: flex;
      gap: 14px;
      padding: 16px 20px;
      border-radius: 10px;
      margin: 24px 0;
      font-size: 14px;
      line-height: 1.65;
    }

    .callout-icon {
      font-size: 18px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .callout-body { flex: 1; }
    .callout-body strong { display: block; margin-bottom: 4px; font-size: 14px; }
    .callout-body p { font-size: 14px; margin-bottom: 0; color: inherit; }
    .callout-body code { font-size: 12px; }

    .callout-info {
      background: #f0f7ff;
      border: 1px solid #b6dcfe;
      color: #0969da;
    }

    .callout-tip {
      background: #f0fff4;
      border: 1px solid #a7f3d0;
      color: #1a7f37;
    }

    .callout-warning {
      background: #fff8f0;
      border: 1px solid #fcd89a;
      color: #a8510f;
    }

    .callout-important {
      background: #fff0f3;
      border: 1px solid #ffc1cb;
      color: #cf222e;
    }

    /* ===== Steps ===== */
    .steps {
      margin: 28px 0;
      counter-reset: step-counter;
    }

    .step {
      display: flex;
      gap: 18px;
      margin-bottom: 28px;
      counter-increment: step-counter;
    }

    .step-num {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--text);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .step-body { flex: 1; }
    .step-body h4 { margin-top: 4px; margin-bottom: 8px; }
    .step-body p { margin-bottom: 10px; }

    /* ===== Feature cards ===== */
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }

    .feature-card {
      padding: 22px 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #fff;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .feature-card:hover {
      border-color: var(--accent);
      box-shadow: 0 4px 20px rgba(9, 105, 218, 0.07);
    }

    .feature-card-icon {
      font-size: 26px;
      margin-bottom: 12px;
    }

    .feature-card h4 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 6px;
      color: var(--text);
    }

    .feature-card p {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.6;
      margin-bottom: 0;
    }

    /* ===== Table ===== */
    .docs-article table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 14px;
    }

    .docs-article th {
      text-align: left;
      padding: 10px 14px;
      background: #f6f8fa;
      border: 1px solid var(--border);
      font-weight: 600;
      color: var(--text);
    }

    .docs-article td {
      padding: 10px 14px;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      vertical-align: top;
    }

    .docs-article tr:hover td { background: #fafbfc; }

    /* ===== Next/Prev nav ===== */
    .docs-pagination {
      display: flex;
      gap: 16px;
      margin-top: 64px;
      padding-top: 32px;
      border-top: 1px solid var(--border);
    }

    .docs-pagination-card {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 18px 20px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #fff;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .docs-pagination-card:hover {
      border-color: var(--accent);
      box-shadow: 0 4px 16px rgba(9, 105, 218, 0.07);
    }

    .docs-pagination-card.next { text-align: right; }

    .docs-pagination-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
    }

    .docs-pagination-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    /* ===== Footer ===== */
    footer {
      border-top: 1px solid var(--border);
      padding: 28px 24px;
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
    }

    footer a { color: var(--text-secondary); }

    /* ===== Responsive ===== */
    @media (max-width: 1200px) {
      .docs-layout {
        grid-template-columns: 260px 1fr;
      }
      .docs-page-toc { display: none; }
      .docs-main { padding: 48px 40px 80px; }
    }

    @media (max-width: 900px) {
      .docs-layout {
        grid-template-columns: 240px 1fr;
      }
      .docs-main { padding: 40px 28px 80px; }
    }

    @media (max-width: 680px) {
      .docs-layout {
        grid-template-columns: 1fr;
      }

      .docs-sidenav {
        position: fixed;
        top: var(--nav-h);
        left: 0; bottom: 0;
        width: 280px;
        z-index: 150;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        box-shadow: 4px 0 20px rgba(0,0,0,0.1);
        border-right: 1px solid var(--border);
      }

      .docs-sidenav.open {
        transform: translateX(0);
      }

      .nav-mobile-toggle { display: flex; }
      .nav-links { display: none; }
      .docs-main { padding: 32px 20px 60px; }

      .feature-grid { grid-template-columns: 1fr; }
      .docs-pagination { flex-direction: column; }
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
      <li><a href="/#why">Why</a></li>
      <li><a href="/#how">How it works</a></li>
      <li><a href="/#connectors">Connectors</a></li>
      <li><a href="/docs" class="active">Docs</a></li>
      <li><a href="/#download" class="nav-cta">Download</a></li>
    </ul>
    <button class="nav-mobile-toggle" id="nav-toggle" aria-label="Toggle navigation">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  </div>
</nav>

<div class="docs-layout">
  <aside class="docs-sidenav" id="docs-sidenav">
    ${sidebarNav}
  </aside>

  <main class="docs-main">
    <article class="docs-article">
      ${content}
    </article>
  </main>

  <aside class="docs-page-toc">
    ${toc}
  </aside>
</div>

<footer>
  <p>Frozen Ink &mdash; local-first knowledge layer for technical work. &nbsp;·&nbsp; <a href="/docs">Documentation</a></p>
</footer>

<script>
(function() {
  var toggle = document.getElementById('nav-toggle');
  var sidenav = document.getElementById('docs-sidenav');
  if (toggle && sidenav) {
    toggle.addEventListener('click', function() {
      sidenav.classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
      if (!sidenav.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
        sidenav.classList.remove('open');
      }
    });
  }

  var tocLinks = document.querySelectorAll('.page-toc-link');
  if (tocLinks.length) {
    var headings = [];
    tocLinks.forEach(function(link) {
      var id = link.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) headings.push({ el: el, link: link });
    });

    function onScroll() {
      var scrollY = window.scrollY + 80;
      var active = null;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].el.offsetTop <= scrollY) active = headings[i];
      }
      tocLinks.forEach(function(l) { l.classList.remove('toc-active'); });
      if (active) active.link.classList.add('toc-active');
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
</script>
</body>
</html>`;
}

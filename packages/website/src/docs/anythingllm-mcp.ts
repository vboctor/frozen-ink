import { renderDocsPage } from "./layout";

export const anythingllmMcpPage = renderDocsPage({
  title: "AnythingLLM MCP Setup",
  description:
    "Connect Frozen Ink collections to AnythingLLM via the Model Context Protocol so local models can search and read your knowledge base.",
  activePath: "/docs/integrations/anythingllm",
  canonicalPath: "/docs/integrations/anythingllm",
  section: "AI Integrations",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "how-it-works", title: "How it works" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "register-collections", title: "Register collections" },
    { id: "reload-anythingllm", title: "Reload AnythingLLM" },
    { id: "use-in-chat", title: "Use in chat" },
    { id: "manage-links", title: "Managing links" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AnythingLLM</span>
  </div>

  <h1 class="page-title">AnythingLLM MCP Setup</h1>
  <p class="page-lead">AnythingLLM supports the Model Context Protocol natively. Once linked, any local model you run — Llama, Mistral, Qwen, Gemma, and more — can search and read your Frozen Ink collections instantly, with no rate limits and no data leaving your machine.</p>

  <h2 id="overview">Overview</h2>
  <p>AnythingLLM reads a JSON config file (<code>anythingllm_mcp_servers.json</code>) to discover which MCP servers to expose to models in its Agent mode. Frozen Ink writes entries directly into that file, so you don't need to edit it manually.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🤖</div>
      <h4>Any local model</h4>
      <p>Works with any model AnythingLLM supports — Ollama, LM Studio, Llama, Mistral, Qwen, Gemma, and more. Give your local model a rich, searchable knowledge base without a cloud subscription.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">⚡</div>
      <h4>Instant, unlimited queries</h4>
      <p>stdio transport queries the local SQLite index with no HTTP overhead — responses land in milliseconds. No API rate limits, no per-query cost, no throttling regardless of how many tool calls the model makes.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Fully local</h4>
      <p>AnythingLLM spawns <code>fink mcp serve</code> as a subprocess on demand. Model, data, and retrieval all stay on your machine — nothing touches the cloud.</p>
    </div>
  </div>

  <h2 id="how-it-works">How it works</h2>
  <p>When you run <code>fink mcp add --tool anythingllm my-vault</code>, Frozen Ink writes an entry to AnythingLLM's MCP config file:</p>
  <pre><code><span class="cmt">~/.../anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json</span>
{
  "mcpServers": {
    "fink-my-vault": {
      "command": "fink",
      "args": ["mcp", "serve", "--collection", "my-vault"],
      "env": {}
    }
  }
}</code></pre>

  <p>After you reload AnythingLLM, the server appears as an available Agent Skill. When the model calls it, AnythingLLM spawns the subprocess and communicates over stdio — no background server required.</p>

  <h2 id="prerequisites">Prerequisites</h2>
  <ul>
    <li><strong>Frozen Ink</strong> installed and at least one collection synced (<code>fink status</code>)</li>
    <li><strong>AnythingLLM Desktop</strong> installed and launched at least once so its storage directory exists. Download from <a href="https://anythingllm.com">anythingllm.com</a>.</li>
    <li><strong>fink on PATH</strong> — AnythingLLM will spawn <code>fink mcp serve</code> as a subprocess. Verify: <code>which fink</code></li>
    <li>A model configured in AnythingLLM that supports Agent / tool use (most models do in Agent mode)</li>
  </ul>

  <h2 id="register-collections">Register collections</h2>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collections</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Register with AnythingLLM</h4>
        <pre><code>fink mcp add <span class="flag">--tool</span> anythingllm my-vault

<span class="cmt"># Add multiple collections at once</span>
fink mcp add <span class="flag">--tool</span> anythingllm my-vault my-project-issues</code></pre>
        <p>This writes entries to AnythingLLM's MCP config file. AnythingLLM doesn't need to be running at this point.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Verify the config</h4>
        <pre><code>fink mcp list <span class="flag">--tool</span> anythingllm</code></pre>
        <p>You should see your collection listed as <strong>linked</strong>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Config file location</strong>
      <p>Frozen Ink writes to the standard AnythingLLM storage path:</p>
      <ul>
        <li><strong>macOS:</strong> <code>~/Library/Application Support/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json</code></li>
        <li><strong>Windows:</strong> <code>%APPDATA%\\anythingllm-desktop\\storage\\plugins\\anythingllm_mcp_servers.json</code></li>
        <li><strong>Linux:</strong> <code>~/.config/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json</code></li>
      </ul>
    </div>
  </div>

  <h2 id="reload-anythingllm">Reload AnythingLLM</h2>
  <p>After registering collections, restart AnythingLLM (or use the in-app reload button if available) so it picks up the updated config. The Frozen Ink MCP servers will then appear in the Agent Skills panel.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Open Agent Skills</h4>
        <p>In AnythingLLM, go to <strong>Settings → Agent Skills</strong> (or the equivalent menu in your version). You should see the Frozen Ink servers listed (e.g. <code>fink-my-vault</code>).</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Enable the skills</h4>
        <p>Toggle on the Frozen Ink servers you want the model to use. Skills that are toggled off will not be called even if the model tries to invoke them.</p>
      </div>
    </div>
  </div>

  <h2 id="use-in-chat">Use in chat</h2>
  <p>In an AnythingLLM workspace set to <strong>Agent</strong> mode, the model can now call Frozen Ink tools automatically. Try asking:</p>
  <ul>
    <li><em>"Search my notes for anything about the caching strategy"</em></li>
    <li><em>"What open issues do I have tagged with 'performance'?"</em></li>
    <li><em>"Find recent commits in my project that touched the auth module"</em></li>
  </ul>

  <p>The model calls <code>entity_search</code> to find relevant items, then <code>entity_get_markdown</code> to read the full content and incorporate it into its response.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Use Agent mode</strong>
      <p>MCP tools are only available in AnythingLLM's <strong>Agent</strong> mode (the <code>@agent</code> prefix in chat, or a workspace set to Agent). Regular chat mode does not invoke tools.</p>
    </div>
  </div>

  <h2 id="manage-links">Managing links</h2>
  <pre><code><span class="cmt"># Add a collection</span>
fink mcp add <span class="flag">--tool</span> anythingllm my-vault

<span class="cmt"># Remove a collection</span>
fink mcp remove <span class="flag">--tool</span> anythingllm my-vault

<span class="cmt"># List current links</span>
fink mcp list <span class="flag">--tool</span> anythingllm

<span class="cmt"># List all MCP links across all tools</span>
fink mcp list</code></pre>

  <p>After adding or removing a collection, restart AnythingLLM for the change to take effect.</p>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>"anythingllm not found" when running fink mcp add</h3>
  <p>Frozen Ink looks for the AnythingLLM storage directory to confirm the app is installed. If it can't find it, launch AnythingLLM Desktop at least once so it creates its storage directory, then retry.</p>

  <h3>Skills don't appear in AnythingLLM after adding</h3>
  <p>Fully quit and relaunch AnythingLLM. The app reads the MCP config at startup — a simple window refresh may not be enough.</p>

  <h3>"fink: command not found" errors in AnythingLLM</h3>
  <p>AnythingLLM spawns <code>fink mcp serve</code> as a subprocess using the system PATH, which may differ from your shell's PATH. Verify:</p>
  <pre><code>which fink      <span class="cmt"># should print /usr/local/bin/fink or similar</span>
fink --version</code></pre>
  <p>If <code>fink</code> is installed in a user-local path (e.g. via npm without global), reinstall globally: <code>npm install -g @vboctor/fink</code> to put it in a standard system PATH location.</p>

  <h3>Stale results</h3>
  <p>Sync the collection and the next tool call will reflect the updated data:</p>
  <pre><code>fink sync my-vault</code></pre>

  <div class="docs-pagination">
    <a href="/docs/integrations/chatgpt-desktop" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">ChatGPT Desktop Integration</span>
    </a>
    <a href="/docs/publishing" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Publishing to Cloudflare</span>
    </a>
  </div>
  `,
});

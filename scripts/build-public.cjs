const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "public");
fs.mkdirSync(dir, { recursive: true });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MCP Toolkit</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    section { margin: 1.5rem 0; padding: 1rem; background: #f5f5f5; border-radius: 8px; }
    button { padding: 0.5rem 1rem; cursor: pointer; margin-right: 0.5rem; margin-top: 0.25rem; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .counts { font-family: monospace; margin: 0.5rem 0; }
    .error { color: #c00; }
    .success { color: #080; }
    pre { overflow: auto; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>MCP Toolkit</h1>
  <p>MCP endpoint: <a href="/api/mcp">/api/mcp</a></p>

  <section>
    <h2>Supabase state</h2>
    <div id="state-counts" class="counts">—</div>
    <button type="button" id="btn-refresh">Refresh counts</button>
    <button type="button" id="btn-sync">Sync from source</button>
    <div id="state-error" class="error"></div>
    <pre id="sync-result"></pre>
  </section>

  <script>
    const stateCounts = document.getElementById("state-counts");
    const stateError = document.getElementById("state-error");
    const syncResult = document.getElementById("sync-result");
    const btnRefresh = document.getElementById("btn-refresh");
    const btnSync = document.getElementById("btn-sync");

    async function loadState() {
      stateError.textContent = "";
      try {
        const r = await fetch("/api/supabase-state");
        const data = await r.json();
        if (!r.ok) {
          stateCounts.textContent = "—";
          stateError.textContent = data.error || "Failed to load state";
          return;
        }
        stateCounts.textContent = "contacts: " + data.contacts + "  |  linkedin_messages: " + data.linkedin_messages + "  |  senders: " + data.senders;
      } catch (e) {
        stateCounts.textContent = "—";
        stateError.textContent = e.message || "Request failed";
      }
    }

    async function runSync() {
      stateError.textContent = "";
      syncResult.textContent = "Syncing…";
      btnSync.disabled = true;
      try {
        const r = await fetch("/api/supabase-sync", { method: "POST" });
        const data = await r.json();
        syncResult.textContent = JSON.stringify(data, null, 2);
        if (!r.ok) stateError.textContent = data.error || "Sync failed";
        else await loadState();
      } catch (e) {
        syncResult.textContent = "";
        stateError.textContent = e.message || "Request failed";
      } finally {
        btnSync.disabled = false;
      }
    }

    btnRefresh.addEventListener("click", loadState);
    btnSync.addEventListener("click", runSync);
    loadState();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "index.html"), html);

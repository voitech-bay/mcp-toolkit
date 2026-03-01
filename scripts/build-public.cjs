const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "public");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "index.html"),
  "<!DOCTYPE html><html><head><meta charset=utf-8><title>MCP Toolkit</title></head><body><h1>MCP Toolkit</h1><p>MCP endpoint: <a href=/api/mcp>/api/mcp</a></p></body></html>"
);

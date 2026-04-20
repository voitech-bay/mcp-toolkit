import { createApp } from "vue";
import { createPinia } from "pinia";
import naive from "naive-ui";
import mixpanel from "mixpanel-browser";
import router from "./router";
import App from "./App.vue";
import "@shared/style.css";

(
  globalThis as typeof globalThis & {
    __MCP_CLIENT_FRONTEND__?: boolean;
  }
).__MCP_CLIENT_FRONTEND__ = true;

const distinctIdStorageKey = "voitech/client_frontend/distinct_id";
const existingDistinctId = localStorage.getItem(distinctIdStorageKey);
const distinctId = existingDistinctId ?? crypto.randomUUID();
if (!existingDistinctId) localStorage.setItem(distinctIdStorageKey, distinctId);

mixpanel.init("a108ea7e5ad166183e1f0c548b8bf319", {
  autocapture: true,
  api_host: "https://api-eu.mixpanel.com",
});
mixpanel.identify(distinctId);
mixpanel.register({
  app: "client_frontend",
  user_agent: navigator.userAgent,
  user_language: navigator.language,
  user_platform: navigator.platform,
  user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

const app = createApp(App);
app.use(createPinia());
app.use(naive);
app.use(router);
app.mount("#app");

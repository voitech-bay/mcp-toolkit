/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLIENT_PORTAL_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

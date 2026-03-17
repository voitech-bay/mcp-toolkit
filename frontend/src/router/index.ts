import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "Home", component: () => import("../views/HomePage.vue"), meta: { title: "MCP Toolkit" } },
    { path: "/tables", name: "Tables", component: () => import("../views/TablesPage.vue"), meta: { title: "Tables | MCP Toolkit" } },
    { path: "/sync", name: "Sync", component: () => import("../views/SyncPage.vue"), meta: { title: "Sync | MCP Toolkit" } },
  ],
});

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) document.title = title;
});

export default router;

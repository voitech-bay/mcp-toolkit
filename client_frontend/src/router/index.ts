import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/analytics/:projectId",
      name: "ClientProjectAnalytics",
      component: () => import("../views/ProjectAnalyticsPage.vue"),
      meta: { title: "Analytics | MCP Toolkit" },
    },
  ],
});

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) document.title = title;
});

export default router;

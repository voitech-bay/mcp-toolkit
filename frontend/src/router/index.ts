import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "Home", component: () => import("../views/HomePage.vue"), meta: { title: "Overview | MCP Toolkit" } },
    {
      path: "/analytics",
      name: "Analytics",
      component: () => import("../views/FlowDashboardPage.vue"),
      meta: { title: "Analytics | MCP Toolkit" },
    },
    {
      path: "/flow-dashboard",
      name: "FlowDashboard",
      component: () => import("../views/FlowDashboardPage.vue"),
      meta: { title: "Analytics | MCP Toolkit" },
    },
    { path: "/tables", name: "Tables", component: () => import("../views/TablesPage.vue"), meta: { title: "Tables | MCP Toolkit" } },
    { path: "/sync", name: "Sync", component: () => import("../views/SyncPage.vue"), meta: { title: "Sync | MCP Toolkit" } },
    { path: "/companies", name: "Companies", component: () => import("../views/CompaniesPage.vue"), meta: { title: "Companies | MCP Toolkit" } },
    { path: "/contacts", name: "Contacts", component: () => import("../views/ContactsPage.vue"), meta: { title: "Contacts | MCP Toolkit" } },
    { path: "/hypotheses", name: "Hypotheses", component: () => import("../views/HypothesesPage.vue"), meta: { title: "Hypotheses | MCP Toolkit" } },
    {
      path: "/hypothesis-tag-contacts",
      name: "HypothesisTagContacts",
      component: () => import("../views/HypothesisTagContactsPage.vue"),
      meta: { title: "Hypothesis contacts (tag) | MCP Toolkit" },
    },
    { path: "/context", name: "Context", component: () => import("../views/ContextBuilderPage.vue"), meta: { title: "Context Builder | MCP Toolkit" } },
    { path: "/context-snapshots", name: "ContextSnapshots", component: () => import("../views/ContextSnapshotsPage.vue"), meta: { title: "Saved Contexts | MCP Toolkit" } },
    { path: "/conversations", name: "Conversations", component: () => import("../views/ConversationsPage.vue"), meta: { title: "Conversations | MCP Toolkit" } },
    { path: "/getsales-tags", name: "GetSalesTags", component: () => import("../views/GetSalesTagsPage.vue"), meta: { title: "GetSales tags | MCP Toolkit" } },
    { path: "/enrichment", name: "EnrichmentTable", component: () => import("../views/EnrichmentTablePage.vue"), meta: { title: "Enrichment | MCP Toolkit" } },
    { path: "/enrichment/jobs", name: "EnrichmentJobs", component: () => import("../views/EnrichmentJobsPage.vue"), meta: { title: "Enrichment jobs | MCP Toolkit" } },
    {
      path: "/dify/batches",
      name: "DifyBatches",
      component: () => import("../views/DifyBatchesPage.vue"),
      meta: { title: "Dify batches | MCP Toolkit" },
    },
  ],
});

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) document.title = title;
});

export default router;

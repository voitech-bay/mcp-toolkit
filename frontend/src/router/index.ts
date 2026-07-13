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
      path: "/analytics/total",
      name: "AnalyticsTotal",
      component: () => import("../views/AnalyticsTotalPage.vue"),
      meta: { title: "Analytics total | MCP Toolkit" },
    },
    {
      path: "/flow-dashboard",
      name: "FlowDashboard",
      component: () => import("../views/FlowDashboardPage.vue"),
      meta: { title: "Analytics | MCP Toolkit" },
    },
    { path: "/tables", name: "Tables", component: () => import("../views/TablesPage.vue"), meta: { title: "Tables | MCP Toolkit" } },
    { path: "/sync", name: "Sync", component: () => import("../views/SyncPage.vue"), meta: { title: "Sync | MCP Toolkit" } },
    { path: "/lists-checker", name: "ListsChecker", component: () => import("../views/ListsCheckerPage.vue"), meta: { title: "Lists checker | MCP Toolkit" } },
    { path: "/mssp-leaders", name: "MsspLeaders", component: () => import("../views/MsspLeadersPage.vue"), meta: { title: "MSSP Leaders in MENA | MCP Toolkit" } },
    { path: "/outreach-knowledge", name: "OutreachKnowledge", component: () => import("../views/OutreachKnowledgePage.vue"), meta: { title: "Outreach Knowledge | MCP Toolkit" } },
    { path: "/companies", name: "Companies", component: () => import("../views/CompaniesPage.vue"), meta: { title: "Companies | MCP Toolkit" } },
    { path: "/contacts", name: "Contacts", component: () => import("../views/ContactsPage.vue"), meta: { title: "Contacts | MCP Toolkit" } },
    { path: "/hypotheses", name: "Hypotheses", component: () => import("../views/HypothesesPage.vue"), meta: { title: "Hypotheses | MCP Toolkit" } },
    {
      path: "/hypothesis-tag-contacts",
      name: "HypothesisTagContacts",
      component: () => import("../views/HypothesisTagContactsPage.vue"),
      meta: { title: "Hypothesis contacts (tag) | MCP Toolkit" },
    },
    { path: "/context", name: "Context", component: () => import("../views/ContextBuilderPage.vue"), meta: { title: "Context Map | MCP Toolkit" } },
    { path: "/context-snapshots", name: "ContextSnapshots", component: () => import("../views/ContextSnapshotsPage.vue"), meta: { title: "Saved Contexts | MCP Toolkit" } },
    { path: "/conversations", name: "Conversations", component: () => import("../views/ConversationsPage.vue"), meta: { title: "Conversations | MCP Toolkit" } },
    { path: "/getsales-tags", name: "GetSalesTags", component: () => import("../views/GetSalesTagsPage.vue"), meta: { title: "GetSales tags | MCP Toolkit" } },
    { path: "/enrichment", name: "EnrichmentTable", component: () => import("../views/EnrichmentTablePage.vue"), meta: { title: "Enrichment | MCP Toolkit" } },
    { path: "/enrichment/jobs", name: "EnrichmentJobs", component: () => import("../views/EnrichmentJobsPage.vue"), meta: { title: "Enrichment jobs | MCP Toolkit" } },
    {
      path: "/n8n/launch",
      name: "N8nLaunch",
      component: () => import("../views/WorkflowLauncherPage.vue"),
      meta: { title: "Launch workflow | MCP Toolkit" },
    },
    {
      path: "/velvetech/research-launch",
      name: "VelvetechResearchLaunch",
      component: () => import("../views/VelvetechResearchLaunchPage.vue"),
      meta: { title: "Velvetech research | Voitech" },
    },
    {
      path: "/n8n/lead-views",
      name: "N8nLeadViews",
      component: () => import("../views/LeadViewsPage.vue"),
      meta: { title: "Lead views | MCP Toolkit" },
    },
    {
      path: "/n8n/workflow-results",
      name: "N8nWorkflowResults",
      component: () => import("../views/N8nWorkflowResultsPage.vue"),
      meta: { title: "n8n workflow results | MCP Toolkit" },
    },
    {
      path: "/inmail-review",
      name: "InMailReview",
      component: () => import("../views/InMailReviewPage.vue"),
      meta: { title: "Message log | MCP Toolkit" },
    },
    {
      path: "/email-studio",
      name: "EmailStudio",
      component: () => import("../views/EmailStudioPage.vue"),
      meta: { title: "Email Studio | MCP Toolkit" },
    },
    {
      path: "/calls/cold-n8n",
      name: "ColdCallN8n",
      component: () => import("../views/ColdCallN8nPage.vue"),
      meta: { title: "Cold call — n8n | MCP Toolkit" },
    },
    {
      path: "/contact/:uuid",
      name: "ContactCard",
      component: () => import("../views/ContactCardPage.vue"),
      meta: { title: "Contact | MCP Toolkit" },
    },
    {
      path: "/company/:id",
      name: "CompanyCard",
      component: () => import("../views/CompanyCardPage.vue"),
      meta: { title: "Company | MCP Toolkit" },
    },
  ],
});

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) document.title = title;
});

export default router;

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Project } from "../types";

const STORAGE_KEY = "mcp-toolkit/selectedProjectId";

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);

  const selectedProjectId = ref<string | null>(
    typeof localStorage !== "undefined" ? (localStorage.getItem(STORAGE_KEY) ?? null) : null
  );

  const selectedProject = computed<Project | null>(
    () => projects.value.find((p) => p.id === selectedProjectId.value) ?? null
  );

  async function loadProjects() {
    loading.value = true;
    try {
      const r = await fetch("/api/projects");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to load projects");
      projects.value = data.data ?? [];
      // If the stored id no longer exists, clear it
      if (selectedProjectId.value && !projects.value.find((p) => p.id === selectedProjectId.value)) {
        selectProject(null);
      }
    } catch (e) {
      console.error("[project-store] loadProjects:", e instanceof Error ? e.message : e);
    } finally {
      loading.value = false;
    }
  }

  function selectProject(id: string | null) {
    selectedProjectId.value = id;
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    }
  }

  return { projects, loading, selectedProjectId, selectedProject, loadProjects, selectProject };
});

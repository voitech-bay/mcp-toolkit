import { ref, computed, type Ref } from "vue";
import { h } from "vue";
import {
  NButton,
  NCheckbox,
  NInput,
} from "naive-ui";
import type { DataTableColumns, DataTableFilterState } from "naive-ui";

/** Escape special regex chars so the term can be used in new RegExp(escaped, 'gi'). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split text by term (case-insensitive) and return VNode with matches wrapped in mark. */
function renderWithHighlights(text: string, term: string): ReturnType<typeof h> {
  const raw = text ?? "";
  const t = term.trim();
  if (!t || !raw) return h("span", {}, raw || "—");
  const escaped = escapeRegex(t);
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = raw.split(re);
  // With capturing group, split gives [before, match1, between, match2, ...]; odd indices are matches.
  const nodes = parts.map((part, i) =>
    i % 2 === 1 ? h("mark", { class: "search-highlight", key: i }, part) : part
  );
  return h("span", {}, nodes);
}

const AVATAR_PLACEHOLDER_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#888" rx="16"/><text x="16" y="22" text-anchor="middle" fill="#fff" font-size="14">?</text></svg>'
  );

export function useDataTableColumns(
  data: Ref<Record<string, unknown>[]>,
  filterState: Ref<DataTableFilterState>,
  visibleColumnKeys: Ref<string[]>,
  setFilterState: (v: DataTableFilterState) => void,
  renderAction: (row: Record<string, unknown>) => ReturnType<typeof h>,
  options?: {
    highlightTerm?: Ref<string>;
    /** Single column key (legacy) or list of column keys to highlight search term in. */
    highlightColumnKey?: string;
    highlightColumnKeys?: string[];
  }
) {
  const highlightTerm = options?.highlightTerm;
  const highlightColumnKey = options?.highlightColumnKey ?? "";
  const highlightColumnKeys = options?.highlightColumnKeys ?? (highlightColumnKey ? [highlightColumnKey] : []);
  const manualFilterInputByColumn = ref<Record<string, string>>({});

  const allKeys = computed(() => {
    const set = new Set<string>();
    data.value.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
    return Array.from(set).sort();
  });

  const effectiveVisibleKeys = computed(() => {
    const visible = visibleColumnKeys.value;
    if (visible.length === 0) return allKeys.value;
    const set = new Set(visible);
    return allKeys.value.filter((k) => set.has(k));
  });

  function formatCell(value: unknown): string {
    if (value == null) return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function isAvatarUrlColumn(key: string): boolean {
    return key === "avatar_url" || key.toLowerCase() === "avatar_url";
  }

  function renderAvatarCell(url: unknown): ReturnType<typeof h> {
    const s = typeof url === "string" && url.trim() ? url.trim() : null;
    if (!s) return h("span", {}, formatCell(url));
    return h("img", {
      src: s,
      alt: "",
      class: "avatar-cell",
      onError(e: Event) {
        const el = e.target as HTMLImageElement;
        if (el) el.src = AVATAR_PLACEHOLDER_SVG;
      },
    });
  }

  function getUniqueValues(key: string): { label: string; value: string }[] {
    const set = new Set<string>();
    data.value.forEach((row) => {
      const v = row[key];
      const s = formatCell(v);
      if (s) set.add(s);
    });
    return Array.from(set)
      .sort()
      .slice(0, 200)
      .map((s) => ({ label: s, value: s }));
  }

  function addCustomFilterValue(colKey: string) {
    const raw = (manualFilterInputByColumn.value[colKey] ?? "").trim();
    if (!raw) return;
    const current = filterState.value[colKey];
    const values = Array.isArray(current) ? [...current] : current != null ? [current] : [];
    if (values.includes(raw)) return;
    setFilterState({ ...filterState.value, [colKey]: [...values, raw] });
    manualFilterInputByColumn.value = { ...manualFilterInputByColumn.value, [colKey]: "" };
  }

  function buildFilterMenu(key: string) {
    return (actions: { hide: () => void }) => {
      const options = getUniqueValues(key);
      const selected = filterState.value[key];
      const values = Array.isArray(selected) ? selected : selected != null ? [selected] : [];
      const inputVal = manualFilterInputByColumn.value[key] ?? "";
      return h("div", { class: "filter-menu" }, [
        h(
          "div",
          { class: "filter-menu-options" },
          options.map((opt) =>
            h(NCheckbox, {
              checked: values.includes(opt.value),
              onUpdateChecked: (checked: boolean) => {
                const next = checked ? [...values, opt.value] : values.filter((v) => v !== opt.value);
                setFilterState({ ...filterState.value, [key]: next });
              },
            }, () => opt.label)
          )
        ),
        h("div", { class: "filter-menu-custom" }, [
          h(NInput, {
            value: inputVal,
            onUpdateValue: (v: string) => {
              manualFilterInputByColumn.value = { ...manualFilterInputByColumn.value, [key]: v };
            },
            placeholder: "Type value…",
            size: "small",
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === "Enter") addCustomFilterValue(key);
            },
          }),
          h(NButton, { size: "small", onClick: () => addCustomFilterValue(key) }, "Add"),
        ]),
        h("div", { class: "filter-menu-actions" }, [
          h(NButton, { size: "small", type: "primary", onClick: actions.hide }, "OK"),
        ]),
      ]);
    };
  }

  const tableColumns = computed((): DataTableColumns<Record<string, unknown>> => {
    const dataColumns = effectiveVisibleKeys.value.map((key) => {
      const options = getUniqueValues(key);
      const isAvatar = isAvatarUrlColumn(key);
      return {
        width: isAvatar ? 120 : 200,
        title: key,
        key,
        ellipsis: key === "text" ? false : true,
        filter: true,
        filterOptions: options.length > 0 ? options : [{ label: "(empty)", value: "—" }],
        filterOptionValues: filterState.value[key] as string[] | undefined,
        filterMultiple: true,
        renderFilterMenu: buildFilterMenu(key),
        render(row: Record<string, unknown>) {
          if (isAvatar) return renderAvatarCell(row[key]);
          const cellText = formatCell(row[key]);
          if (highlightColumnKeys.includes(key) && highlightTerm?.value?.trim()) {
            return renderWithHighlights(cellText, highlightTerm.value.trim());
          }
          return cellText;
        },
      };
    });
    const actionsColumn = {
      title: "Actions",
      key: "__actions",
      width: 120,
      fixed: "right" as const,
      filter: false,
      render: (row: Record<string, unknown>) => renderAction(row),
    } as const;
    return [...dataColumns, actionsColumn];
  });

  const scrollX = computed(() => {
    const cols = tableColumns.value;
    return cols.reduce((sum, c) => sum + (Number((c as { width?: number }).width) || 200), 0);
  });

  return {
    tableColumns,
    scrollX,
    allKeys,
    effectiveVisibleKeys,
  };
}

import { ref, type Ref } from "vue";

const STORAGE_PREFIX = "mcp-toolkit/column-widths";

type ResizableColumn = {
  key?: string | number;
  width?: number;
  minWidth?: number;
  type?: string;
  resizable?: boolean;
};

function loadWidths(storageKey: string): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}/${storageKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function saveWidths(storageKey: string, widths: Record<string, number>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}/${storageKey}`, JSON.stringify(widths));
  } catch {
    /* ignore quota / private mode */
  }
}

export type { ResizableColumn };
export function useResizableTableColumns(storageKey: string, defaultWidths: Record<string, number> = {}) {
  const columnWidths = ref<Record<string, number>>({
    ...defaultWidths,
    ...loadWidths(storageKey),
  });

  function widthFor(key: string, fallback: number): number {
    return columnWidths.value[key] ?? fallback;
  }

  function onColumnResize(
    resizedWidth: number,
    _limitedWidth: number,
    column: { key?: string | number }
  ): void {
    if (column.key == null) return;
    const key = String(column.key);
    columnWidths.value = { ...columnWidths.value, [key]: resizedWidth };
    saveWidths(storageKey, columnWidths.value);
  }

  function applyResizable<T>(
    columns: T[],
    defaults: Record<string, number> = defaultWidths,
    options?: { resizable?: boolean }
  ): T[] {
    const enable = options?.resizable !== false;
    return columns.map((col) => {
      const c = col as ResizableColumn;
      if (!enable || c.type === "selection" || c.key == null) return col;
      const key = String(c.key);
      const fallback = Number(c.width ?? defaults[key] ?? 200);
      return {
        ...(col as object),
        width: widthFor(key, fallback),
        resizable: true,
        minWidth: c.minWidth ?? 72,
      } as T;
    });
  }

  function scrollXFor(columns: ResizableColumn[], defaults: Record<string, number> = defaultWidths): number {
    return columns.reduce((sum, col) => {
      if (col.type === "selection") return sum + 40;
      if (col.key == null) return sum + Number(col.width ?? 120);
      const key = String(col.key);
      const fallback = Number(col.width ?? defaults[key] ?? 200);
      return sum + widthFor(key, fallback);
    }, 0);
  }

  return {
    columnWidths: columnWidths as Ref<Record<string, number>>,
    widthFor,
    onColumnResize,
    applyResizable,
    scrollXFor,
  };
}

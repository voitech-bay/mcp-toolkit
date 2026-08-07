/**
 * Deterministic uuid derivation shared between bridge-wellore-to-canonical.ts
 * (forward: wellore bigint id -> canonical uuid) and the messaging launcher
 * (reverse: canonical company_uuid -> wellore.companies bigint id, needed to
 * read wellore.companies.pov / wellore.signals, which are keyed by bigint).
 */
import { createHash } from "node:crypto";

function deterministicUuid(prefix: string, id: number | string): string {
  const hex = createHash("md5").update(`${prefix}${id}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const welloreCompanyUuid = (id: number | string): string => deterministicUuid("wellore:company:", id);
export const welloreContactUuid = (id: number | string): string => deterministicUuid("wellore:contact:", id);

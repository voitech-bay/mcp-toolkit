import type { SyncEntityKey } from "./types";

/** Labels for sync UI (keys match server `SyncEntityKey`). */
export const SYNC_ENTITY_LABELS: Record<SyncEntityKey, string> = {
  companies: "Companies",
  contacts: "Contacts",
  linkedin_messages: "LinkedIn messages",
  senders: "Senders",
  contact_lists: "Contact lists",
  flows: "Flows",
  flow_leads: "Flow leads",
};

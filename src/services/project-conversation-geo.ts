/**
 * Aggregates recent LinkedIn conversations for a project by contact country.
 *
 * Location is free-text on public.Contacts (`location`). We extract a country
 * token from the tail of the string and normalize it to a canonical English
 * country name that matches echarts' world GeoJSON `properties.name` field.
 * Unrecognized locations are bucketed under "Unknown" and a sample of raw
 * strings is returned for UI hinting.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTACTS_TABLE,
  FLOW_LEADS_TABLE,
  FLOWS_TABLE,
  getConversationsList,
  type ConversationReplyTag,
} from "./supabase.js";

export interface GeoCountryRow {
  /** Canonical English name, matches world GeoJSON `properties.name`. */
  country: string;
  /** ISO-3166-1 alpha-2 (best effort — may be null for fuzzy matches). */
  iso2: string | null;
  conversations: number;
  contacts: number;
  messagesIn: number;
  messagesOut: number;
  positiveReplies: number;
  noResponse: number;
  waiting: number;
  /** Last message timestamp across conversations in this country (ISO string). */
  lastMessageAt: string | null;
}

export interface GeoFlowCountryReplyEdge {
  flowUuid: string;
  flowName: string;
  country: string;
  replyTag: ConversationReplyTag;
  conversations: number;
}

export interface ProjectConversationGeoResult {
  totals: {
    conversationsScanned: number;
    conversationsMapped: number;
    conversationsUnknown: number;
    countries: number;
  };
  /** Descending by conversations. */
  byCountry: GeoCountryRow[];
  /** Flow → Country → replyTag edges, for sankey diagrams. */
  flowCountryEdges: GeoFlowCountryReplyEdge[];
  /** Up to ~20 raw unparseable location strings to help the user spot patterns. */
  unknownLocationSamples: string[];
  /** Best-effort country-like tokens extracted from unknown locations with frequencies. */
  unknownCountryCandidates: Array<{ token: string; count: number }>;
  error: string | null;
}

const UNKNOWN_COUNTRY_BUCKET = "Unknown country";
const NOT_SET_COUNTRY_BUCKET = "Not set country";

interface CountryAlias {
  name: string;
  iso2: string | null;
}

/** Normalize to NFD + strip accents + collapse whitespace + lowercase. */
function normalizeKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Country alias map. Keys are normalized via `normalizeKey`; canonical names
 * match Natural Earth 1:110m `properties.NAME` values so the echarts world
 * choropleth colors the right polygon. Covers the long tail of LinkedIn
 * `location.country` variants (abbreviations, localized names, historical
 * forms, alt-spellings). Unmatched strings fall through to "Unknown".
 */
const COUNTRY_ALIASES: Record<string, CountryAlias> = (() => {
  // Canonical list: (name as in Natural Earth NAME, iso2, aliases)
  const list: Array<[string, string | null, string[]]> = [
    ["United States of America", "US", ["usa", "us", "u s", "u s a", "united states", "america"]],
    ["United Kingdom", "GB", ["uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland"]],
    ["Germany", "DE", ["deutschland"]],
    ["France", "FR", []],
    ["Spain", "ES", ["espana"]],
    ["Italy", "IT", ["italia"]],
    ["Portugal", "PT", []],
    ["Netherlands", "NL", ["the netherlands", "holland", "nederland"]],
    ["Belgium", "BE", ["belgique"]],
    ["Switzerland", "CH", ["schweiz", "suisse"]],
    ["Austria", "AT", ["osterreich"]],
    ["Ireland", "IE", ["republic of ireland", "eire"]],
    ["Denmark", "DK", ["danmark"]],
    ["Norway", "NO", ["norge"]],
    ["Sweden", "SE", ["sverige"]],
    ["Finland", "FI", ["suomi"]],
    ["Iceland", "IS", []],
    ["Poland", "PL", ["polska"]],
    ["Czechia", "CZ", ["czech republic", "czech rep", "czech rep."]],
    ["Slovakia", "SK", []],
    ["Hungary", "HU", []],
    ["Romania", "RO", []],
    ["Bulgaria", "BG", []],
    ["Greece", "GR", ["hellas"]],
    ["Turkey", "TR", ["turkiye", "turkiye cumhuriyeti"]],
    ["Ukraine", "UA", ["ukrayina"]],
    ["Belarus", "BY", []],
    ["Russia", "RU", ["russian federation", "rossiya"]],
    ["Estonia", "EE", []],
    ["Latvia", "LV", []],
    ["Lithuania", "LT", []],
    ["Serbia", "RS", []],
    ["Croatia", "HR", ["hrvatska"]],
    ["Slovenia", "SI", []],
    ["Bosnia and Herz.", "BA", ["bosnia and herzegovina", "bosnia", "bih"]],
    ["North Macedonia", "MK", ["macedonia"]],
    ["Albania", "AL", []],
    ["Cyprus", "CY", []],
    ["Malta", "MT", []],
    ["Luxembourg", "LU", []],
    ["Moldova", "MD", []],
    ["Kosovo", "XK", []],
    ["Montenegro", "ME", []],
    ["Canada", "CA", []],
    ["Mexico", "MX", ["mexique"]],
    ["Brazil", "BR", ["brasil"]],
    ["Argentina", "AR", []],
    ["Chile", "CL", []],
    ["Colombia", "CO", []],
    ["Peru", "PE", []],
    ["Venezuela", "VE", []],
    ["Uruguay", "UY", []],
    ["Paraguay", "PY", []],
    ["Ecuador", "EC", []],
    ["Bolivia", "BO", []],
    ["Costa Rica", "CR", []],
    ["Panama", "PA", []],
    ["Dominican Rep.", "DO", ["dominican republic", "republica dominicana"]],
    ["Cuba", "CU", []],
    ["Guatemala", "GT", []],
    ["Honduras", "HN", []],
    ["El Salvador", "SV", []],
    ["Nicaragua", "NI", []],
    ["Jamaica", "JM", []],
    ["Haiti", "HT", []],
    ["Australia", "AU", []],
    ["New Zealand", "NZ", []],
    ["Japan", "JP", ["nippon"]],
    ["China", "CN", ["peoples republic of china", "pr china", "prc"]],
    ["Taiwan", "TW", []],
    ["South Korea", "KR", ["korea", "republic of korea"]],
    ["North Korea", "KP", ["dprk"]],
    ["India", "IN", ["bharat"]],
    ["Pakistan", "PK", []],
    ["Bangladesh", "BD", []],
    ["Sri Lanka", "LK", []],
    ["Nepal", "NP", []],
    ["Bhutan", "BT", []],
    ["Thailand", "TH", []],
    ["Vietnam", "VN", ["viet nam"]],
    ["Philippines", "PH", []],
    ["Indonesia", "ID", []],
    ["Malaysia", "MY", []],
    ["Myanmar", "MM", ["burma"]],
    ["Cambodia", "KH", []],
    ["Laos", "LA", []],
    ["Mongolia", "MN", []],
    ["Israel", "IL", []],
    ["Palestine", "PS", []],
    ["United Arab Emirates", "AE", ["uae", "u a e"]],
    ["Saudi Arabia", "SA", ["ksa"]],
    ["Qatar", "QA", []],
    ["Kuwait", "KW", []],
    ["Bahrain", "BH", []],
    ["Oman", "OM", []],
    ["Jordan", "JO", []],
    ["Lebanon", "LB", []],
    ["Syria", "SY", []],
    ["Yemen", "YE", []],
    ["Iran", "IR", []],
    ["Iraq", "IQ", []],
    ["Afghanistan", "AF", []],
    ["Egypt", "EG", []],
    ["Morocco", "MA", []],
    ["Tunisia", "TN", []],
    ["Algeria", "DZ", []],
    ["Libya", "LY", []],
    ["Sudan", "SD", []],
    ["S. Sudan", "SS", ["south sudan"]],
    ["South Africa", "ZA", ["rsa"]],
    ["Nigeria", "NG", []],
    ["Kenya", "KE", []],
    ["Ghana", "GH", []],
    ["Ethiopia", "ET", []],
    ["Tanzania", "TZ", []],
    ["Uganda", "UG", []],
    ["Rwanda", "RW", []],
    ["Senegal", "SN", []],
    ["Cameroon", "CM", []],
    ["Côte d'Ivoire", "CI", ["cote d ivoire", "cote d'ivoire", "ivory coast"]],
    ["Kazakhstan", "KZ", []],
    ["Uzbekistan", "UZ", []],
    ["Turkmenistan", "TM", []],
    ["Kyrgyzstan", "KG", []],
    ["Tajikistan", "TJ", []],
    ["Armenia", "AM", []],
    ["Azerbaijan", "AZ", []],
    ["Georgia", "GE", []],
    // City-states and micro-nations (absent from NE 110m but common in
    // LinkedIn data — we still want them bucketed, even if the world map
    // can't color a polygon for them).
    ["Singapore", "SG", []],
    ["Hong Kong", "HK", ["hong kong sar"]],
    ["Macau", "MO", ["macao", "macau sar"]],
    ["Monaco", "MC", []],
    ["Liechtenstein", "LI", []],
    ["Andorra", "AD", []],
    ["San Marino", "SM", []],
    ["Vatican City", "VA", ["holy see"]],
    ["Gibraltar", "GI", []],
    ["Malta", "MT", []],
    ["Bahrain", "BH", []],
    ["Brunei", "BN", ["brunei darussalam"]],
    ["Maldives", "MV", []],
    ["Mauritius", "MU", []],
    ["Seychelles", "SC", []],
    ["Comoros", "KM", []],
    ["Cape Verde", "CV", ["cabo verde"]],
    ["Fiji", "FJ", []],
    ["Papua New Guinea", "PG", []],
    ["Solomon Is.", "SB", ["solomon islands"]],
    ["New Caledonia", "NC", []],
    ["Vanuatu", "VU", []],
    ["Samoa", "WS", []],
    ["Tonga", "TO", []],
    // Americas tail
    ["Bahamas", "BS", ["the bahamas"]],
    ["Barbados", "BB", []],
    ["Belize", "BZ", []],
    ["Guyana", "GY", []],
    ["Suriname", "SR", []],
    ["Trinidad and Tobago", "TT", []],
    ["Puerto Rico", "PR", []],
    // Africa tail
    ["Somaliland", null, []],
    ["Somalia", "SO", []],
    ["Djibouti", "DJ", []],
    ["Eritrea", "ER", []],
    ["Burundi", "BI", []],
    ["Malawi", "MW", []],
    ["Mozambique", "MZ", []],
    ["Zimbabwe", "ZW", []],
    ["Zambia", "ZM", []],
    ["Botswana", "BW", []],
    ["Namibia", "NA", []],
    ["Angola", "AO", []],
    ["Madagascar", "MG", []],
    ["Lesotho", "LS", []],
    ["eSwatini", "SZ", ["swaziland", "eswatini"]],
    ["Mauritania", "MR", []],
    ["Mali", "ML", []],
    ["Niger", "NE", []],
    ["Chad", "TD", []],
    ["Burkina Faso", "BF", []],
    ["Benin", "BJ", []],
    ["Togo", "TG", []],
    ["Sierra Leone", "SL", []],
    ["Liberia", "LR", []],
    ["Guinea", "GN", []],
    ["Guinea-Bissau", "GW", []],
    ["Gambia", "GM", ["the gambia"]],
    ["Gabon", "GA", []],
    ["Congo", "CG", ["republic of congo", "republic of the congo"]],
    ["Dem. Rep. Congo", "CD", ["democratic republic of the congo", "democratic republic of congo", "dr congo", "drc"]],
    ["Central African Rep.", "CF", ["central african republic", "car"]],
    ["Eq. Guinea", "GQ", ["equatorial guinea"]],
    ["Cameroon", "CM", []],
    ["Rwanda", "RW", []],
    ["Senegal", "SN", []],
  ];
  const out: Record<string, CountryAlias> = {};
  for (const [name, iso2, aliases] of list) {
    out[normalizeKey(name)] = { name, iso2 };
    for (const a of aliases) {
      out[normalizeKey(a)] = { name, iso2 };
    }
  }
  return out;
})();

/**
 * Extract a country from `Contacts.location`. The column is free-form but in
 * practice holds one of three shapes:
 *
 *  1) JSON string with structured fields:
 *     `{"country":"Lithuania","region":"Vilnius County","city":null,...}`
 *     — parse and read `.country` (preferred; most reliable).
 *  2) Plain text like "San Francisco, California, United States".
 *  3) A bare country name like "Ukraine" or "UK".
 *
 * We try the JSON path first, then the alias map on the full string, then the
 * last ~3 comma-separated tokens (right-to-left). Returns null when nothing
 * matches so the aggregator can surface it under "Unknown".
 */
export function extractCountryFromLocation(
  location: string | null | undefined
): CountryAlias | null {
  if (typeof location !== "string") return null;
  const raw = location.trim();
  if (!raw) return null;

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidate =
        parsed && typeof parsed === "object" && "country" in parsed
          ? (parsed as { country?: unknown }).country
          : null;
      if (typeof candidate === "string" && candidate.trim()) {
        const hit = COUNTRY_ALIASES[normalizeKey(candidate)];
        if (hit) return hit;
      }
    } catch {
      // fall through to plain-text handling
    }
  }

  const full = COUNTRY_ALIASES[normalizeKey(raw)];
  if (full) return full;
  const parts = raw.split(/,/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
    const hit = COUNTRY_ALIASES[normalizeKey(parts[i]!)];
    if (hit) return hit;
  }
  return null;
}

/**
 * Best-effort extractor for unknown locations. Returns a likely country token
 * from the tail of the location string so UI can surface repeated misses.
 */
function extractUnknownCountryCandidate(location: string | null | undefined): string | null {
  if (typeof location !== "string") return null;
  const raw = location.trim();
  if (!raw) return null;
  let candidate = raw;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const country = (parsed as { country?: unknown }).country;
        if (typeof country === "string" && country.trim()) {
          candidate = country.trim();
        }
      }
    } catch {
      // keep raw fallback
    }
  }
  const parts = candidate
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const tail = parts.length > 0 ? parts[parts.length - 1]! : candidate.trim();
  const normalized = tail.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > 60) return normalized.slice(0, 60);
  return normalized;
}

/**
 * Recent conversations for a project aggregated by contact country. Uses the
 * existing `getConversationsList` (RPC-backed) for conversation summaries, then
 * enriches with `Contacts.location` and `FlowLeads`/`Flows` for flow-country
 * edges.
 */
export async function getProjectConversationGeoAggregates(
  client: SupabaseClient,
  projectId: string,
  options?: { limit?: number; flowUuids?: string[] }
): Promise<ProjectConversationGeoResult> {
  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
  const flowFilterSet =
    options?.flowUuids && options.flowUuids.length > 0 ? new Set(options.flowUuids) : null;

  const { data: conversations, error: convErr } = await getConversationsList(
    client,
    projectId,
    { limit, offset: 0 }
  );
  if (convErr) {
    return {
      totals: { conversationsScanned: 0, conversationsMapped: 0, conversationsUnknown: 0, countries: 0 },
      byCountry: [],
      flowCountryEdges: [],
      unknownLocationSamples: [],
      unknownCountryCandidates: [],
      error: convErr,
    };
  }

  const leadUuids = [
    ...new Set(
      conversations.map((c) => c.leadUuid).filter((x): x is string => typeof x === "string" && x.length > 0)
    ),
  ];

  const locationByLead = new Map<string, string | null>();
  if (leadUuids.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leadUuids.length; i += chunkSize) {
      const chunk = leadUuids.slice(i, i + chunkSize);
      const { data, error } = await client
        .from(CONTACTS_TABLE)
        .select("uuid, location")
        .in("uuid", chunk);
      if (error) {
        return {
          totals: { conversationsScanned: 0, conversationsMapped: 0, conversationsUnknown: 0, countries: 0 },
          byCountry: [],
          flowCountryEdges: [],
          unknownLocationSamples: [],
          unknownCountryCandidates: [],
          error: error.message,
        };
      }
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const uuid = typeof row.uuid === "string" ? row.uuid : null;
        const location = typeof row.location === "string" ? row.location : null;
        if (uuid) locationByLead.set(uuid, location);
      }
    }
  }

  const flowByLead = new Map<string, string>();
  const flowNameByUuid = new Map<string, string>();
  if (leadUuids.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leadUuids.length; i += chunkSize) {
      const chunk = leadUuids.slice(i, i + chunkSize);
      const { data, error } = await client
        .from(FLOW_LEADS_TABLE)
        .select("lead_uuid, flow_uuid, created_at")
        .eq("project_id", projectId)
        .in("lead_uuid", chunk)
        .order("created_at", { ascending: false });
      if (error) {
        return {
          totals: { conversationsScanned: 0, conversationsMapped: 0, conversationsUnknown: 0, countries: 0 },
          byCountry: [],
          flowCountryEdges: [],
          unknownLocationSamples: [],
          unknownCountryCandidates: [],
          error: error.message,
        };
      }
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const leadUuid = typeof row.lead_uuid === "string" ? row.lead_uuid : null;
        const flowUuid = typeof row.flow_uuid === "string" ? row.flow_uuid : null;
        if (leadUuid && flowUuid && !flowByLead.has(leadUuid)) {
          flowByLead.set(leadUuid, flowUuid);
        }
      }
    }

    const flowUuids = [...new Set([...flowByLead.values()])];
    if (flowUuids.length > 0) {
      const { data, error } = await client
        .from(FLOWS_TABLE)
        .select("uuid, name")
        .eq("project_id", projectId)
        .in("uuid", flowUuids);
      if (!error) {
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          const uuid = typeof row.uuid === "string" ? row.uuid : null;
          const name = typeof row.name === "string" ? row.name : null;
          if (uuid) flowNameByUuid.set(uuid, name ?? uuid.slice(0, 8));
        }
      }
    }
  }

  interface Bucket {
    country: string;
    iso2: string | null;
    conversations: number;
    contactsSet: Set<string>;
    messagesIn: number;
    messagesOut: number;
    positiveReplies: number;
    noResponse: number;
    waiting: number;
    lastMessageAt: string | null;
  }
  const byCountry = new Map<string, Bucket>();
  const edgeKey = (f: string, c: string, r: ConversationReplyTag) => `${f}|${c}|${r}`;
  const edgeMap = new Map<string, GeoFlowCountryReplyEdge>();
  const unknownSamples: string[] = [];
  const unknownCandidateCounts = new Map<string, number>();
  let conversationsMapped = 0;

  for (const conv of conversations) {
    const lead = conv.leadUuid;
    const flowUuid = lead ? flowByLead.get(lead) ?? null : null;
    if (flowFilterSet && (!flowUuid || !flowFilterSet.has(flowUuid))) {
      continue;
    }
    const rawLocation = lead ? locationByLead.get(lead) ?? null : null;
    const locationMissing = typeof rawLocation !== "string" || rawLocation.trim() === "";
    const country = locationMissing ? null : extractCountryFromLocation(rawLocation);
    if (!country && !locationMissing && rawLocation && unknownSamples.length < 20 && !unknownSamples.includes(rawLocation)) {
      unknownSamples.push(rawLocation);
    }
    if (!country && !locationMissing) {
      const token = extractUnknownCountryCandidate(rawLocation);
      if (token) {
        unknownCandidateCounts.set(token, (unknownCandidateCounts.get(token) ?? 0) + 1);
      }
    }
    const key = country
      ? country.name
      : locationMissing
        ? NOT_SET_COUNTRY_BUCKET
        : UNKNOWN_COUNTRY_BUCKET;
    const iso2 = country ? country.iso2 : null;

    let bucket = byCountry.get(key);
    if (!bucket) {
      bucket = {
        country: key,
        iso2,
        conversations: 0,
        contactsSet: new Set<string>(),
        messagesIn: 0,
        messagesOut: 0,
        positiveReplies: 0,
        noResponse: 0,
        waiting: 0,
        lastMessageAt: null,
      };
      byCountry.set(key, bucket);
    }
    bucket.conversations += 1;
    if (lead) bucket.contactsSet.add(lead);
    bucket.messagesIn += conv.inboxCount;
    bucket.messagesOut += conv.outboxCount;
    if (conv.replyTag === "got_response") bucket.positiveReplies += 1;
    else if (conv.replyTag === "no_response") bucket.noResponse += 1;
    else if (conv.replyTag === "waiting_for_response") bucket.waiting += 1;
    if (conv.lastMessageAt) {
      if (!bucket.lastMessageAt || conv.lastMessageAt > bucket.lastMessageAt) {
        bucket.lastMessageAt = conv.lastMessageAt;
      }
    }
    if (country) conversationsMapped += 1;

    if (flowUuid) {
      const flowName = flowNameByUuid.get(flowUuid) ?? flowUuid.slice(0, 8);
      const k = edgeKey(flowUuid, key, conv.replyTag);
      const existing = edgeMap.get(k);
      if (existing) {
        existing.conversations += 1;
      } else {
        edgeMap.set(k, {
          flowUuid,
          flowName,
          country: key,
          replyTag: conv.replyTag,
          conversations: 1,
        });
      }
    }
  }

  const rows: GeoCountryRow[] = [];
  for (const b of byCountry.values()) {
    rows.push({
      country: b.country,
      iso2: b.iso2,
      conversations: b.conversations,
      contacts: b.contactsSet.size,
      messagesIn: b.messagesIn,
      messagesOut: b.messagesOut,
      positiveReplies: b.positiveReplies,
      noResponse: b.noResponse,
      waiting: b.waiting,
      lastMessageAt: b.lastMessageAt,
    });
  }
  rows.sort((a, b) => b.conversations - a.conversations);

  const knownCountryRows = rows.filter(
    (r) => r.country !== UNKNOWN_COUNTRY_BUCKET && r.country !== NOT_SET_COUNTRY_BUCKET
  );
  const unknownCountryCandidates = [...unknownCandidateCounts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 20);

  return {
    totals: {
      conversationsScanned: conversations.length,
      conversationsMapped,
      conversationsUnknown: conversations.length - conversationsMapped,
      countries: knownCountryRows.length,
    },
    byCountry: rows,
    flowCountryEdges: [...edgeMap.values()],
    unknownLocationSamples: unknownSamples,
    unknownCountryCandidates,
    error: null,
  };
}

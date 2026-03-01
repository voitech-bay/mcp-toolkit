/**
 * Ocean.io Lookalike companies search API client (v3).
 * @see https://docs.ocean.io/search/searchCompaniesV3
 */

const OCEAN_BASE = "https://api.ocean.io/v3";
const OCEAN_API_TOKEN = process.env.OCEAN_API_TOKEN;

// --- Shared filter types (from Ocean API) ---

export interface FromTo {
  from: number;
  to: number;
}

export interface IndustriesFilter {
  industries: string[];
  mode: "anyOf" | "allOf";
}

export interface IndustryCategoriesFilter {
  industryCategories: string[];
  mode: "anyOf" | "allOf";
}

export interface FundingRoundFilter {
  date?: { from: string; to: string };
  raised?: { from: number; to: number };
  types?: string[];
}

export interface LocationsFilter {
  countries?: string[];
  localities?: string[];
  regions?: string[];
  [key: string]: unknown;
}

export interface WebTrafficFilter {
  views?: FromTo;
  visits?: FromTo;
  pagesPerVisit?: FromTo;
  [key: string]: unknown;
}

export interface SocialMediasFilterV3 {
  medias?: {
    all_of?: string[];
    any_of?: string[];
    none_of?: string[];
  };
  min_count?: number;
  [key: string]: unknown;
}

export interface TechnologiesFilterV3 {
  apps?: {
    all_of?: string[];
    any_of?: string[];
    none_of?: string[];
  };
  categories?: {
    all_of?: string[];
    any_of?: string[];
    none_of?: string[];
  };
  [key: string]: unknown;
}

export interface AllAnyNoneFilter {
  all_of?: string[];
  any_of?: string[];
  none_of?: string[];
}

export interface HeadcountGrowthFilter {
  asPercentage?: boolean;
  growthRange: FromTo;
  months: "Three months" | "Six months" | "Twelve months";
}

export interface DepartmentSizeFilter {
  department: string;
  from: number;
  to: number;
}

export interface DepartmentGrowthAllAnyFilter {
  anyOf?: Array<{
    asPercentage?: boolean;
    department: string;
    growthRange: FromTo;
    months: "Three months" | "Six months" | "Twelve months";
  }>;
  allOf?: Array<{
    asPercentage?: boolean;
    department: string;
    growthRange: FromTo;
    months: "Three months" | "Six months" | "Twelve months";
  }>;
}

export type OceanRelevance = "A" | "B" | "C";

export type CompanySizeValue =
  | "1"
  | "2-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1001-5000"
  | "5001-10000"
  | "10001-50000"
  | "50001-100000"
  | "100001-500000"
  | "500001-1000000"
  | "1000001+";

export type RevenueValue =
  | "0-1M"
  | "1-10M"
  | "10-50M"
  | "50-100M"
  | "100-500M"
  | "500M-1B"
  | "1B-10B"
  | ">1000M";

export type CompanyField =
  | "domain"
  | "countries"
  | "primaryCountry"
  | "companySize"
  | "industryCategories"
  | "industries"
  | "linkedinIndustry"
  | "ecommerce"
  | "keywords"
  | "employeeCountOcean"
  | "employeeCountLinkedin"
  | "revenue"
  | "yearFounded"
  | "description"
  | "emails"
  | "phones"
  | "phones.number"
  | "phones.country"
  | "phones.primary"
  | "logo"
  | "technologies"
  | "technologyCategories"
  | "mobileApps"
  | "mobileApps.link"
  | "mobileApps.name"
  | "webTraffic"
  | "webTraffic.visits"
  | "webTraffic.pageViews"
  | "webTraffic.pagesPerVisit"
  | "medias"
  | "medias.linkedin"
  | "medias.twitter"
  | "medias.youtube"
  | "medias.facebook"
  | "medias.xing"
  | "medias.tiktok"
  | "medias.instagram"
  | "name"
  | "legalName"
  | "locations"
  | "locations.primary"
  | "locations.country"
  | "locations.locality"
  | "locations.region"
  | "locations.postalCode"
  | "locations.streetAddress"
  | "locations.state"
  | "locations.regionCode"
  | "departmentSizes"
  | "rootUrl"
  | "faxes"
  | "faxes.number"
  | "faxes.country"
  | "faxes.primary"
  | "impressum"
  | "impressum.company"
  | "impressum.address"
  | "impressum.email"
  | "impressum.phone"
  | "impressum.fax"
  | "impressum.vat"
  | "impressum.url"
  | "impressum.people"
  | "fundingRound"
  | "fundingRound.date"
  | "fundingRound.type"
  | "fundingRound.moneyRaisedInUsd"
  | "fundingRound.cbUrl"
  | "redirectedFrom"
  | "updatedAt"
  | "headcountGrowth"
  | "headcountGrowth.threeMonths"
  | "headcountGrowth.threeMonthsPercentage"
  | "headcountGrowth.sixMonths"
  | "headcountGrowth.sixMonthsPercentage"
  | "headcountGrowth.twelveMonths"
  | "headcountGrowth.twelveMonthsPercentage"
  | "headcountGrowthPerDepartment";

/** Companies filters (CompaniesFiltersV3). All fields optional except lookalikeDomains when doing lookalike search. */
export interface OceanCompaniesFilters {
  lookalikeDomains?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
  companySizes?: CompanySizeValue[] | string[];
  ecommerce?: boolean;
  yearFounded?: FromTo;
  countriesCount?: FromTo;
  revenues?: RevenueValue[] | string[];
  employeeCountOcean?: FromTo;
  mobileApps?: FromTo;
  locationsCount?: FromTo;
  departmentSizes?: DepartmentSizeFilter[];
  employeeCountLinkedin?: FromTo;
  industries?: IndustriesFilter;
  excludeIndustries?: string[];
  industryCategories?: IndustryCategoriesFilter;
  excludeIndustryCategories?: string[];
  linkedinIndustries?: string[];
  excludeLinkedinIndustries?: string[];
  fundingRound?: FundingRoundFilter;
  primaryLocations?: LocationsFilter;
  otherLocations?: LocationsFilter;
  webTraffic?: WebTrafficFilter;
  socialMedias?: SocialMediasFilterV3;
  technologies?: TechnologiesFilterV3;
  keywords?: AllAnyNoneFilter;
  minRelevance?: OceanRelevance;
  maxRelevance?: OceanRelevance;
  headcountGrowth?: HeadcountGrowthFilter;
  departmentHeadcountGrowth?: DepartmentGrowthAllAnyFilter;
  updatedWithinMonths?: number;
  companyMatchingMode?: "precise" | "broad";
  /** Legacy: min similarity score 0-1 if supported by API */
  minScore?: number;
  [key: string]: unknown;
}

/** People filters (PeopleFiltersV3). Results show companies that have at least one person matching. */
export interface OceanPeopleFiltersV3 {
  [key: string]: unknown;
}

export interface OceanSearchLookalikeParams {
  /** 1–10 domains to find lookalikes for (maps to lookalikeDomains). */
  domains: string[];
  /** Minimum similarity score 0–1, if supported. */
  minScore?: number;
  /** Number of companies to return (1–10000). Default 50. */
  size?: number;
  /** Cursor for next page from previous response. */
  searchAfter?: string;
  /** Controls lookalike strictness: "precise" (default) or "broad". */
  companyMatchingMode?: "precise" | "broad";
  /** Fields to return; reduces bandwidth if specified. */
  fields?: CompanyField[];
  /** People filters: companies with at least one person matching. */
  peopleFilters?: OceanPeopleFiltersV3;
  /** Rest of companies filters; merged with lookalikeDomains (and minScore if set). */
  companiesFilters?: Omit<OceanCompaniesFilters, "lookalikeDomains" | "minScore">;
}

export interface OceanCompany {
  domain?: string;
  name?: string;
  legalName?: string;
  description?: string;
  countries?: string[];
  primaryCountry?: string;
  companySize?: string;
  industries?: string[];
  employeeCountOcean?: number;
  employeeCountLinkedin?: number;
  revenue?: string;
  yearFounded?: number;
  logo?: string;
  locations?: unknown[];
  medias?: Record<string, { url?: string; name?: string }>;
  [key: string]: unknown;
}

export interface OceanCompanyHit {
  company: OceanCompany;
  relevance?: string;
}

export interface OceanSearchLookalikeResult {
  companies: OceanCompanyHit[];
  total: number;
  searchAfter?: string;
  detail?: string;
  error?: string;
}

function buildBody(params: OceanSearchLookalikeParams): Record<string, unknown> {
  const companiesFilters: OceanCompaniesFilters = {
    lookalikeDomains: params.domains.slice(0, 10),
    ...params.companiesFilters,
  };
  if (params.minScore != null) {
    companiesFilters.minScore = Math.min(1, Math.max(0, params.minScore));
  }
  if (params.companyMatchingMode != null) {
    companiesFilters.companyMatchingMode = params.companyMatchingMode;
  }

  const body: Record<string, unknown> = {
    companiesFilters,
  };
  if (params.size != null) {
    body.size = Math.min(10000, Math.max(1, params.size));
  }
  if (params.searchAfter != null && params.searchAfter !== "") {
    body.searchAfter = params.searchAfter;
  }
  if (params.peopleFilters != null && Object.keys(params.peopleFilters).length > 0) {
    body.peopleFilters = params.peopleFilters;
  }
  if (params.fields != null && params.fields.length > 0) {
    body.fields = params.fields;
  }
  return body;
}

export async function searchLookalikeCompanies(
  params: OceanSearchLookalikeParams
): Promise<OceanSearchLookalikeResult> {
  if (!OCEAN_API_TOKEN) {
    return {
      companies: [],
      total: 0,
      error:
        "Missing OCEAN_API_TOKEN. Set it in .env (see .env.example) to use Ocean.io lookalike search.",
    };
  }

  if (!params.domains?.length) {
    return {
      companies: [],
      total: 0,
      error: "At least one domain is required for lookalike search.",
    };
  }

  const url = `${OCEAN_BASE}/search/companies`;
  const body = buildBody(params);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": OCEAN_API_TOKEN,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ocean API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as OceanSearchLookalikeResult;
  return data;
}

/**
 * Apollo Organization Search API client.
 * POST https://api.apollo.io/api/v1/mixed_companies/search
 * @see https://docs.apollo.io/reference/organization-search
 */

const APOLLO_BASE = "https://api.apollo.io/api/v1";
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

export interface ApolloSearchCompaniesParams {
  /** Company name or partial name (e.g. apollo, mining). Partial matches accepted. */
  q_organization_name?: string;
  /** Filter by company domains; up to 1,000. Do not include www. or @. */
  q_organization_domains_list?: string[];
  /** Employee count ranges; each string is "min,max" (e.g. "1,10", "250,500"). */
  organization_num_employees_ranges?: string[];
  /** HQ locations: cities, US states, countries (e.g. texas, tokyo, spain). */
  organization_locations?: string[];
  /** Exclude companies by HQ location (e.g. minnesota, ireland, seoul). */
  organization_not_locations?: string[];
  /** Revenue range: min value (no currency symbols or commas). */
  revenue_range_min?: number;
  /** Revenue range: max value (no currency symbols or commas). */
  revenue_range_max?: number;
  /** Technologies the org currently uses; use underscores for spaces (see Apollo tech CSV). */
  currently_using_any_of_technology_uids?: string[];
  /** Keywords associated with companies (e.g. mining, sales strategy, consulting). */
  q_organization_keyword_tags?: string[];
  /** Apollo organization IDs to include (from prior search results). */
  organization_ids?: string[];
  /** Min amount of most recent funding round (no currency symbols or commas). */
  latest_funding_amount_range_min?: number;
  /** Max amount of most recent funding round. */
  latest_funding_amount_range_max?: number;
  /** Min total funding across all rounds. */
  total_funding_range_min?: number;
  /** Max total funding across all rounds. */
  total_funding_range_max?: number;
  /** Earliest date of most recent funding round (YYYY-MM-DD). */
  latest_funding_date_range_min?: string;
  /** Latest date of most recent funding round (YYYY-MM-DD). */
  latest_funding_date_range_max?: string;
  /** Job titles in active job postings at the company (e.g. sales manager, research analyst). */
  q_organization_job_titles?: string[];
  /** Locations of jobs being recruited (e.g. atlanta, japan). */
  organization_job_locations?: string[];
  /** Min number of active job postings at the company. */
  organization_num_jobs_range_min?: number;
  /** Max number of active job postings. */
  organization_num_jobs_range_max?: number;
  /** Earliest date jobs were posted (YYYY-MM-DD). */
  organization_job_posted_at_range_min?: string;
  /** Latest date jobs were posted (YYYY-MM-DD). */
  organization_job_posted_at_range_max?: string;
  /** Page number (use with per_page). Display limit 50,000 records (100 per page, up to 500 pages). */
  page?: number;
  /** Results per page (default 10; limit 100). */
  per_page?: number;
}

export interface ApolloOrganization {
  id: string;
  name: string;
  website_url: string | null;
  primary_domain: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;
  logo_url: string | null;
  founded_year: number | null;
  phone: string | null;
  [key: string]: unknown;
}

export interface ApolloPagination {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

export interface ApolloSearchCompaniesResult {
  organizations: ApolloOrganization[];
  pagination: ApolloPagination;
  breadcrumbs?: unknown[];
  error?: string;
}

function buildQueryString(params: ApolloSearchCompaniesParams): string {
  const searchParams = new URLSearchParams();

  if (params.q_organization_name != null && params.q_organization_name !== "") {
    searchParams.set("q_organization_name", params.q_organization_name);
  }
  if (params.q_organization_domains_list?.length) {
    params.q_organization_domains_list.forEach((d) =>
      searchParams.append("q_organization_domains_list[]", d)
    );
  }
  if (params.organization_num_employees_ranges?.length) {
    params.organization_num_employees_ranges.forEach((r) =>
      searchParams.append("organization_num_employees_ranges[]", r)
    );
  }
  if (params.organization_locations?.length) {
    params.organization_locations.forEach((loc) =>
      searchParams.append("organization_locations[]", loc)
    );
  }
  if (params.organization_not_locations?.length) {
    params.organization_not_locations.forEach((loc) =>
      searchParams.append("organization_not_locations[]", loc)
    );
  }
  if (params.revenue_range_min != null) {
    searchParams.set("revenue_range[min]", String(params.revenue_range_min));
  }
  if (params.revenue_range_max != null) {
    searchParams.set("revenue_range[max]", String(params.revenue_range_max));
  }
  if (params.currently_using_any_of_technology_uids?.length) {
    params.currently_using_any_of_technology_uids.forEach((uid) =>
      searchParams.append("currently_using_any_of_technology_uids[]", uid)
    );
  }
  if (params.q_organization_keyword_tags?.length) {
    params.q_organization_keyword_tags.forEach((tag) =>
      searchParams.append("q_organization_keyword_tags[]", tag)
    );
  }
  if (params.organization_ids?.length) {
    params.organization_ids.forEach((id) =>
      searchParams.append("organization_ids[]", id)
    );
  }
  if (params.latest_funding_amount_range_min != null) {
    searchParams.set("latest_funding_amount_range[min]", String(params.latest_funding_amount_range_min));
  }
  if (params.latest_funding_amount_range_max != null) {
    searchParams.set("latest_funding_amount_range[max]", String(params.latest_funding_amount_range_max));
  }
  if (params.total_funding_range_min != null) {
    searchParams.set("total_funding_range[min]", String(params.total_funding_range_min));
  }
  if (params.total_funding_range_max != null) {
    searchParams.set("total_funding_range[max]", String(params.total_funding_range_max));
  }
  if (params.latest_funding_date_range_min != null) {
    searchParams.set("latest_funding_date_range[min]", params.latest_funding_date_range_min);
  }
  if (params.latest_funding_date_range_max != null) {
    searchParams.set("latest_funding_date_range[max]", params.latest_funding_date_range_max);
  }
  if (params.q_organization_job_titles?.length) {
    params.q_organization_job_titles.forEach((t) =>
      searchParams.append("q_organization_job_titles[]", t)
    );
  }
  if (params.organization_job_locations?.length) {
    params.organization_job_locations.forEach((loc) =>
      searchParams.append("organization_job_locations[]", loc)
    );
  }
  if (params.organization_num_jobs_range_min != null) {
    searchParams.set("organization_num_jobs_range[min]", String(params.organization_num_jobs_range_min));
  }
  if (params.organization_num_jobs_range_max != null) {
    searchParams.set("organization_num_jobs_range[max]", String(params.organization_num_jobs_range_max));
  }
  if (params.organization_job_posted_at_range_min != null) {
    searchParams.set("organization_job_posted_at_range[min]", params.organization_job_posted_at_range_min);
  }
  if (params.organization_job_posted_at_range_max != null) {
    searchParams.set("organization_job_posted_at_range[max]", params.organization_job_posted_at_range_max);
  }
  if (params.page != null) {
    searchParams.set("page", String(params.page));
  }
  if (params.per_page != null) {
    searchParams.set("per_page", String(params.per_page));
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

export async function searchCompanies(
  params: ApolloSearchCompaniesParams
): Promise<ApolloSearchCompaniesResult> {
  if (!APOLLO_API_KEY) {
    return {
      organizations: [],
      pagination: { page: 1, per_page: 10, total_entries: 0, total_pages: 0 },
      error:
        "Missing APOLLO_API_KEY. Set it in .env (see .env.example) to use Apollo Organization Search.",
    };
  }

  const queryString = buildQueryString(params);
  const url = `${APOLLO_BASE}/mixed_companies/search${queryString}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": APOLLO_API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as ApolloSearchCompaniesResult;
  return data;
}

// --- People API Search (mixed_people/api_search) ---
// POST https://api.apollo.io/api/v1/mixed_people/api_search
// @see https://docs.apollo.io/reference/people-api-search

export interface ApolloSearchPeopleParams {
  /** Job titles (e.g. marketing manager, sales development representative). */
  person_titles?: string[];
  /** Include similar job titles (default true). Set false for strict title match. */
  include_similar_titles?: boolean;
  /** Keywords to filter results. */
  q_keywords?: string;
  /** Person location: cities, US states, countries (e.g. california, ireland, chicago). */
  person_locations?: string[];
  /** Seniority: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern. */
  person_seniorities?: string[];
  /** HQ location of person's current employer (e.g. texas, tokyo, spain). */
  organization_locations?: string[];
  /** Employer domains; up to 1,000. No www. or @. */
  q_organization_domains_list?: string[];
  /** Email status: verified, unverified, likely to engage, unavailable. */
  contact_email_status?: string[];
  /** Apollo organization IDs to include. */
  organization_ids?: string[];
  /** Employee count ranges; each "min,max" (e.g. "1,10", "250,500"). */
  organization_num_employees_ranges?: string[];
  /** Min revenue of person's current employer (no currency). */
  revenue_range_min?: number;
  /** Max revenue of person's current employer (no currency). */
  revenue_range_max?: number;
  /** Employer uses ALL of these technologies (underscores for spaces). */
  currently_using_all_of_technology_uids?: string[];
  /** Employer uses ANY of these technologies. */
  currently_using_any_of_technology_uids?: string[];
  /** Employer does NOT use any of these technologies. */
  currently_not_using_any_of_technology_uids?: string[];
  /** Job titles in active job postings at employer. */
  q_organization_job_titles?: string[];
  /** Locations of jobs being recruited (e.g. atlanta, japan). */
  organization_job_locations?: string[];
  /** Min number of active job postings at employer. */
  organization_num_jobs_range_min?: number;
  /** Max number of active job postings. */
  organization_num_jobs_range_max?: number;
  /** Earliest date jobs were posted (YYYY-MM-DD). */
  organization_job_posted_at_range_min?: string;
  /** Latest date jobs were posted (YYYY-MM-DD). */
  organization_job_posted_at_range_max?: string;
  /** Page number (up to 500 pages at 100 per page; display limit 50,000 records). */
  page?: number;
  /** Results per page (default 10, max 100). */
  per_page?: number;
}

export interface ApolloPersonOrganization {
  name: string;
  has_industry?: boolean;
  has_phone?: boolean;
  has_city?: boolean;
  has_state?: boolean;
  has_country?: boolean;
  has_zip_code?: boolean;
  has_revenue?: boolean;
  has_employee_count?: boolean;
}

export interface ApolloPerson {
  id: string;
  first_name: string;
  last_name_obfuscated: string;
  title: string | null;
  last_refreshed_at: string;
  has_email: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  has_direct_phone: string;
  organization: ApolloPersonOrganization;
  [key: string]: unknown;
}

export interface ApolloSearchPeopleResult {
  total_entries: number;
  people: ApolloPerson[];
  error?: string;
}

function buildPeopleQueryString(params: ApolloSearchPeopleParams): string {
  const searchParams = new URLSearchParams();

  if (params.person_titles?.length) {
    params.person_titles.forEach((t) => searchParams.append("person_titles[]", t));
  }
  if (params.include_similar_titles !== undefined) {
    searchParams.set("include_similar_titles", String(params.include_similar_titles));
  }
  if (params.q_keywords != null && params.q_keywords !== "") {
    searchParams.set("q_keywords", params.q_keywords);
  }
  if (params.person_locations?.length) {
    params.person_locations.forEach((loc) => searchParams.append("person_locations[]", loc));
  }
  if (params.person_seniorities?.length) {
    params.person_seniorities.forEach((s) => searchParams.append("person_seniorities[]", s));
  }
  if (params.organization_locations?.length) {
    params.organization_locations.forEach((loc) => searchParams.append("organization_locations[]", loc));
  }
  if (params.q_organization_domains_list?.length) {
    params.q_organization_domains_list.forEach((d) =>
      searchParams.append("q_organization_domains_list[]", d)
    );
  }
  if (params.contact_email_status?.length) {
    params.contact_email_status.forEach((s) => searchParams.append("contact_email_status[]", s));
  }
  if (params.organization_ids?.length) {
    params.organization_ids.forEach((id) => searchParams.append("organization_ids[]", id));
  }
  if (params.organization_num_employees_ranges?.length) {
    params.organization_num_employees_ranges.forEach((r) =>
      searchParams.append("organization_num_employees_ranges[]", r)
    );
  }
  if (params.revenue_range_min != null) {
    searchParams.set("revenue_range[min]", String(params.revenue_range_min));
  }
  if (params.revenue_range_max != null) {
    searchParams.set("revenue_range[max]", String(params.revenue_range_max));
  }
  if (params.currently_using_all_of_technology_uids?.length) {
    params.currently_using_all_of_technology_uids.forEach((uid) =>
      searchParams.append("currently_using_all_of_technology_uids[]", uid)
    );
  }
  if (params.currently_using_any_of_technology_uids?.length) {
    params.currently_using_any_of_technology_uids.forEach((uid) =>
      searchParams.append("currently_using_any_of_technology_uids[]", uid)
    );
  }
  if (params.currently_not_using_any_of_technology_uids?.length) {
    params.currently_not_using_any_of_technology_uids.forEach((uid) =>
      searchParams.append("currently_not_using_any_of_technology_uids[]", uid)
    );
  }
  if (params.q_organization_job_titles?.length) {
    params.q_organization_job_titles.forEach((t) =>
      searchParams.append("q_organization_job_titles[]", t)
    );
  }
  if (params.organization_job_locations?.length) {
    params.organization_job_locations.forEach((loc) =>
      searchParams.append("organization_job_locations[]", loc)
    );
  }
  if (params.organization_num_jobs_range_min != null) {
    searchParams.set("organization_num_jobs_range[min]", String(params.organization_num_jobs_range_min));
  }
  if (params.organization_num_jobs_range_max != null) {
    searchParams.set("organization_num_jobs_range[max]", String(params.organization_num_jobs_range_max));
  }
  if (params.organization_job_posted_at_range_min != null) {
    searchParams.set("organization_job_posted_at_range[min]", params.organization_job_posted_at_range_min);
  }
  if (params.organization_job_posted_at_range_max != null) {
    searchParams.set("organization_job_posted_at_range[max]", params.organization_job_posted_at_range_max);
  }
  if (params.page != null) {
    searchParams.set("page", String(params.page));
  }
  if (params.per_page != null) {
    searchParams.set("per_page", String(params.per_page));
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

export async function searchPeople(
  params: ApolloSearchPeopleParams
): Promise<ApolloSearchPeopleResult> {
  if (!APOLLO_API_KEY) {
    return {
      total_entries: 0,
      people: [],
      error:
        "Missing APOLLO_API_KEY. Set it in .env (see .env.example) to use Apollo People API Search.",
    };
  }

  const queryString = buildPeopleQueryString(params);
  const url = `${APOLLO_BASE}/mixed_people/api_search${queryString}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": APOLLO_API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as ApolloSearchPeopleResult;
  return data;
}

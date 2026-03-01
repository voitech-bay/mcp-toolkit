import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchCompanies, searchPeople } from "../services/apollo.js";
import type { OceanCompaniesFilters } from "../services/ocean.js";
import { searchLookalikeCompanies } from "../services/ocean.js";

const personSenioritiesSchema = z.array(
  z.enum(["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"])
);
const contactEmailStatusSchema = z.array(
  z.enum(["verified", "unverified", "likely to engage", "unavailable"])
);

const relevanceSchema = z.enum(["A", "B", "C"]);
const companyMatchingModeSchema = z.enum(["precise", "broad"]);

export function registerCompanyEnrichmentTools(server: McpServer): void {
  server.tool(
    "search_companies",
    "Search for companies using Apollo (mixed_companies/search). Supports name, domains, locations, employee/revenue/funding ranges, technologies, keyword tags, job postings filters, and pagination. Display limit 50,000 records (100 per page, up to 500 pages).",
    {
      query: z.string().optional().describe("Company name or partial name (e.g. apollo, mining). Partial matches accepted."),
      domains: z.array(z.string()).optional().describe("Filter by company domains; up to 1000 (e.g. apollo.io, microsoft.com). Do not include www. or @."),
      locations: z.array(z.string()).optional().describe("Company HQ locations: cities, states, countries (e.g. texas, tokyo, spain)"),
      notLocations: z.array(z.string()).optional().describe("Exclude companies by HQ location (e.g. minnesota, ireland, seoul)"),
      employeeRange: z.string().optional().describe("Employee count range as 'min,max' (e.g. 1,10 or 250,1000). Add multiple by passing multiple ranges."),
      employeeRanges: z.array(z.string()).optional().describe("Multiple employee ranges; each 'min,max' (e.g. ['1,10','250,500'])"),
      revenueMin: z.number().optional().describe("Revenue range minimum (integer, no currency symbols or commas)"),
      revenueMax: z.number().optional().describe("Revenue range maximum (integer, no currency symbols or commas)"),
      technologyUids: z.array(z.string()).optional().describe("Technologies the org uses; use underscores for spaces (see Apollo tech CSV). e.g. salesforce, google_analytics"),
      keywordTags: z.array(z.string()).optional().describe("Keywords associated with companies (e.g. mining, sales strategy, consulting)"),
      organizationIds: z.array(z.string()).optional().describe("Apollo organization IDs to include (from prior search)"),
      latestFundingAmountMin: z.number().optional().describe("Min amount of most recent funding round (integer, no currency)"),
      latestFundingAmountMax: z.number().optional().describe("Max amount of most recent funding round"),
      totalFundingMin: z.number().optional().describe("Min total funding across all rounds"),
      totalFundingMax: z.number().optional().describe("Max total funding across all rounds"),
      latestFundingDateMin: z.string().optional().describe("Earliest date of most recent funding (YYYY-MM-DD)"),
      latestFundingDateMax: z.string().optional().describe("Latest date of most recent funding (YYYY-MM-DD)"),
      jobTitles: z.array(z.string()).optional().describe("Job titles in active job postings (e.g. sales manager, research analyst)"),
      jobLocations: z.array(z.string()).optional().describe("Locations of jobs being recruited (e.g. atlanta, japan)"),
      numJobsMin: z.number().optional().describe("Min number of active job postings at the company"),
      numJobsMax: z.number().optional().describe("Max number of active job postings"),
      jobPostedAtMin: z.string().optional().describe("Earliest date jobs were posted (YYYY-MM-DD)"),
      jobPostedAtMax: z.string().optional().describe("Latest date jobs were posted (YYYY-MM-DD)"),
      page: z.number().optional().describe("Page number (use with perPage). Up to 500 pages at 100 per page."),
      perPage: z.number().optional().describe("Results per page (default 10, max 100)"),
    },
    async (args) => {
      try {
        const employeeRanges = [
          ...(args.employeeRange ? [args.employeeRange] : []),
          ...(args.employeeRanges ?? []),
        ];
        const params = {
          q_organization_name: args.query,
          q_organization_domains_list: args.domains,
          organization_locations: args.locations,
          organization_not_locations: args.notLocations,
          organization_num_employees_ranges: employeeRanges.length ? employeeRanges : undefined,
          revenue_range_min: args.revenueMin,
          revenue_range_max: args.revenueMax,
          currently_using_any_of_technology_uids: args.technologyUids,
          q_organization_keyword_tags: args.keywordTags,
          organization_ids: args.organizationIds,
          latest_funding_amount_range_min: args.latestFundingAmountMin,
          latest_funding_amount_range_max: args.latestFundingAmountMax,
          total_funding_range_min: args.totalFundingMin,
          total_funding_range_max: args.totalFundingMax,
          latest_funding_date_range_min: args.latestFundingDateMin,
          latest_funding_date_range_max: args.latestFundingDateMax,
          q_organization_job_titles: args.jobTitles,
          organization_job_locations: args.jobLocations,
          organization_num_jobs_range_min: args.numJobsMin,
          organization_num_jobs_range_max: args.numJobsMax,
          organization_job_posted_at_range_min: args.jobPostedAtMin,
          organization_job_posted_at_range_max: args.jobPostedAtMax,
          page: args.page,
          per_page: args.perPage ?? 10,
        };
        const result = await searchCompanies(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "search_people",
    "Search for people using Apollo People API (mixed_people/api_search). Find net new people by job titles, seniority, person/org locations, employer domains, technologies, job postings, etc. Does not return email or phone; use People Enrichment for that. Display limit 50,000 records (100 per page, up to 500 pages). Requires master API key.",
    {
      personTitles: z.array(z.string()).optional().describe("Job titles (e.g. marketing manager, sales development representative). Match 1 of many; include_similar_titles controls fuzzy match."),
      includeSimilarTitles: z.boolean().optional().describe("Include similar job titles (default true). Set false for strict title match."),
      qKeywords: z.string().optional().describe("Keywords to filter results."),
      personLocations: z.array(z.string()).optional().describe("Where the person lives: cities, states, countries (e.g. california, ireland, chicago)."),
      personSeniorities: personSenioritiesSchema.optional().describe("Seniority: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern."),
      organizationLocations: z.array(z.string()).optional().describe("HQ location of person's current employer (e.g. texas, tokyo, spain)."),
      organizationDomains: z.array(z.string()).optional().describe("Employer domains; up to 1,000 (e.g. apollo.io, microsoft.com). No www. or @."),
      contactEmailStatus: contactEmailStatusSchema.optional().describe("Email status: verified, unverified, likely to engage, unavailable."),
      organizationIds: z.array(z.string()).optional().describe("Apollo organization IDs to include (from Organization Search)."),
      organizationNumEmployeesRanges: z.array(z.string()).optional().describe("Employee count ranges; each 'min,max' (e.g. '1,10', '250,500')."),
      revenueMin: z.number().optional().describe("Min revenue of person's current employer (integer, no currency)."),
      revenueMax: z.number().optional().describe("Max revenue of person's current employer (integer, no currency)."),
      technologyAll: z.array(z.string()).optional().describe("Employer uses ALL of these technologies (underscores for spaces)."),
      technologyAny: z.array(z.string()).optional().describe("Employer uses ANY of these technologies."),
      technologyNone: z.array(z.string()).optional().describe("Employer does NOT use any of these technologies."),
      organizationJobTitles: z.array(z.string()).optional().describe("Job titles in active job postings at employer (e.g. sales manager)."),
      organizationJobLocations: z.array(z.string()).optional().describe("Locations of jobs being recruited (e.g. atlanta, japan)."),
      numJobsMin: z.number().optional().describe("Min number of active job postings at employer."),
      numJobsMax: z.number().optional().describe("Max number of active job postings at employer."),
      jobPostedAtMin: z.string().optional().describe("Earliest date jobs were posted (YYYY-MM-DD)."),
      jobPostedAtMax: z.string().optional().describe("Latest date jobs were posted (YYYY-MM-DD)."),
      page: z.number().optional().describe("Page number (up to 500 pages at 100 per page)."),
      perPage: z.number().optional().describe("Results per page (default 10, max 100)."),
    },
    async (args) => {
      try {
        const params = {
          person_titles: args.personTitles,
          include_similar_titles: args.includeSimilarTitles,
          q_keywords: args.qKeywords,
          person_locations: args.personLocations,
          person_seniorities: args.personSeniorities,
          organization_locations: args.organizationLocations,
          q_organization_domains_list: args.organizationDomains,
          contact_email_status: args.contactEmailStatus,
          organization_ids: args.organizationIds,
          organization_num_employees_ranges: args.organizationNumEmployeesRanges,
          revenue_range_min: args.revenueMin,
          revenue_range_max: args.revenueMax,
          currently_using_all_of_technology_uids: args.technologyAll,
          currently_using_any_of_technology_uids: args.technologyAny,
          currently_not_using_any_of_technology_uids: args.technologyNone,
          q_organization_job_titles: args.organizationJobTitles,
          organization_job_locations: args.organizationJobLocations,
          organization_num_jobs_range_min: args.numJobsMin,
          organization_num_jobs_range_max: args.numJobsMax,
          organization_job_posted_at_range_min: args.jobPostedAtMin,
          organization_job_posted_at_range_max: args.jobPostedAtMax,
          page: args.page,
          per_page: args.perPage ?? 10,
        };
        const result = await searchPeople(params);
        const perPage = args.perPage ?? 10;
        const totalPages = result.total_entries > 0 ? Math.ceil(result.total_entries / perPage) : 0;
        const pagination = {
          page: args.page ?? 1,
          per_page: perPage,
          total_entries: result.total_entries,
          total_pages: totalPages,
        };
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...result, pagination }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "search_lookalike_companies",
    "Find companies similar to given company domains using Ocean.io. Supports size, searchAfter, companyMatchingMode, and many company filters (include/exclude domains, company size, revenue, industries, relevance, etc.). Use companiesFiltersJson for advanced filters.",
    {
      domains: z.array(z.string()).min(1).max(10).describe("1–10 company domains to find lookalikes for (e.g. stripe.com, notion.so)"),
      minScore: z.number().min(0).max(1).optional().describe("Minimum similarity score 0–1 (if supported by API)"),
      size: z.number().min(1).max(10000).optional().describe("Number of companies to return (default 50, max 10000)"),
      searchAfter: z.string().optional().describe("Cursor from previous response to get next page"),
      companyMatchingMode: companyMatchingModeSchema.optional().describe("precise (default) or broad lookalike matching"),
      includeDomains: z.array(z.string()).optional().describe("Only return these domains"),
      excludeDomains: z.array(z.string()).optional().describe("Exclude these domains"),
      companySizes: z.array(z.string()).optional().describe("Company size ranges e.g. ['2-10','51-200','100001-500000']"),
      ecommerce: z.boolean().optional().describe("true = only e-commerce, false = exclude e-commerce"),
      yearFoundedFrom: z.number().min(0).max(2100).optional().describe("Year founded from"),
      yearFoundedTo: z.number().min(0).max(2100).optional().describe("Year founded to"),
      revenues: z.array(z.string()).optional().describe("Revenue ranges e.g. ['0-1M','1-10M','>1000M']"),
      employeeCountLinkedinFrom: z.number().min(0).max(10000000).optional().describe("Min LinkedIn employee count"),
      employeeCountLinkedinTo: z.number().min(0).max(10000000).optional().describe("Max LinkedIn employee count"),
      industries: z.array(z.string()).optional().describe("Industry names (anyOf mode)"),
      industriesMode: z.enum(["anyOf", "allOf"]).optional().describe("How to combine industries (default anyOf)"),
      excludeIndustries: z.array(z.string()).optional().describe("Industries to exclude"),
      minRelevance: relevanceSchema.optional().describe("Min relevance A|B|C (A most relevant)"),
      maxRelevance: relevanceSchema.optional().describe("Max relevance A|B|C"),
      updatedWithinMonths: z.number().min(1).max(60).optional().describe("Companies updated in last N months"),
      fields: z.array(z.string()).optional().describe("Company fields to return (reduces bandwidth)"),
      companiesFiltersJson: z.string().optional().describe("JSON object for full companiesFilters (advanced): includeDomains, excludeDomains, primaryLocations, fundingRound, technologies, keywords, etc."),
    },
    async (args) => {
      try {
        let companiesFilters: OceanCompaniesFilters | undefined;
        if (args.includeDomains?.length || args.excludeDomains?.length || args.companySizes?.length ||
            args.ecommerce !== undefined || args.yearFoundedFrom !== undefined || args.yearFoundedTo !== undefined ||
            args.revenues?.length || args.employeeCountLinkedinFrom !== undefined || args.employeeCountLinkedinTo !== undefined ||
            args.industries?.length || args.excludeIndustries?.length || args.minRelevance || args.maxRelevance ||
            args.updatedWithinMonths !== undefined) {
          companiesFilters = {};
          if (args.includeDomains?.length) companiesFilters.includeDomains = args.includeDomains;
          if (args.excludeDomains?.length) companiesFilters.excludeDomains = args.excludeDomains;
          if (args.companySizes?.length) companiesFilters.companySizes = args.companySizes;
          if (args.ecommerce !== undefined) companiesFilters.ecommerce = args.ecommerce;
          if (args.yearFoundedFrom != null || args.yearFoundedTo != null) {
            companiesFilters.yearFounded = {
              from: args.yearFoundedFrom ?? 0,
              to: args.yearFoundedTo ?? 2100,
            };
          }
          if (args.revenues?.length) companiesFilters.revenues = args.revenues;
          if (args.employeeCountLinkedinFrom != null || args.employeeCountLinkedinTo != null) {
            companiesFilters.employeeCountLinkedin = {
              from: args.employeeCountLinkedinFrom ?? 0,
              to: args.employeeCountLinkedinTo ?? 10000000,
            };
          }
          if (args.industries?.length) {
            companiesFilters.industries = {
              industries: args.industries,
              mode: args.industriesMode ?? "anyOf",
            };
          }
          if (args.excludeIndustries?.length) companiesFilters.excludeIndustries = args.excludeIndustries;
          if (args.minRelevance) companiesFilters.minRelevance = args.minRelevance;
          if (args.maxRelevance) companiesFilters.maxRelevance = args.maxRelevance;
          if (args.updatedWithinMonths != null) companiesFilters.updatedWithinMonths = args.updatedWithinMonths;
        }
        if (args.companiesFiltersJson) {
          const parsed = JSON.parse(args.companiesFiltersJson) as Record<string, unknown>;
          companiesFilters = { ...companiesFilters, ...parsed };
        }
        const result = await searchLookalikeCompanies({
          domains: args.domains,
          minScore: args.minScore,
          size: args.size ?? 50,
          searchAfter: args.searchAfter,
          companyMatchingMode: args.companyMatchingMode,
          companiesFilters,
          fields: args.fields as import("../services/ocean.js").CompanyField[] | undefined,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );
}

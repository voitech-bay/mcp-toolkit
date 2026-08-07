/**
 * Bridge wellore_companies / wellore_contacts (n8n WLR research) into the canonical
 * companies / Contacts tables so Email Studio and Sequence Studio can read them.
 *
 * Deterministic ids (md5('wellore:company:'||id)::uuid, md5('wellore:contact:'||id)::uuid)
 * make this idempotent: re-running upserts the same rows instead of duplicating them.
 *
 * Scope: only the wellore_contacts rows that have a linkedin_url (247 of 790) — the rest
 * have no outreach channel and would be dead rows in the contact picker.
 *
 * Usage: tsx src/scripts/bridge-wellore-to-canonical.ts --apply
 * (omit --apply for a dry run that only prints counts)
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { getSupabase } from "../services/supabase.js";

const WELLORE_PROJECT_ID = process.env.WELLORE_PROJECT_ID?.trim() || "0038d0db-aab2-40f1-9f6e-38d38e157f8f";
const apply = process.argv.includes("--apply");

type Json = Record<string, unknown>;

function deterministicUuid(prefix: string, id: number | string): string {
  const hex = createHash("md5").update(`${prefix}${id}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const companyUuid = (id: number | string) => deterministicUuid("wellore:company:", id);
const contactUuid = (id: number | string) => deterministicUuid("wellore:contact:", id);

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured");

  const project = await client.from("Projects").select("id,name").eq("id", WELLORE_PROJECT_ID).single();
  if (project.error || project.data?.name !== "Wellore") throw new Error("Wellore project validation failed");

  const contactsRes = await client
    .from("wellore_contacts")
    .select("id,company_id,name,title,linkedin_url,email")
    .not("linkedin_url", "is", null)
    .neq("linkedin_url", "");
  if (contactsRes.error) throw new Error(contactsRes.error.message);
  const contacts = (contactsRes.data ?? []) as Json[];

  // Only the companies actually referenced by the bridged contacts, fetched by id
  // (never the full 2784-row wellore_companies table, which exceeds the default page size).
  const usedCompanyIds = [...new Set(contacts.map((c) => Number(c.company_id)))];
  const companiesRes = await client
    .from("wellore_companies")
    .select("id,name,domain,website,linkedin_company_url,employee_count,hq_country")
    .in("id", usedCompanyIds);
  if (companiesRes.error) throw new Error(companiesRes.error.message);
  const companies = (companiesRes.data ?? []) as Json[];
  const companyById = new Map<number, Json>(companies.map((c) => [Number(c.id), c]));

  const companyRows = usedCompanyIds
    .map((id) => companyById.get(id))
    .filter((c): c is Json => !!c)
    .map((c) => {
      const hqCountry = c.hq_country ? String(c.hq_country) : null;
      return {
        id: companyUuid(Number(c.id)),
        name: c.name ?? null,
        domain: c.domain ?? null,
        website: c.website ?? null,
        linkedin: c.linkedin_company_url ?? null,
        employees_on_linkedin: c.employee_count != null ? Number(c.employee_count) : null,
        hq_location: hqCountry ? { country: hqCountry } : null,
      };
    });

  const contactRows = contacts.map((c) => {
    const fullName = String(c.name ?? "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const company = companyById.get(Number(c.company_id));
    return {
      uuid: contactUuid(Number(c.id)),
      project_id: WELLORE_PROJECT_ID,
      name: fullName || null,
      first_name: parts[0] ?? null,
      last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
      title: c.title ?? null,
      linkedin_url: c.linkedin_url ?? null,
      company_uuid: companyUuid(Number(c.company_id)),
      company_name: company?.name ?? null,
      work_email: c.email ? String(c.email).toLowerCase() : null,
    };
  });

  const projectCompanyRows = companyRows.map((c) => ({ project_id: WELLORE_PROJECT_ID, company_id: c.id }));

  const summary = {
    mode: apply ? "apply" : "dry-run",
    companiesConsidered: companies.length,
    contactsWithLinkedin: contacts.length,
    companyRowsToUpsert: companyRows.length,
    projectCompanyRowsToUpsert: projectCompanyRows.length,
    contactRowsToUpsert: contactRows.length,
    contactsWithEmail: contactRows.filter((r) => r.work_email).length,
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const companiesUpsert = await client.from("companies").upsert(companyRows, { onConflict: "id" });
  if (companiesUpsert.error) throw new Error(companiesUpsert.error.message);

  const projectCompaniesUpsert = await client
    .from("project_companies")
    .upsert(projectCompanyRows, { onConflict: "project_id,company_id", ignoreDuplicates: true });
  if (projectCompaniesUpsert.error) throw new Error(projectCompaniesUpsert.error.message);

  const contactsUpsert = await client.from("Contacts").upsert(contactRows, { onConflict: "uuid" });
  if (contactsUpsert.error) throw new Error(contactsUpsert.error.message);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

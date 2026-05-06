import test from "node:test";
import assert from "node:assert/strict";
import { hydrateContactsGsByListData } from "./api-handlers.js";

const credentials = { baseUrl: "https://example.test", apiKey: "k" };

test("hydrateContactsGsByListData: no missing companies skips hydration fetch", async () => {
  let hydrateCalls = 0;
  let upsertCalls = 0;
  const result = await hydrateContactsGsByListData(
    "list-1",
    credentials,
    async () => ({
      map: new Map([
        [
          "co-1",
          { name: "ACME", company_description: "desc", company_employees: "11-50", domain: "acme.test" },
        ],
      ]),
      error: null,
    }),
    {
      fetchContactsByListUuidFn: async () => ({
        rows: [{ uuid: "lead-1", company_uuid: "co-1", linkedin: "https://linkedin.test/1" }],
        total: 1,
        error: null,
      }),
      fetchCompaniesByIdsBatchedFn: async () => {
        hydrateCalls += 1;
        return { rows: [], missing: [], errors: [] };
      },
      upsertCompaniesMappedFn: async () => {
        upsertCalls += 1;
        return { upserted: 0, error: null };
      },
    }
  );
  assert.equal(result.status, 200);
  assert.equal(hydrateCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.deepEqual(result.body.meta, {
    companiesHydrated: 0,
    companiesMissing: 0,
    companiesErrors: 0,
  });
});

test("hydrateContactsGsByListData: partial miss hydrates and enriches response", async () => {
  let loadIndex = 0;
  let hydrateCalls = 0;
  let upsertRows = 0;
  const result = await hydrateContactsGsByListData(
    "list-1",
    credentials,
    async () => {
      loadIndex += 1;
      if (loadIndex === 1) {
        return {
          map: new Map([
            [
              "co-1",
              { name: "Known Co", company_description: "known", company_employees: "1-10", domain: "known.test" },
            ],
          ]),
          error: null,
        };
      }
      return {
        map: new Map([
          [
            "co-1",
            { name: "Known Co", company_description: "known", company_employees: "1-10", domain: "known.test" },
          ],
          [
            "co-2",
            { name: "Hydrated Co", company_description: "new", company_employees: "51-200", domain: "new.test" },
          ],
        ]),
        error: null,
      };
    },
    {
      fetchContactsByListUuidFn: async () => ({
        rows: [
          { uuid: "lead-1", company_uuid: "co-1", company_name: "Old Name" },
          { uuid: "lead-2", company_uuid: "co-2", company_name: "Old Name" },
        ],
        total: 2,
        error: null,
      }),
      fetchCompaniesByIdsBatchedFn: async () => {
        hydrateCalls += 1;
        return {
          rows: [{ uuid: "co-2", name: "Hydrated Co", about: "new", employees_range: "51-200", domain: "new.test" }],
          missing: [],
          errors: [],
        };
      },
      upsertCompaniesMappedFn: async (rows) => {
        upsertRows += rows.length;
        return { upserted: rows.length, error: null };
      },
    }
  );
  assert.equal(result.status, 200);
  assert.equal(hydrateCalls, 1);
  assert.equal(upsertRows, 1);
  assert.deepEqual(result.body.meta, {
    companiesHydrated: 1,
    companiesMissing: 0,
    companiesErrors: 0,
  });
  const data = result.body.data as Array<Record<string, unknown>>;
  assert.equal(data[1].company_name, "Hydrated Co");
  assert.equal(data[1].domain, "new.test");
});

test("hydrateContactsGsByListData: partial failure returns best-effort payload", async () => {
  let loadIndex = 0;
  const result = await hydrateContactsGsByListData(
    "list-1",
    credentials,
    async () => {
      loadIndex += 1;
      if (loadIndex === 1) return { map: new Map(), error: null };
      return {
        map: new Map([
          [
            "co-2",
            { name: "Recovered Co", company_description: "ok", company_employees: "11-50", domain: "ok.test" },
          ],
        ]),
        error: null,
      };
    },
    {
      fetchContactsByListUuidFn: async () => ({
        rows: [
          { uuid: "lead-1", company_uuid: "co-2" },
          { uuid: "lead-2", company_uuid: "co-3" },
        ],
        total: 2,
        error: null,
      }),
      fetchCompaniesByIdsBatchedFn: async () => ({
        rows: [{ uuid: "co-2", name: "Recovered Co", domain: "ok.test" }],
        missing: ["co-3"],
        errors: [{ companyId: "co-3", error: "not found" }],
      }),
      upsertCompaniesMappedFn: async (rows) => ({ upserted: rows.length, error: null }),
    }
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.meta, {
    companiesHydrated: 1,
    companiesMissing: 1,
    companiesErrors: 1,
  });
  const data = result.body.data as Array<Record<string, unknown>>;
  assert.equal(data[0].domain, "ok.test");
  assert.equal(data[1].domain, null);
});

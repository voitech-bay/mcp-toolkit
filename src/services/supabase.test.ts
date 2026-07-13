import assert from "node:assert/strict";
import test from "node:test";
import { getSupabaseConfigError, SUPABASE_SERVICE_ROLE_REQUIRED_MESSAGE } from "./supabase.js";

test("Supabase server access requires the service-role key", () => {
  assert.equal(
    getSupabaseConfigError({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    }),
    SUPABASE_SERVICE_ROLE_REQUIRED_MESSAGE
  );
});

test("Supabase server access is configured with URL and service-role key", () => {
  assert.equal(
    getSupabaseConfigError({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_ANON_KEY: "anon-key",
    }),
    null
  );
});

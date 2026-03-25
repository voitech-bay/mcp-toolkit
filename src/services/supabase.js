"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENRICHMENT_AGENT_RESULTS_TABLE = exports.ENRICHMENT_AGENT_RUNS_TABLE = exports.ENRICHMENT_QUEUE_TASKS_TABLE = exports.ENRICHMENT_AGENTS_TABLE = exports.SEARCH_COLUMNS_BY_TABLE = exports.TABLE_KEY_TO_NAME = exports.HYPOTHESIS_TARGETS_TABLE = exports.HYPOTHESES_TABLE = exports.PROJECT_COMPANIES_TABLE = exports.CONTACTS_CONTEXT_TABLE = exports.COMPANIES_CONTEXT_TABLE = exports.SYNC_LOG_ENTRIES_TABLE = exports.SYNC_RUNS_TABLE = exports.PROJECTS_TABLE = exports.CONTEXT_SNAPSHOTS_TABLE = exports.COMPANIES_TABLE = exports.CONTACTS_TABLE = exports.SENDERS_TABLE = exports.LINKEDIN_MESSAGES_TABLE = void 0;
exports.parseCompanyTagsColumn = parseCompanyTagsColumn;
exports.getProjects = getProjects;
exports.getProjectById = getProjectById;
exports.updateProjectCredentials = updateProjectCredentials;
exports.getProjectEntityCounts = getProjectEntityCounts;
exports.getProjectLatestRows = getProjectLatestRows;
exports.getActiveSyncRun = getActiveSyncRun;
exports.getSyncHistory = getSyncHistory;
exports.getCompanyIdsByDomains = getCompanyIdsByDomains;
exports.ensureCompanies = ensureCompanies;
exports.createSyncRun = createSyncRun;
exports.updateSyncRun = updateSyncRun;
exports.insertSyncLogEntry = insertSyncLogEntry;
exports.getSupabase = getSupabase;
exports.getLinkedinMessages = getLinkedinMessages;
exports.getConversationByContactFullName = getConversationByContactFullName;
exports.getConversation = getConversation;
exports.listCompanyContextsByCompanyId = listCompanyContextsByCompanyId;
exports.getCompanyContextByCompanyId = getCompanyContextByCompanyId;
exports.addCompanyContextEntry = addCompanyContextEntry;
exports.setCompanyRootContext = setCompanyRootContext;
exports.getCompanyContextCounts = getCompanyContextCounts;
exports.listContactContextsByContactId = listContactContextsByContactId;
exports.getContactContextByContactId = getContactContextByContactId;
exports.addContactContextEntry = addContactContextEntry;
exports.setContactRootContext = setContactRootContext;
exports.getContactContextCounts = getContactContextCounts;
exports.getSenders = getSenders;
exports.getContacts = getContacts;
exports.getLatestCreatedAt = getLatestCreatedAt;
exports.createCompany = createCompany;
exports.getCompaniesByIds = getCompaniesByIds;
exports.getContactsProfileForPromptByUuids = getContactsProfileForPromptByUuids;
exports.updateContactCompany = updateContactCompany;
exports.getAllCompanies = getAllCompanies;
exports.addCompaniesToProject = addCompaniesToProject;
exports.getProjectCompanies = getProjectCompanies;
exports.getHypothesesWithCounts = getHypothesesWithCounts;
exports.getHypothesisTargets = getHypothesisTargets;
exports.createHypothesis = createHypothesis;
exports.updateHypothesis = updateHypothesis;
exports.deleteHypothesis = deleteHypothesis;
exports.addCompaniesToHypothesis = addCompaniesToHypothesis;
exports.removeCompaniesFromHypothesis = removeCompaniesFromHypothesis;
exports.getTableCounts = getTableCounts;
exports.getLatestRows = getLatestRows;
exports.queryTableWithFilters = queryTableWithFilters;
exports.getConversationsList = getConversationsList;
exports.getCompanyHypotheses = getCompanyHypotheses;
exports.getContactsByCompany = getContactsByCompany;
exports.getContextSnapshots = getContextSnapshots;
exports.getContextSnapshotById = getContextSnapshotById;
exports.saveContextSnapshot = saveContextSnapshot;
exports.deriveEnrichmentCellState = deriveEnrichmentCellState;
exports.listAllEnrichmentAgents = listAllEnrichmentAgents;
exports.createEnrichmentAgent = createEnrichmentAgent;
exports.updateEnrichmentAgent = updateEnrichmentAgent;
exports.listEnrichmentAgentsForEntityType = listEnrichmentAgentsForEntityType;
exports.getContactsForProjectPage = getContactsForProjectPage;
exports.getEnrichmentTableData = getEnrichmentTableData;
exports.enqueueEnrichmentTasks = enqueueEnrichmentTasks;
exports.listEnrichmentQueueTasksForProject = listEnrichmentQueueTasksForProject;
exports.listEnrichmentAgentRunsForProject = listEnrichmentAgentRunsForProject;
exports.stopEnrichmentQueueTask = stopEnrichmentQueueTask;
exports.restartEnrichmentQueueTask = restartEnrichmentQueueTask;
var supabase_js_1 = require("@supabase/supabase-js");
var url = process.env.SUPABASE_URL;
var key = (_a = process.env.SUPABASE_SERVICE_ROLE_KEY) !== null && _a !== void 0 ? _a : process.env.SUPABASE_ANON_KEY;
exports.LINKEDIN_MESSAGES_TABLE = "LinkedinMessages";
exports.SENDERS_TABLE = "Senders";
exports.CONTACTS_TABLE = "Contacts";
/** Core companies table; domain is unique. Contacts link via company_id. */
exports.COMPANIES_TABLE = "companies";
exports.CONTEXT_SNAPSHOTS_TABLE = "ContextSnapshots";
/** Parse `companies.tags` jsonb (array of tag strings, or legacy numeric values) from PostgREST/JSON. */
function parseCompanyTagsColumn(raw) {
    if (raw == null)
        return [];
    if (!Array.isArray(raw))
        return [];
    return raw.map(function (x) {
        if (typeof x === "string")
            return x;
        if (typeof x === "number" && Number.isFinite(x))
            return String(x);
        return String(x);
    });
}
// --- Projects (table: Projects) ---
exports.PROJECTS_TABLE = "Projects";
function toProjectSummary(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        api_key_set: row.source_api_key != null && row.source_api_key.length > 0,
        source_api_base_url: row.source_api_base_url,
        created_at: row.created_at,
    };
}
/**
 * List all projects. Returns sanitised summaries (actual API key is hidden).
 */
function getProjects(client) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.PROJECTS_TABLE)
                        .select("*")
                        .order("name", { ascending: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, {
                            data: (data !== null && data !== void 0 ? data : []).map(toProjectSummary),
                            error: null,
                        }];
            }
        });
    });
}
/**
 * Get a single project by id, including credentials.
 */
function getProjectById(client, id) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.PROJECTS_TABLE)
                        .select("*")
                        .eq("id", id)
                        .maybeSingle()];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: (_b = data) !== null && _b !== void 0 ? _b : null, error: null }];
            }
        });
    });
}
/**
 * Update project API credentials. Only updates the provided fields.
 */
function updateProjectCredentials(client, id, credentials) {
    return __awaiter(this, void 0, void 0, function () {
        var update, error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    update = {};
                    if (credentials.apiKey !== undefined)
                        update.source_api_key = credentials.apiKey;
                    if (credentials.baseUrl !== undefined)
                        update.source_api_base_url = credentials.baseUrl;
                    if (Object.keys(update).length === 0)
                        return [2 /*return*/, { error: null }];
                    return [4 /*yield*/, client
                            .from(exports.PROJECTS_TABLE)
                            .update(update)
                            .eq("id", id)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
/**
 * Get entity counts (Contacts, LinkedinMessages, Senders) filtered by project_id.
 */
function getProjectEntityCounts(client, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, contactsRes, messagesRes, sendersRes, zeroCounts, e_1, message;
        var _b, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    _f.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, Promise.all([
                            client
                                .from(exports.CONTACTS_TABLE)
                                .select("*", { count: "exact", head: true })
                                .eq("project_id", projectId),
                            client
                                .from(exports.LINKEDIN_MESSAGES_TABLE)
                                .select("*", { count: "exact", head: true })
                                .eq("project_id", projectId),
                            client
                                .from(exports.SENDERS_TABLE)
                                .select("*", { count: "exact", head: true })
                                .eq("project_id", projectId),
                        ])];
                case 1:
                    _a = _f.sent(), contactsRes = _a[0], messagesRes = _a[1], sendersRes = _a[2];
                    zeroCounts = { contacts: 0, linkedin_messages: 0, senders: 0 };
                    if (contactsRes.error)
                        return [2 /*return*/, { counts: zeroCounts, error: contactsRes.error.message }];
                    if (messagesRes.error)
                        return [2 /*return*/, { counts: zeroCounts, error: messagesRes.error.message }];
                    if (sendersRes.error)
                        return [2 /*return*/, { counts: zeroCounts, error: sendersRes.error.message }];
                    return [2 /*return*/, {
                            counts: {
                                contacts: (_b = contactsRes.count) !== null && _b !== void 0 ? _b : 0,
                                linkedin_messages: (_d = messagesRes.count) !== null && _d !== void 0 ? _d : 0,
                                senders: (_e = sendersRes.count) !== null && _e !== void 0 ? _e : 0,
                            },
                            error: null,
                        }];
                case 2:
                    e_1 = _f.sent();
                    message = e_1 instanceof Error ? e_1.message : String(e_1);
                    return [2 /*return*/, { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: message }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get latest rows per table filtered by project_id.
 */
function getProjectLatestRows(client_1, projectId_1) {
    return __awaiter(this, arguments, void 0, function (client, projectId, limit) {
        var n, _a, contactsRes, messagesRes, sendersRes, latest, e_2, message;
        var _b, _d, _e;
        if (limit === void 0) { limit = DEFAULT_LATEST_LIMIT; }
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    n = Math.min(Math.max(limit, 1), 100);
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, Promise.all([
                            client
                                .from(exports.CONTACTS_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .order("created_at", { ascending: false })
                                .limit(n),
                            client
                                .from(exports.LINKEDIN_MESSAGES_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .order("created_at", { ascending: false })
                                .limit(n),
                            client
                                .from(exports.SENDERS_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .order("created_at", { ascending: false })
                                .limit(n),
                        ])];
                case 2:
                    _a = _f.sent(), contactsRes = _a[0], messagesRes = _a[1], sendersRes = _a[2];
                    latest = {
                        contacts: (_b = contactsRes.data) !== null && _b !== void 0 ? _b : [],
                        linkedin_messages: (_d = messagesRes.data) !== null && _d !== void 0 ? _d : [],
                        senders: (_e = sendersRes.data) !== null && _e !== void 0 ? _e : [],
                    };
                    if (contactsRes.error)
                        return [2 /*return*/, { latest: latest, error: contactsRes.error.message }];
                    if (messagesRes.error)
                        return [2 /*return*/, { latest: latest, error: messagesRes.error.message }];
                    if (sendersRes.error)
                        return [2 /*return*/, { latest: latest, error: sendersRes.error.message }];
                    return [2 /*return*/, { latest: latest, error: null }];
                case 3:
                    e_2 = _f.sent();
                    message = e_2 instanceof Error ? e_2.message : String(e_2);
                    return [2 /*return*/, {
                            latest: { contacts: [], linkedin_messages: [], senders: [] },
                            error: message,
                        }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Check if any sync run is currently active (status = 'running').
 * Returns the active run row if one exists, or null.
 */
function getActiveSyncRun(client) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.SYNC_RUNS_TABLE)
                        .select("*")
                        .eq("status", "running")
                        .order("started_at", { ascending: false })
                        .limit(1)
                        .maybeSingle()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
            }
        });
    });
}
/**
 * Get recent sync runs (optionally filtered by project_id) with their log entries.
 */
function getSyncHistory(client, options) {
    return __awaiter(this, void 0, void 0, function () {
        var n, runsQuery, _a, runs, runsError, runIds, _b, entries, entriesError, entriesByRun, _i, _d, entry, runId, result;
        var _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    n = Math.min(Math.max((_e = options === null || options === void 0 ? void 0 : options.limit) !== null && _e !== void 0 ? _e : 20, 1), 100);
                    runsQuery = client
                        .from(exports.SYNC_RUNS_TABLE)
                        .select("*")
                        .order("started_at", { ascending: false })
                        .limit(n);
                    if (options === null || options === void 0 ? void 0 : options.projectId) {
                        runsQuery = runsQuery.eq("project_id", options.projectId);
                    }
                    return [4 /*yield*/, runsQuery];
                case 1:
                    _a = _j.sent(), runs = _a.data, runsError = _a.error;
                    if (runsError)
                        return [2 /*return*/, { data: [], error: runsError.message }];
                    if (!runs || runs.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    runIds = runs.map(function (r) { return r.id; });
                    return [4 /*yield*/, client
                            .from(exports.SYNC_LOG_ENTRIES_TABLE)
                            .select("*")
                            .in("run_id", runIds)
                            .order("created_at", { ascending: true })];
                case 2:
                    _b = _j.sent(), entries = _b.data, entriesError = _b.error;
                    if (entriesError)
                        return [2 /*return*/, { data: [], error: entriesError.message }];
                    entriesByRun = new Map();
                    for (_i = 0, _d = (entries !== null && entries !== void 0 ? entries : []); _i < _d.length; _i++) {
                        entry = _d[_i];
                        runId = entry.run_id;
                        if (!entriesByRun.has(runId))
                            entriesByRun.set(runId, []);
                        entriesByRun.get(runId).push({
                            id: entry.id,
                            created_at: entry.created_at,
                            kind: entry.kind,
                            level: entry.level,
                            message: entry.message,
                            table_name: (_f = entry.table_name) !== null && _f !== void 0 ? _f : null,
                            row_count: (_g = entry.row_count) !== null && _g !== void 0 ? _g : null,
                            data: (_h = entry.data) !== null && _h !== void 0 ? _h : null,
                        });
                    }
                    result = runs.map(function (r) {
                        var _a, _b, _d, _e, _f;
                        return ({
                            id: r.id,
                            started_at: r.started_at,
                            finished_at: (_a = r.finished_at) !== null && _a !== void 0 ? _a : null,
                            status: r.status,
                            result_summary: (_b = r.result_summary) !== null && _b !== void 0 ? _b : null,
                            error: (_d = r.error) !== null && _d !== void 0 ? _d : null,
                            project_id: (_e = r.project_id) !== null && _e !== void 0 ? _e : null,
                            log_entries: (_f = entriesByRun.get(r.id)) !== null && _f !== void 0 ? _f : [],
                        });
                    });
                    return [2 /*return*/, { data: result, error: null }];
            }
        });
    });
}
// --- companies (table: companies) ---
/**
 * Get company ids by domain. Returns a map domain -> id for all found.
 * Domains should be normalized (lowercase, trimmed).
 */
function getCompanyIdsByDomains(client, domains) {
    return __awaiter(this, void 0, void 0, function () {
        var unique, _a, data, error, map, _i, _b, row, d, id;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    unique = __spreadArray([], new Set(domains), true).filter(function (d) { return d.length > 0; });
                    if (unique.length === 0)
                        return [2 /*return*/, { map: {}, error: null }];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_TABLE)
                            .select("id, domain")
                            .in("domain", unique)];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { map: {}, error: error.message }];
                    map = {};
                    for (_i = 0, _b = data !== null && data !== void 0 ? data : []; _i < _b.length; _i++) {
                        row = _b[_i];
                        d = row === null || row === void 0 ? void 0 : row.domain;
                        id = row === null || row === void 0 ? void 0 : row.id;
                        if (typeof d === "string" && typeof id === "string")
                            map[d] = id;
                    }
                    return [2 /*return*/, { map: map, error: null }];
            }
        });
    });
}
/**
 * Ensure companies exist by domain. Inserts missing rows (name/linkedin_url optional),
 * then returns domain -> id for all given domains. Uses upsert on domain so existing
 * rows are updated with provided name/linkedin_url when given.
 */
function ensureCompanies(client, rows) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error, map, _i, _b, row, d, id;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (rows.length === 0)
                        return [2 /*return*/, { map: {}, error: null }];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_TABLE)
                            .upsert(rows.map(function (r) {
                            var _a, _b;
                            return ({
                                domain: r.domain,
                                name: (_a = r.name) !== null && _a !== void 0 ? _a : r.domain,
                                linkedin_url: (_b = r.linkedin_url) !== null && _b !== void 0 ? _b : null,
                            });
                        }), { onConflict: "domain" })
                            .select("id, domain")];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { map: {}, error: error.message }];
                    map = {};
                    for (_i = 0, _b = data !== null && data !== void 0 ? data : []; _i < _b.length; _i++) {
                        row = _b[_i];
                        d = row === null || row === void 0 ? void 0 : row.domain;
                        id = row === null || row === void 0 ? void 0 : row.id;
                        if (typeof d === "string" && typeof id === "string")
                            map[d] = id;
                    }
                    return [2 /*return*/, { map: map, error: null }];
            }
        });
    });
}
// --- Sync logging (sync_runs, sync_log_entries) ---
exports.SYNC_RUNS_TABLE = "sync_runs";
exports.SYNC_LOG_ENTRIES_TABLE = "sync_log_entries";
/**
 * Create a new sync run. Returns run id or error.
 * When projectId is provided, the run is associated with that project.
 */
function createSyncRun(client, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var row, _a, data, error, id;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    row = { status: "running" };
                    if (projectId)
                        row.project_id = projectId;
                    return [4 /*yield*/, client
                            .from(exports.SYNC_RUNS_TABLE)
                            .insert(row)
                            .select("id")
                            .single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { id: null, error: error.message }];
                    id = data === null || data === void 0 ? void 0 : data.id;
                    return [2 /*return*/, { id: typeof id === "string" ? id : null, error: null }];
            }
        });
    });
}
/**
 * Update sync run with finish time, status, and optional result/error.
 */
function updateSyncRun(client, runId, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var error;
        var _a, _b, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.SYNC_RUNS_TABLE)
                        .update({
                        finished_at: (_a = payload.finished_at) !== null && _a !== void 0 ? _a : new Date().toISOString(),
                        status: payload.status,
                        result_summary: (_b = payload.result_summary) !== null && _b !== void 0 ? _b : null,
                        error: (_d = payload.error) !== null && _d !== void 0 ? _d : null,
                    })
                        .eq("id", runId)];
                case 1:
                    error = (_f.sent()).error;
                    return [2 /*return*/, { error: (_e = error === null || error === void 0 ? void 0 : error.message) !== null && _e !== void 0 ? _e : null }];
            }
        });
    });
}
/**
 * Insert a sync log entry (log message or upsert event). Fails silently if table is missing.
 */
function insertSyncLogEntry(client, runId, entry) {
    return __awaiter(this, void 0, void 0, function () {
        var error;
        var _a, _b, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, client.from(exports.SYNC_LOG_ENTRIES_TABLE).insert({
                        run_id: runId,
                        kind: entry.kind,
                        level: entry.level,
                        message: entry.message,
                        table_name: (_a = entry.table_name) !== null && _a !== void 0 ? _a : null,
                        row_count: (_b = entry.row_count) !== null && _b !== void 0 ? _b : null,
                        data: (_d = entry.data) !== null && _d !== void 0 ? _d : null,
                    })];
                case 1:
                    error = (_f.sent()).error;
                    return [2 /*return*/, { error: (_e = error === null || error === void 0 ? void 0 : error.message) !== null && _e !== void 0 ? _e : null }];
            }
        });
    });
}
function getSupabase() {
    if (!url || !key)
        return null;
    return (0, supabase_js_1.createClient)(url, key);
}
function getLinkedinMessages(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var query, orderBy, order, limit, offset, _a, data, error;
        var _b, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    query = client.from(exports.LINKEDIN_MESSAGES_TABLE).select("*");
                    if (params.sender != null)
                        query = query.eq("sender", params.sender);
                    if (params.senderId != null)
                        query = query.eq("sender_id", params.senderId);
                    if (params.senderProfileUuid != null)
                        query = query.eq("sender_profile_uuid", params.senderProfileUuid);
                    if (params.contactId != null)
                        query = query.eq("contact_id", params.contactId);
                    if (params.leadUuid != null)
                        query = query.eq("lead_uuid", params.leadUuid);
                    if (params.leadId != null)
                        query = query.eq("lead_id", params.leadId);
                    if (params.conversationUuid != null)
                        query = query.eq("linkedin_conversation_uuid", params.conversationUuid);
                    if (params.messageId != null)
                        query = query.eq("uuid", params.messageId);
                    if (params.channel != null)
                        query = query.eq("channel", params.channel);
                    if (params.direction != null)
                        query = query.eq("direction", params.direction);
                    if (params.status != null)
                        query = query.eq("status", params.status);
                    if (params.createdAfter != null)
                        query = query.gte("created_at", params.createdAfter);
                    if (params.createdBefore != null)
                        query = query.lte("created_at", params.createdBefore);
                    orderBy = (_b = params.orderBy) !== null && _b !== void 0 ? _b : "created_at";
                    order = (_d = params.order) !== null && _d !== void 0 ? _d : "desc";
                    query = query.order(orderBy, { ascending: order === "asc" });
                    limit = Math.min(Math.max((_e = params.limit) !== null && _e !== void 0 ? _e : 100, 1), 1000);
                    offset = Math.max((_f = params.offset) !== null && _f !== void 0 ? _f : 0, 0);
                    query = query.range(offset, offset + limit - 1);
                    return [4 /*yield*/, query];
                case 1:
                    _a = _g.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: data !== null && data !== void 0 ? data : [], error: null }];
            }
        });
    });
}
/**
 * Find a contact by full name (case-insensitive match on name), then return
 * that contact and all LinkedIn messages (conversation) linked via lead_uuid.
 * Messages are ordered by sent_at ascending (chronological).
 */
function getConversationByContactFullName(client, contactFullName, options) {
    return __awaiter(this, void 0, void 0, function () {
        var trimmed, _a, contacts, contactError, contact, leadUuid, messageLimit, msgResult;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    trimmed = contactFullName === null || contactFullName === void 0 ? void 0 : contactFullName.trim();
                    if (!trimmed) {
                        return [2 /*return*/, { contact: null, messages: [], error: "contactFullName is required." }];
                    }
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("*")
                            .ilike("name", "%".concat(trimmed, "%"))
                            .limit(10)];
                case 1:
                    _a = _d.sent(), contacts = _a.data, contactError = _a.error;
                    if (contactError) {
                        return [2 /*return*/, { contact: null, messages: [], error: contactError.message }];
                    }
                    contact = Array.isArray(contacts) && contacts.length > 0 ? contacts[0] : null;
                    if (!contact || typeof contact !== "object" || !("uuid" in contact)) {
                        return [2 /*return*/, {
                                contact: null,
                                messages: [],
                                error: "No contact found matching \"".concat(trimmed, "\"."),
                            }];
                    }
                    leadUuid = contact.uuid;
                    messageLimit = Math.min(Math.max((_b = options === null || options === void 0 ? void 0 : options.messageLimit) !== null && _b !== void 0 ? _b : 500, 1), 1000);
                    return [4 /*yield*/, getLinkedinMessages(client, {
                            leadUuid: leadUuid,
                            orderBy: "sent_at",
                            order: "asc",
                            limit: messageLimit,
                        })];
                case 2:
                    msgResult = _d.sent();
                    if (msgResult.error) {
                        return [2 /*return*/, {
                                contact: contact,
                                messages: [],
                                error: msgResult.error,
                            }];
                    }
                    return [2 /*return*/, {
                            contact: contact,
                            messages: msgResult.data,
                            error: null,
                        }];
            }
        });
    });
}
/**
 * Get LinkedIn conversation(s) by contact (leadUuid), by message (conversationUuid),
 * or by sender (senderProfileUuid). Messages ordered by sent_at ascending.
 */
function getConversation(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var limit, contactRes, contact, msgResult, msgResult, messages, contact, first, leadUuid, contactRes, msgResult;
        var _a, _b, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    limit = Math.min(Math.max((_a = params.messageLimit) !== null && _a !== void 0 ? _a : 500, 1), 1000);
                    if (!params.leadUuid) return [3 /*break*/, 3];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("*")
                            .eq("uuid", params.leadUuid)
                            .limit(1)
                            .maybeSingle()];
                case 1:
                    contactRes = _e.sent();
                    contact = (_b = contactRes.data) !== null && _b !== void 0 ? _b : null;
                    return [4 /*yield*/, getLinkedinMessages(client, {
                            leadUuid: params.leadUuid,
                            orderBy: "sent_at",
                            order: "asc",
                            limit: limit,
                        })];
                case 2:
                    msgResult = _e.sent();
                    return [2 /*return*/, {
                            contact: contact,
                            messages: msgResult.error ? [] : msgResult.data,
                            error: msgResult.error,
                        }];
                case 3:
                    if (!params.conversationUuid) return [3 /*break*/, 7];
                    return [4 /*yield*/, getLinkedinMessages(client, {
                            conversationUuid: params.conversationUuid,
                            orderBy: "sent_at",
                            order: "asc",
                            limit: limit,
                        })];
                case 4:
                    msgResult = _e.sent();
                    messages = msgResult.error ? [] : msgResult.data;
                    contact = null;
                    if (!(Array.isArray(messages) && messages.length > 0)) return [3 /*break*/, 6];
                    first = messages[0];
                    leadUuid = (first === null || first === void 0 ? void 0 : first.lead_uuid) != null ? String(first.lead_uuid) : null;
                    if (!leadUuid) return [3 /*break*/, 6];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("*")
                            .eq("uuid", leadUuid)
                            .limit(1)
                            .maybeSingle()];
                case 5:
                    contactRes = _e.sent();
                    contact = ((_d = contactRes.data) !== null && _d !== void 0 ? _d : null);
                    _e.label = 6;
                case 6: return [2 /*return*/, { contact: contact, messages: messages, error: msgResult.error }];
                case 7:
                    if (!params.senderProfileUuid) return [3 /*break*/, 9];
                    return [4 /*yield*/, getLinkedinMessages(client, {
                            senderProfileUuid: params.senderProfileUuid,
                            orderBy: "sent_at",
                            order: "asc",
                            limit: limit,
                        })];
                case 8:
                    msgResult = _e.sent();
                    return [2 /*return*/, { messages: msgResult.error ? [] : msgResult.data, error: msgResult.error }];
                case 9: return [2 /*return*/, { messages: [], error: "Provide leadUuid, conversationUuid, or senderProfileUuid." }];
            }
        });
    });
}
// --- CompaniesContext (table: CompaniesContext) ---
// Table: id, created_at, rootContext, company_id (FK to companies.id).
exports.COMPANIES_CONTEXT_TABLE = "CompaniesContext";
/**
 * List company context entries by company_id.
 */
function listCompanyContextsByCompanyId(client, companyId) {
    return __awaiter(this, void 0, void 0, function () {
        var id, _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    id = companyId === null || companyId === void 0 ? void 0 : companyId.trim();
                    if (!id)
                        return [2 /*return*/, { data: [], error: "company_id is required." }];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_CONTEXT_TABLE)
                            .select("*")
                            .eq("company_id", id)
                            .order("created_at", { ascending: false })];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: (_b = data) !== null && _b !== void 0 ? _b : [], error: null }];
            }
        });
    });
}
/**
 * Get latest company context entry by company_id.
 */
function getCompanyContextByCompanyId(client, companyId) {
    return __awaiter(this, void 0, void 0, function () {
        var list;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, listCompanyContextsByCompanyId(client, companyId)];
                case 1:
                    list = _b.sent();
                    if (list.error)
                        return [2 /*return*/, { data: null, error: list.error }];
                    return [2 /*return*/, { data: (_a = list.data[0]) !== null && _a !== void 0 ? _a : null, error: null }];
            }
        });
    });
}
/**
 * Add a new company context entry row. company_id is required.
 */
function addCompanyContextEntry(client, companyId, rootContext) {
    return __awaiter(this, void 0, void 0, function () {
        var id, payload, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    id = companyId === null || companyId === void 0 ? void 0 : companyId.trim();
                    if (!id)
                        return [2 /*return*/, { data: null, error: "company_id is required." }];
                    payload = { company_id: id, rootContext: rootContext !== null && rootContext !== void 0 ? rootContext : null };
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_CONTEXT_TABLE)
                            .insert(payload)
                            .select()
                            .single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
            }
        });
    });
}
/**
 * Set root context for a company: update latest row if present, otherwise insert.
 * Prefer addCompanyContextEntry for multi-context.
 */
function setCompanyRootContext(client, companyId, rootContext) {
    return __awaiter(this, void 0, void 0, function () {
        var id, list, latest, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    id = companyId === null || companyId === void 0 ? void 0 : companyId.trim();
                    if (!id)
                        return [2 /*return*/, { data: null, error: "company_id is required." }];
                    return [4 /*yield*/, listCompanyContextsByCompanyId(client, id)];
                case 1:
                    list = _b.sent();
                    if (list.error)
                        return [2 /*return*/, { data: null, error: list.error }];
                    latest = list.data[0];
                    if (!(latest === null || latest === void 0 ? void 0 : latest.id)) return [3 /*break*/, 3];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_CONTEXT_TABLE)
                            .update({ rootContext: rootContext !== null && rootContext !== void 0 ? rootContext : null })
                            .eq("id", latest.id)
                            .select()
                            .single()];
                case 2:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
                case 3: return [4 /*yield*/, addCompanyContextEntry(client, id, rootContext)];
                case 4: return [2 /*return*/, _b.sent()];
            }
        });
    });
}
/**
 * Get context counts for many companies in one query. Returns Record<company_id, count>.
 * IDs not present in the table get count 0.
 */
function getCompanyContextCounts(client, companyIds) {
    return __awaiter(this, void 0, void 0, function () {
        var ids, result, _a, data, error, rows, _i, rows_1, row;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    ids = companyIds.map(function (id) { return id === null || id === void 0 ? void 0 : id.trim(); }).filter(Boolean);
                    result = Object.fromEntries(ids.map(function (id) { return [id, 0]; }));
                    if (ids.length === 0)
                        return [2 /*return*/, { data: result, error: null }];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_CONTEXT_TABLE)
                            .select("company_id")
                            .in("company_id", ids)];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: result, error: error.message }];
                    rows = (_b = data) !== null && _b !== void 0 ? _b : [];
                    for (_i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
                        row = rows_1[_i];
                        if (row.company_id != null && row.company_id in result) {
                            result[row.company_id] += 1;
                        }
                    }
                    return [2 /*return*/, { data: result, error: null }];
            }
        });
    });
}
// --- ContactsContext (table: ContactsContext) ---
// Table: id, created_at, rootContext, contact_id (FK to Contacts.uuid).
exports.CONTACTS_CONTEXT_TABLE = "ContactsContext";
/**
 * List contact context entries by contact_id (Contacts.uuid).
 */
function listContactContextsByContactId(client, contactId) {
    return __awaiter(this, void 0, void 0, function () {
        var id, _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    id = contactId === null || contactId === void 0 ? void 0 : contactId.trim();
                    if (!id)
                        return [2 /*return*/, { data: [], error: "contact_id is required." }];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_CONTEXT_TABLE)
                            .select("*")
                            .eq("contact_id", id)
                            .order("created_at", { ascending: false })];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: (_b = data) !== null && _b !== void 0 ? _b : [], error: null }];
            }
        });
    });
}
/**
 * Get latest contact context entry by contact_id.
 */
function getContactContextByContactId(client, contactId) {
    return __awaiter(this, void 0, void 0, function () {
        var list;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, listContactContextsByContactId(client, contactId)];
                case 1:
                    list = _b.sent();
                    if (list.error)
                        return [2 /*return*/, { data: null, error: list.error }];
                    return [2 /*return*/, { data: (_a = list.data[0]) !== null && _a !== void 0 ? _a : null, error: null }];
            }
        });
    });
}
/**
 * Add a new contact context entry row. contact_id is required.
 */
function addContactContextEntry(client, contactId, rootContext) {
    return __awaiter(this, void 0, void 0, function () {
        var id, payload, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    id = contactId === null || contactId === void 0 ? void 0 : contactId.trim();
                    if (!id)
                        return [2 /*return*/, { data: null, error: "contact_id is required." }];
                    payload = { contact_id: id, rootContext: rootContext !== null && rootContext !== void 0 ? rootContext : null };
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_CONTEXT_TABLE)
                            .insert(payload)
                            .select()
                            .single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
            }
        });
    });
}
/**
 * Set root context for a contact: update latest row if present, otherwise insert.
 * Prefer addContactContextEntry for multi-context.
 */
function setContactRootContext(client, contactId, rootContext) {
    return __awaiter(this, void 0, void 0, function () {
        var id, list, latest, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    id = contactId === null || contactId === void 0 ? void 0 : contactId.trim();
                    if (!id)
                        return [2 /*return*/, { data: null, error: "contact_id is required." }];
                    return [4 /*yield*/, listContactContextsByContactId(client, id)];
                case 1:
                    list = _b.sent();
                    if (list.error)
                        return [2 /*return*/, { data: null, error: list.error }];
                    latest = list.data[0];
                    if (!(latest === null || latest === void 0 ? void 0 : latest.id)) return [3 /*break*/, 3];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_CONTEXT_TABLE)
                            .update({ rootContext: rootContext !== null && rootContext !== void 0 ? rootContext : null })
                            .eq("id", latest.id)
                            .select()
                            .single()];
                case 2:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
                case 3: return [4 /*yield*/, addContactContextEntry(client, id, rootContext)];
                case 4: return [2 /*return*/, _b.sent()];
            }
        });
    });
}
/**
 * Get context counts for many contacts in one query. Returns Record<contact_id, count>.
 * IDs not present in the table get count 0.
 */
function getContactContextCounts(client, contactIds) {
    return __awaiter(this, void 0, void 0, function () {
        var ids, result, _a, data, error, rows, _i, rows_2, row;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    ids = contactIds.map(function (id) { return id === null || id === void 0 ? void 0 : id.trim(); }).filter(Boolean);
                    result = Object.fromEntries(ids.map(function (id) { return [id, 0]; }));
                    if (ids.length === 0)
                        return [2 /*return*/, { data: result, error: null }];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_CONTEXT_TABLE)
                            .select("contact_id")
                            .in("contact_id", ids)];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: result, error: error.message }];
                    rows = (_b = data) !== null && _b !== void 0 ? _b : [];
                    for (_i = 0, rows_2 = rows; _i < rows_2.length; _i++) {
                        row = rows_2[_i];
                        if (row.contact_id != null && row.contact_id in result) {
                            result[row.contact_id] += 1;
                        }
                    }
                    return [2 /*return*/, { data: result, error: null }];
            }
        });
    });
}
function getSenders(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var query, orderBy, order, limit, offset, _a, data, error;
        var _b, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    query = client.from(exports.SENDERS_TABLE).select("*");
                    if (params.uuid != null)
                        query = query.eq("uuid", params.uuid);
                    if (params.teamId != null)
                        query = query.eq("team_id", params.teamId);
                    if (params.linkedinBrowserId != null)
                        query = query.eq("linkedin_browser_id", params.linkedinBrowserId);
                    if (params.linkedinAccountUuid != null)
                        query = query.eq("linkedin_account_uuid", params.linkedinAccountUuid);
                    if (params.assigneeUserId != null)
                        query = query.eq("assignee_user_id", params.assigneeUserId);
                    if (params.firstName != null)
                        query = query.eq("first_name", params.firstName);
                    if (params.lastName != null)
                        query = query.eq("last_name", params.lastName);
                    if (params.label != null)
                        query = query.eq("label", params.label);
                    if (params.smartLimitsEnabled != null)
                        query = query.eq("smart_limits_enabled", params.smartLimitsEnabled);
                    if (params.avatarUrl != null)
                        query = query.eq("avatar_url", params.avatarUrl);
                    if (params.status != null)
                        query = query.eq("status", params.status);
                    if (params.userId != null)
                        query = query.eq("user_id", params.userId);
                    if (params.lastAutomationServerId != null)
                        query = query.eq("last_automation_server_id", params.lastAutomationServerId);
                    if (params.notificationEmails != null)
                        query = query.eq("notification_emails", params.notificationEmails);
                    if (params.createdAfter != null)
                        query = query.gte("created_at", params.createdAfter);
                    if (params.createdBefore != null)
                        query = query.lte("created_at", params.createdBefore);
                    if (params.updatedAfter != null)
                        query = query.gte("updated_at", params.updatedAfter);
                    if (params.updatedBefore != null)
                        query = query.lte("updated_at", params.updatedBefore);
                    if (params.holdTasksTillAfter != null)
                        query = query.gte("hold_tasks_till", params.holdTasksTillAfter);
                    if (params.holdTasksTillBefore != null)
                        query = query.lte("hold_tasks_till", params.holdTasksTillBefore);
                    orderBy = (_b = params.orderBy) !== null && _b !== void 0 ? _b : "created_at";
                    order = (_d = params.order) !== null && _d !== void 0 ? _d : "desc";
                    query = query.order(orderBy, { ascending: order === "asc" });
                    limit = Math.min(Math.max((_e = params.limit) !== null && _e !== void 0 ? _e : 100, 1), 1000);
                    offset = Math.max((_f = params.offset) !== null && _f !== void 0 ? _f : 0, 0);
                    query = query.range(offset, offset + limit - 1);
                    return [4 /*yield*/, query];
                case 1:
                    _a = _g.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: data !== null && data !== void 0 ? data : [], error: null }];
            }
        });
    });
}
function getContacts(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var query, orderBy, order, limit, offset, _a, data, error;
        var _b, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    query = client.from(exports.CONTACTS_TABLE).select("*");
                    if (params.uuid != null)
                        query = query.eq("uuid", params.uuid);
                    if (params.teamId != null)
                        query = query.eq("team_id", params.teamId);
                    if (params.userId != null)
                        query = query.eq("user_id", params.userId);
                    if (params.listUuid != null)
                        query = query.eq("list_uuid", params.listUuid);
                    if (params.dataSourceUuid != null)
                        query = query.eq("data_source_uuid", params.dataSourceUuid);
                    if (params.aiAgentUuid != null)
                        query = query.eq("ai_agent_uuid", params.aiAgentUuid);
                    if (params.aiAgentMode != null)
                        query = query.eq("ai_agent_mode", params.aiAgentMode);
                    if (params.aiEngagementStatusUuid != null)
                        query = query.eq("ai_engagement_status_uuid", params.aiEngagementStatusUuid);
                    if (params.pipelineStageUuid != null)
                        query = query.eq("pipeline_stage_uuid", params.pipelineStageUuid);
                    if (params.companyUuid != null)
                        query = query.eq("company_uuid", params.companyUuid);
                    if (params.name != null)
                        query = query.eq("name", params.name);
                    if (params.firstName != null)
                        query = query.eq("first_name", params.firstName);
                    if (params.lastName != null)
                        query = query.eq("last_name", params.lastName);
                    if (params.companyName != null)
                        query = query.eq("company_name", params.companyName);
                    if (params.companyLnId != null)
                        query = query.eq("company_ln_id", params.companyLnId);
                    if (params.position != null)
                        query = query.eq("position", params.position);
                    if (params.headline != null)
                        query = query.eq("headline", params.headline);
                    if (params.about != null)
                        query = query.eq("about", params.about);
                    if (params.avatarUrl != null)
                        query = query.eq("avatar_url", params.avatarUrl);
                    if (params.lnMemberId != null)
                        query = query.eq("ln_member_id", params.lnMemberId);
                    if (params.lnId != null)
                        query = query.eq("ln_id", params.lnId);
                    if (params.snId != null)
                        query = query.eq("sn_id", params.snId);
                    if (params.linkedin != null)
                        query = query.eq("linkedin", params.linkedin);
                    if (params.facebook != null)
                        query = query.eq("facebook", params.facebook);
                    if (params.twitter != null)
                        query = query.eq("twitter", params.twitter);
                    if (params.workEmail != null)
                        query = query.eq("work_email", params.workEmail);
                    if (params.workEmailDomain != null)
                        query = query.eq("work_email_domain", params.workEmailDomain);
                    if (params.personalEmail != null)
                        query = query.eq("personal_email", params.personalEmail);
                    if (params.workPhoneNumber != null)
                        query = query.eq("work_phone_number", params.workPhoneNumber);
                    if (params.personalPhoneNumber != null)
                        query = query.eq("personal_phone_number", params.personalPhoneNumber);
                    if (params.connectionsNumber != null)
                        query = query.eq("connections_number", params.connectionsNumber);
                    if (params.followersNumber != null)
                        query = query.eq("followers_number", params.followersNumber);
                    if (params.primaryLanguage != null)
                        query = query.eq("primary_language", params.primaryLanguage);
                    if (params.hasOpenProfile != null)
                        query = query.eq("has_open_profile", params.hasOpenProfile);
                    if (params.hasVerifiedProfile != null)
                        query = query.eq("has_verified_profile", params.hasVerifiedProfile);
                    if (params.hasPremium != null)
                        query = query.eq("has_premium", params.hasPremium);
                    if (params.rawAddress != null)
                        query = query.eq("raw_address", params.rawAddress);
                    if (params.location != null)
                        query = query.eq("location", params.location);
                    if (params.status != null)
                        query = query.eq("status", params.status);
                    if (params.linkedinStatus != null)
                        query = query.eq("linkedin_status", params.linkedinStatus);
                    if (params.emailStatus != null)
                        query = query.eq("email_status", params.emailStatus);
                    if (params.lastAutomationApproveAt != null)
                        query = query.eq("last_automation_approve_at", params.lastAutomationApproveAt);
                    if (params.lastStopOnReplyAt != null)
                        query = query.eq("last_stop_on_reply_at", params.lastStopOnReplyAt);
                    if (params.lastEnrichAtAfter != null)
                        query = query.gte("last_enrich_at", params.lastEnrichAtAfter);
                    if (params.lastEnrichAtBefore != null)
                        query = query.lte("last_enrich_at", params.lastEnrichAtBefore);
                    if (params.createdAfter != null)
                        query = query.gte("created_at", params.createdAfter);
                    if (params.createdBefore != null)
                        query = query.lte("created_at", params.createdBefore);
                    if (params.updatedAfter != null)
                        query = query.gte("updated_at", params.updatedAfter);
                    if (params.updatedBefore != null)
                        query = query.lte("updated_at", params.updatedBefore);
                    orderBy = (_b = params.orderBy) !== null && _b !== void 0 ? _b : "created_at";
                    order = (_d = params.order) !== null && _d !== void 0 ? _d : "desc";
                    query = query.order(orderBy, { ascending: order === "asc" });
                    limit = Math.min(Math.max((_e = params.limit) !== null && _e !== void 0 ? _e : 100, 1), 1000);
                    offset = Math.max((_f = params.offset) !== null && _f !== void 0 ? _f : 0, 0);
                    query = query.range(offset, offset + limit - 1);
                    return [4 /*yield*/, query];
                case 1:
                    _a = _g.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: data !== null && data !== void 0 ? data : [], error: null }];
            }
        });
    });
}
/**
 * Returns the latest created_at (ISO string) for the table, or null if empty.
 * Used by incremental sync to fetch only rows newer than this from the source API.
 * When projectId is provided, only considers rows belonging to that project.
 */
function getLatestCreatedAt(client, table, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var query, _a, data, error, raw, latest;
        var _b, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    query = client
                        .from(table)
                        .select("created_at")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    if (projectId) {
                        query = query.eq("project_id", projectId);
                    }
                    return [4 /*yield*/, query.maybeSingle()];
                case 1:
                    _a = _f.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { latest: null, error: error.message }];
                    raw = data === null || data === void 0 ? void 0 : data.created_at;
                    if (raw == null)
                        return [2 /*return*/, { latest: null, error: null }];
                    latest = typeof raw === "string" ? raw : (_e = (_d = (_b = raw).toISOString) === null || _d === void 0 ? void 0 : _d.call(_b)) !== null && _e !== void 0 ? _e : String(raw);
                    return [2 /*return*/, { latest: latest, error: null }];
            }
        });
    });
}
/**
 * Create a new company row. Returns the created company id.
 */
function createCompany(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.COMPANIES_TABLE)
                        .insert({ name: payload.name, domain: (_b = payload.domain) !== null && _b !== void 0 ? _b : null })
                        .select("id")
                        .single()];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { id: null, error: error.message }];
                    return [2 /*return*/, { id: data.id, error: null }];
            }
        });
    });
}
/**
 * Fetch minimal company info (id, name, domain) for a given list of company UUIDs.
 * Useful for resolving names of companies referenced by contacts without loading all companies.
 */
function getCompaniesByIds(client, ids) {
    return __awaiter(this, void 0, void 0, function () {
        var unique, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    unique = __spreadArray([], new Set(ids), true).filter(Boolean);
                    if (unique.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    return [4 /*yield*/, client
                            .from(exports.COMPANIES_TABLE)
                            .select("id, name, domain, tags")
                            .in("id", unique)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, {
                            data: (data !== null && data !== void 0 ? data : []).map(function (r) {
                                var _a, _b;
                                return ({
                                    id: r.id,
                                    name: (_a = r.name) !== null && _a !== void 0 ? _a : null,
                                    domain: (_b = r.domain) !== null && _b !== void 0 ? _b : null,
                                    tags: parseCompanyTagsColumn(r.tags),
                                });
                            }),
                            error: null,
                        }];
            }
        });
    });
}
/**
 * Batch-load profile fields used when building reply context (headline, about, experience, posts).
 * `experience` and `posts` are typically JSON/array payloads from enrichment sync.
 */
function getContactsProfileForPromptByUuids(client, uuids) {
    return __awaiter(this, void 0, void 0, function () {
        var unique, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    unique = __spreadArray([], new Set(uuids), true).filter(Boolean);
                    if (unique.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("uuid, headline, about, experience, posts")
                            .in("uuid", unique)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, {
                            data: (data !== null && data !== void 0 ? data : []),
                            error: null,
                        }];
            }
        });
    });
}
/**
 * Set company_id (and optionally company_name) on a contact row.
 */
function updateContactCompany(client, contactId, companyId, companyName) {
    return __awaiter(this, void 0, void 0, function () {
        var update, error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    update = { company_id: companyId };
                    if (companyName != null)
                        update.company_name = companyName;
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .update(update)
                            .eq("uuid", contactId)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
/**
 * List all companies with optional search and pagination.
 * When projectId is supplied, each row carries `in_project` and `project_company_id`
 * so the UI can show which companies are already connected to the project.
 */
function getAllCompanies(client, options) {
    return __awaiter(this, void 0, void 0, function () {
        var limit, offset, query, search, escaped, pattern, _a, data, error, count, pcMap, companyIds, pcData, _i, _b, pc, rows;
        var _d, _e, _f, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    limit = Math.min(Math.max((_d = options === null || options === void 0 ? void 0 : options.limit) !== null && _d !== void 0 ? _d : 25, 1), 100);
                    offset = Math.max((_e = options === null || options === void 0 ? void 0 : options.offset) !== null && _e !== void 0 ? _e : 0, 0);
                    query = client
                        .from(exports.COMPANIES_TABLE)
                        .select("*", { count: "exact" })
                        .order("name", { ascending: true })
                        .range(offset, offset + limit - 1);
                    search = (_g = (_f = options === null || options === void 0 ? void 0 : options.search) === null || _f === void 0 ? void 0 : _f.trim()) !== null && _g !== void 0 ? _g : "";
                    if (search.length > 0) {
                        escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
                        pattern = "%".concat(escaped, "%");
                        query = query.or("name.ilike.".concat(pattern, ",domain.ilike.").concat(pattern));
                    }
                    return [4 /*yield*/, query];
                case 1:
                    _a = _h.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    pcMap = {};
                    if (!((options === null || options === void 0 ? void 0 : options.projectId) && (data !== null && data !== void 0 ? data : []).length > 0)) return [3 /*break*/, 3];
                    companyIds = data.map(function (r) { return r.id; });
                    return [4 /*yield*/, client
                            .from(exports.PROJECT_COMPANIES_TABLE)
                            .select("id, company_id")
                            .eq("project_id", options.projectId)
                            .in("company_id", companyIds)];
                case 2:
                    pcData = (_h.sent()).data;
                    for (_i = 0, _b = (pcData !== null && pcData !== void 0 ? pcData : []); _i < _b.length; _i++) {
                        pc = _b[_i];
                        pcMap[pc.company_id] = pc.id;
                    }
                    _h.label = 3;
                case 3:
                    rows = (data !== null && data !== void 0 ? data : []).map(function (r) {
                        var _a, _b, _d;
                        return ({
                            id: r.id,
                            name: (_a = r.name) !== null && _a !== void 0 ? _a : null,
                            domain: r.domain,
                            linkedin_url: (_b = r.linkedin_url) !== null && _b !== void 0 ? _b : null,
                            created_at: r.created_at,
                            tags: parseCompanyTagsColumn(r.tags),
                            in_project: r.id in pcMap,
                            project_company_id: (_d = pcMap[r.id]) !== null && _d !== void 0 ? _d : null,
                        });
                    });
                    return [2 /*return*/, { data: rows, total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
/**
 * Add companies to a project (bulk). Skips any already linked.
 * Returns the newly created project_company rows.
 */
function addCompaniesToProject(client, projectId, companyIds) {
    return __awaiter(this, void 0, void 0, function () {
        var existing, existingIds, toInsert, rows, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (companyIds.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    return [4 /*yield*/, client
                            .from(exports.PROJECT_COMPANIES_TABLE)
                            .select("company_id")
                            .eq("project_id", projectId)
                            .in("company_id", companyIds)];
                case 1:
                    existing = (_b.sent()).data;
                    existingIds = new Set((existing !== null && existing !== void 0 ? existing : []).map(function (r) { return r.company_id; }));
                    toInsert = companyIds.filter(function (id) { return !existingIds.has(id); });
                    if (toInsert.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    rows = toInsert.map(function (cid) { return ({ project_id: projectId, company_id: cid }); });
                    return [4 /*yield*/, client
                            .from(exports.PROJECT_COMPANIES_TABLE)
                            .insert(rows)
                            .select("id, company_id")];
                case 2:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), error: null }];
            }
        });
    });
}
// --- project_companies, hypotheses, hypothesis_targets ---
exports.PROJECT_COMPANIES_TABLE = "project_companies";
exports.HYPOTHESES_TABLE = "hypotheses";
exports.HYPOTHESIS_TARGETS_TABLE = "hypothesis_targets";
/**
 * List companies in a project (joining project_companies -> companies).
 * Also joins hypothesis_targets -> hypotheses to return which hypotheses each company appears in.
 * Supports optional search (name/domain ilike) and pagination with total count.
 */
function getProjectCompanies(client, projectId, options) {
    return __awaiter(this, void 0, void 0, function () {
        var limit, offset, query, search, escaped, pattern, _a, data, error, count, rawRows, companyIds, contactsByCompany, contactCountByCompany, contactData, _i, _b, c, cid, rows;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m;
        return __generator(this, function (_o) {
            switch (_o.label) {
                case 0:
                    limit = Math.min(Math.max((_d = options === null || options === void 0 ? void 0 : options.limit) !== null && _d !== void 0 ? _d : 25, 1), 100);
                    offset = Math.max((_e = options === null || options === void 0 ? void 0 : options.offset) !== null && _e !== void 0 ? _e : 0, 0);
                    query = client
                        .from(exports.PROJECT_COMPANIES_TABLE)
                        .select("id, status, created_at, company_id,\n       companies!inner(id, name, domain, linkedin_url, tags),\n       hypothesis_targets(hypothesis_id, hypotheses(id, name))", { count: "exact" })
                        .eq("project_id", projectId);
                    if (options === null || options === void 0 ? void 0 : options.companyId) {
                        query = query.eq("company_id", options.companyId);
                    }
                    search = (_g = (_f = options === null || options === void 0 ? void 0 : options.search) === null || _f === void 0 ? void 0 : _f.trim().toLowerCase()) !== null && _g !== void 0 ? _g : "";
                    if (search.length > 0) {
                        escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
                        pattern = "%".concat(escaped, "%");
                        query = query.or("name.ilike.".concat(pattern, ",domain.ilike.").concat(pattern), {
                            referencedTable: "companies",
                        });
                    }
                    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
                    return [4 /*yield*/, query];
                case 1:
                    _a = _o.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    rawRows = (data !== null && data !== void 0 ? data : []);
                    companyIds = rawRows
                        .map(function (r) {
                        var _a;
                        var c = r.companies;
                        return ((_a = c === null || c === void 0 ? void 0 : c.id) !== null && _a !== void 0 ? _a : r.company_id);
                    })
                        .filter(Boolean);
                    contactsByCompany = {};
                    contactCountByCompany = {};
                    if (!(companyIds.length > 0)) return [3 /*break*/, 3];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("company_id, first_name, last_name, position, project_id")
                            .in("company_id", companyIds)
                            .order("created_at", { ascending: false })
                            .limit(companyIds.length * 10)];
                case 2:
                    contactData = (_o.sent()).data;
                    for (_i = 0, _b = (contactData !== null && contactData !== void 0 ? contactData : []); _i < _b.length; _i++) {
                        c = _b[_i];
                        cid = c.company_id;
                        if (!contactsByCompany[cid])
                            contactsByCompany[cid] = [];
                        contactCountByCompany[cid] = ((_h = contactCountByCompany[cid]) !== null && _h !== void 0 ? _h : 0) + 1;
                        if (contactsByCompany[cid].length < 10) {
                            contactsByCompany[cid].push({
                                first_name: (_j = c.first_name) !== null && _j !== void 0 ? _j : null,
                                last_name: (_k = c.last_name) !== null && _k !== void 0 ? _k : null,
                                position: (_l = c.position) !== null && _l !== void 0 ? _l : null,
                                project_id: (_m = c.project_id) !== null && _m !== void 0 ? _m : null,
                            });
                        }
                    }
                    _o.label = 3;
                case 3:
                    rows = rawRows.map(function (row) {
                        var _a, _b, _d, _e, _f, _g, _h, _j, _k;
                        var company = (_a = row.companies) !== null && _a !== void 0 ? _a : {};
                        var companyId = ((_b = company.id) !== null && _b !== void 0 ? _b : row.company_id);
                        var targets = (_d = row.hypothesis_targets) !== null && _d !== void 0 ? _d : [];
                        var hypotheses = targets
                            .map(function (t) { return t.hypotheses; })
                            .filter(function (h) { return h != null && typeof h.id === "string"; })
                            .map(function (h) { return ({ id: h.id, name: h.name }); });
                        return {
                            project_company_id: row.id,
                            company_id: companyId,
                            status: (_e = row.status) !== null && _e !== void 0 ? _e : null,
                            created_at: row.created_at,
                            name: (_f = company.name) !== null && _f !== void 0 ? _f : null,
                            domain: (_g = company.domain) !== null && _g !== void 0 ? _g : null,
                            linkedin_url: (_h = company.linkedin_url) !== null && _h !== void 0 ? _h : null,
                            tags: parseCompanyTagsColumn(company.tags),
                            hypotheses: hypotheses,
                            contact_count: (_j = contactCountByCompany[companyId]) !== null && _j !== void 0 ? _j : 0,
                            contacts_preview: (_k = contactsByCompany[companyId]) !== null && _k !== void 0 ? _k : [],
                        };
                    });
                    return [2 /*return*/, { data: rows, total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
/**
 * List hypotheses for a project with count of hypothesis_targets per hypothesis.
 */
function getHypothesesWithCounts(client, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error, rows;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.HYPOTHESES_TABLE)
                        .select("*, hypothesis_targets(count)")
                        .eq("project_id", projectId)
                        .order("created_at", { ascending: false })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    rows = (data !== null && data !== void 0 ? data : []).map(function (row) {
                        var _a, _b, _d;
                        var targets = row.hypothesis_targets;
                        var target_count = Array.isArray(targets) && targets.length > 0
                            ? (_a = targets[0].count) !== null && _a !== void 0 ? _a : 0
                            : 0;
                        return {
                            id: row.id,
                            project_id: row.project_id,
                            name: row.name,
                            description: (_b = row.description) !== null && _b !== void 0 ? _b : null,
                            target_persona: (_d = row.target_persona) !== null && _d !== void 0 ? _d : null,
                            created_at: row.created_at,
                            target_count: target_count,
                        };
                    });
                    return [2 /*return*/, { data: rows, error: null }];
            }
        });
    });
}
/**
 * List targets for a hypothesis, joined with project_companies -> companies.
 */
function getHypothesisTargets(client, hypothesisId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error, rows;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.HYPOTHESIS_TARGETS_TABLE)
                        .select("id, score, project_company_id, project_companies!inner(id, status, companies!inner(id, name, domain, linkedin_url))")
                        .eq("hypothesis_id", hypothesisId)
                        .order("score", { ascending: false })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    rows = (data !== null && data !== void 0 ? data : []).map(function (row) {
                        var _a, _b, _d, _e, _f, _g, _h, _j;
                        var pc = (_a = row.project_companies) !== null && _a !== void 0 ? _a : {};
                        var company = (_b = pc.companies) !== null && _b !== void 0 ? _b : {};
                        return {
                            id: row.id,
                            project_company_id: row.project_company_id,
                            score: (_d = row.score) !== null && _d !== void 0 ? _d : null,
                            company_id: (_e = company.id) !== null && _e !== void 0 ? _e : null,
                            name: (_f = company.name) !== null && _f !== void 0 ? _f : null,
                            domain: (_g = company.domain) !== null && _g !== void 0 ? _g : null,
                            linkedin_url: (_h = company.linkedin_url) !== null && _h !== void 0 ? _h : null,
                            status: (_j = pc.status) !== null && _j !== void 0 ? _j : null,
                        };
                    });
                    return [2 /*return*/, { data: rows, error: null }];
            }
        });
    });
}
/**
 * Create a new hypothesis for a project.
 */
function createHypothesis(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        var _b, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.HYPOTHESES_TABLE)
                        .insert({
                        project_id: payload.projectId,
                        name: payload.name,
                        description: (_b = payload.description) !== null && _b !== void 0 ? _b : null,
                        target_persona: (_d = payload.targetPersona) !== null && _d !== void 0 ? _d : null,
                    })
                        .select("id")
                        .single()];
                case 1:
                    _a = _e.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: { id: data.id }, error: null }];
            }
        });
    });
}
/**
 * Update fields on an existing hypothesis.
 */
function updateHypothesis(client, id, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var update, error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    update = {};
                    if (payload.name !== undefined)
                        update.name = payload.name;
                    if (payload.description !== undefined)
                        update.description = payload.description;
                    if (payload.targetPersona !== undefined)
                        update.target_persona = payload.targetPersona;
                    if (Object.keys(update).length === 0)
                        return [2 /*return*/, { error: null }];
                    return [4 /*yield*/, client.from(exports.HYPOTHESES_TABLE).update(update).eq("id", id)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
/**
 * Delete a hypothesis (cascade deletes hypothesis_targets if configured in DB, otherwise manual cleanup needed).
 */
function deleteHypothesis(client, id) {
    return __awaiter(this, void 0, void 0, function () {
        var error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client.from(exports.HYPOTHESES_TABLE).delete().eq("id", id)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
/**
 * Bulk add project companies to a hypothesis as targets with an optional score.
 */
function addCompaniesToHypothesis(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var rows, error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (payload.projectCompanyIds.length === 0)
                        return [2 /*return*/, { error: null }];
                    rows = payload.projectCompanyIds.map(function (pcId) {
                        var _a;
                        return ({
                            hypothesis_id: payload.hypothesisId,
                            project_company_id: pcId,
                            score: (_a = payload.score) !== null && _a !== void 0 ? _a : null,
                        });
                    });
                    return [4 /*yield*/, client.from(exports.HYPOTHESIS_TARGETS_TABLE).insert(rows)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
/**
 * Remove project companies from a hypothesis (delete hypothesis_targets rows).
 */
function removeCompaniesFromHypothesis(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var ids, error;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    ids = __spreadArray([], new Set(payload.projectCompanyIds), true).filter(Boolean);
                    if (ids.length === 0)
                        return [2 /*return*/, { error: null }];
                    return [4 /*yield*/, client
                            .from(exports.HYPOTHESIS_TARGETS_TABLE)
                            .delete()
                            .eq("hypothesis_id", payload.hypothesisId)
                            .in("project_company_id", ids)];
                case 1:
                    error = (_b.sent()).error;
                    return [2 /*return*/, { error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : null }];
            }
        });
    });
}
function getTableCounts(client) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, contactsRes, messagesRes, sendersRes, contacts, linkedin_messages, senders, e_3, message;
        var _b, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    _f.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, Promise.all([
                            client.from(exports.CONTACTS_TABLE).select("*", { count: "exact", head: true }),
                            client.from(exports.LINKEDIN_MESSAGES_TABLE).select("*", { count: "exact", head: true }),
                            client.from(exports.SENDERS_TABLE).select("*", { count: "exact", head: true }),
                        ])];
                case 1:
                    _a = _f.sent(), contactsRes = _a[0], messagesRes = _a[1], sendersRes = _a[2];
                    contacts = (_b = contactsRes.count) !== null && _b !== void 0 ? _b : 0;
                    linkedin_messages = (_d = messagesRes.count) !== null && _d !== void 0 ? _d : 0;
                    senders = (_e = sendersRes.count) !== null && _e !== void 0 ? _e : 0;
                    if (contactsRes.error)
                        return [2 /*return*/, { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: contactsRes.error.message }];
                    if (messagesRes.error)
                        return [2 /*return*/, { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: messagesRes.error.message }];
                    if (sendersRes.error)
                        return [2 /*return*/, { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: sendersRes.error.message }];
                    return [2 /*return*/, { counts: { contacts: contacts, linkedin_messages: linkedin_messages, senders: senders }, error: null }];
                case 2:
                    e_3 = _f.sent();
                    message = e_3 instanceof Error ? e_3.message : String(e_3);
                    return [2 /*return*/, { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: message }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
var DEFAULT_LATEST_LIMIT = 10;
/**
 * Returns the latest rows per table (by created_at desc) for visualization.
 * Used by /api/supabase-state so the UI can show what was recently updated.
 */
function getLatestRows(client_1) {
    return __awaiter(this, arguments, void 0, function (client, limit) {
        var n, _a, contactsRes, messagesRes, sendersRes, latest, e_4, message;
        var _b, _d, _e;
        if (limit === void 0) { limit = DEFAULT_LATEST_LIMIT; }
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    n = Math.min(Math.max(limit, 1), 100);
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, Promise.all([
                            client.from(exports.CONTACTS_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
                            client.from(exports.LINKEDIN_MESSAGES_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
                            client.from(exports.SENDERS_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
                        ])];
                case 2:
                    _a = _f.sent(), contactsRes = _a[0], messagesRes = _a[1], sendersRes = _a[2];
                    latest = {
                        contacts: (_b = contactsRes.data) !== null && _b !== void 0 ? _b : [],
                        linkedin_messages: (_d = messagesRes.data) !== null && _d !== void 0 ? _d : [],
                        senders: (_e = sendersRes.data) !== null && _e !== void 0 ? _e : [],
                    };
                    if (contactsRes.error)
                        return [2 /*return*/, { latest: latest, error: contactsRes.error.message }];
                    if (messagesRes.error)
                        return [2 /*return*/, { latest: latest, error: messagesRes.error.message }];
                    if (sendersRes.error)
                        return [2 /*return*/, { latest: latest, error: sendersRes.error.message }];
                    return [2 /*return*/, { latest: latest, error: null }];
                case 3:
                    e_4 = _f.sent();
                    message = e_4 instanceof Error ? e_4.message : String(e_4);
                    return [2 /*return*/, {
                            latest: { contacts: [], linkedin_messages: [], senders: [] },
                            error: message,
                        }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// --- Table query with filters (for /api/supabase-table-query) ---
exports.TABLE_KEY_TO_NAME = {
    contacts: exports.CONTACTS_TABLE,
    linkedin_messages: exports.LINKEDIN_MESSAGES_TABLE,
    senders: exports.SENDERS_TABLE,
};
/** Columns to search with ILIKE %term% per table (case-insensitive). */
exports.SEARCH_COLUMNS_BY_TABLE = {
    contacts: ["company_name", "first_name", "last_name", "position"],
    linkedin_messages: ["text"],
    senders: ["first_name", "last_name"],
};
/** Escape user input for use inside PostgREST ilike pattern (literal % and _; quote-safe). */
function escapeSearchTerm(term) {
    return term
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
}
function queryTableWithFilters(client, tableKey, params) {
    return __awaiter(this, void 0, void 0, function () {
        var tableName, limit, offset, query, _i, _a, _b, columnKey, raw, values, trimmed, searchTrimmed, columns, escaped, pattern_1, orClause, _d, data, error, count;
        var _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    tableName = exports.TABLE_KEY_TO_NAME[tableKey];
                    if (!tableName) {
                        return [2 /*return*/, { data: [], total: 0, error: "Unknown table: ".concat(tableKey) }];
                    }
                    limit = Math.min(Math.max((_e = params.limit) !== null && _e !== void 0 ? _e : 25, 1), 100);
                    offset = Math.max((_f = params.offset) !== null && _f !== void 0 ? _f : 0, 0);
                    query = client.from(tableName).select("*", { count: "exact" });
                    for (_i = 0, _a = Object.entries(params.filters); _i < _a.length; _i++) {
                        _b = _a[_i], columnKey = _b[0], raw = _b[1];
                        if (raw === null || raw === undefined)
                            continue;
                        values = Array.isArray(raw) ? raw : [raw];
                        trimmed = values.filter(function (v) { return v !== "" && v !== null && v !== undefined; });
                        if (trimmed.length === 0)
                            continue;
                        query = query.in(columnKey, trimmed);
                    }
                    searchTrimmed = typeof params.search === "string" ? params.search.trim().toLowerCase() : "";
                    if (searchTrimmed.length > 0) {
                        columns = exports.SEARCH_COLUMNS_BY_TABLE[tableKey];
                        if (columns && columns.length > 0) {
                            escaped = escapeSearchTerm(searchTrimmed);
                            pattern_1 = "%".concat(escaped, "%");
                            orClause = columns.map(function (col) { return "".concat(col, ".ilike.\"").concat(pattern_1, "\""); }).join(",");
                            query = query.or(orClause);
                        }
                    }
                    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
                    return [4 /*yield*/, query];
                case 1:
                    _d = _g.sent(), data = _d.data, error = _d.error, count = _d.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    return [2 /*return*/, { data: data !== null && data !== void 0 ? data : [], total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
function deriveConversationReplyTag(item) {
    if (item.outboxCount > 0 && item.inboxCount === 0)
        return "no_response";
    if (item.inboxCount > 0 && item.lastMessageIsOutbox)
        return "waiting_for_response";
    if (item.inboxCount > 0 && !item.lastMessageIsOutbox)
        return "got_response";
    if (item.inboxCount > 0)
        return "got_response";
    return "no_response";
}
var CONV_LIST_PAGE = 1000;
var CONV_LIST_MAX_PAGES = 200;
function getConversationsList(client, projectId, options) {
    return __awaiter(this, void 0, void 0, function () {
        function displayName(c, fallback) {
            if (!c)
                return fallback;
            if (typeof c.name === "string" && c.name.trim())
                return c.name.trim();
            var f = typeof c.first_name === "string" ? c.first_name.trim() : "";
            var l = typeof c.last_name === "string" ? c.last_name.trim() : "";
            if (f || l)
                return [f, l].filter(Boolean).join(" ");
            if (typeof c.label === "string" && c.label.trim())
                return c.label.trim();
            return fallback;
        }
        var rawMessages, page, from, to, _a, chunk, msgErr, rows, grouped, _i, rawMessages_1, msg, convId, leadUuids, senderUuids, contactMap, senderMap, contacts, _b, _d, c, senders, _e, _f, s, companyIds, hypothesisCountByCompany, pcRows, _g, _h, row, cid, targets, cnt, existing, allItems, _j, _k, _l, convId, group, msgs, inboxCount, outboxCount, lastMsg, lastAt, _m, msgs_1, m, t, at, lastMsgType, contact, sender, companyId, lastMessageIsOutbox, replyTag, searchRaw, filtered, tagFilter, offset, limit, total;
        var _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
        return __generator(this, function (_7) {
            switch (_7.label) {
                case 0:
                    rawMessages = [];
                    page = 0;
                    _7.label = 1;
                case 1:
                    if (!(page < CONV_LIST_MAX_PAGES)) return [3 /*break*/, 4];
                    from = page * CONV_LIST_PAGE;
                    to = from + CONV_LIST_PAGE - 1;
                    return [4 /*yield*/, client
                            .from(exports.LINKEDIN_MESSAGES_TABLE)
                            .select("linkedin_conversation_uuid, lead_uuid, sender_profile_uuid, text, sent_at, type, linkedin_type")
                            .eq("project_id", projectId)
                            .order("sent_at", { ascending: true })
                            .range(from, to)];
                case 2:
                    _a = _7.sent(), chunk = _a.data, msgErr = _a.error;
                    if (msgErr)
                        return [2 /*return*/, { data: [], total: 0, error: msgErr.message }];
                    rows = (chunk !== null && chunk !== void 0 ? chunk : []);
                    if (rows.length === 0)
                        return [3 /*break*/, 4];
                    rawMessages.push.apply(rawMessages, rows);
                    if (rows.length < CONV_LIST_PAGE)
                        return [3 /*break*/, 4];
                    _7.label = 3;
                case 3:
                    page++;
                    return [3 /*break*/, 1];
                case 4:
                    grouped = new Map();
                    for (_i = 0, rawMessages_1 = rawMessages; _i < rawMessages_1.length; _i++) {
                        msg = rawMessages_1[_i];
                        convId = msg["linkedin_conversation_uuid"];
                        if (!convId)
                            continue;
                        if (!grouped.has(convId)) {
                            grouped.set(convId, {
                                lead_uuid: (_o = msg["lead_uuid"]) !== null && _o !== void 0 ? _o : null,
                                sender_profile_uuid: (_p = msg["sender_profile_uuid"]) !== null && _p !== void 0 ? _p : null,
                                msgs: [],
                            });
                        }
                        grouped.get(convId).msgs.push(msg);
                    }
                    leadUuids = __spreadArray([], new Set(__spreadArray([], grouped.values(), true).map(function (g) { return g.lead_uuid; }).filter(Boolean)), true);
                    senderUuids = __spreadArray([], new Set(__spreadArray([], grouped.values(), true).map(function (g) { return g.sender_profile_uuid; }).filter(Boolean)), true);
                    contactMap = new Map();
                    senderMap = new Map();
                    if (!(leadUuids.length > 0)) return [3 /*break*/, 6];
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("uuid, first_name, last_name, name, position, company_name, avatar_url, company_id")
                            .in("uuid", leadUuids)];
                case 5:
                    contacts = (_7.sent()).data;
                    for (_b = 0, _d = (contacts !== null && contacts !== void 0 ? contacts : []); _b < _d.length; _b++) {
                        c = _d[_b];
                        if (c.uuid)
                            contactMap.set(c.uuid, c);
                    }
                    _7.label = 6;
                case 6:
                    if (!(senderUuids.length > 0)) return [3 /*break*/, 8];
                    return [4 /*yield*/, client
                            .from(exports.SENDERS_TABLE)
                            .select("uuid, first_name, last_name, label")
                            .in("uuid", senderUuids)];
                case 7:
                    senders = (_7.sent()).data;
                    for (_e = 0, _f = (senders !== null && senders !== void 0 ? senders : []); _e < _f.length; _e++) {
                        s = _f[_e];
                        if (s.uuid)
                            senderMap.set(s.uuid, s);
                    }
                    _7.label = 8;
                case 8:
                    companyIds = __spreadArray([], new Set(__spreadArray([], contactMap.values(), true).map(function (c) { return c.company_id; })
                        .filter(Boolean)), true);
                    hypothesisCountByCompany = new Map();
                    if (!(companyIds.length > 0)) return [3 /*break*/, 10];
                    return [4 /*yield*/, client
                            .from(exports.PROJECT_COMPANIES_TABLE)
                            .select("company_id, hypothesis_targets(count)")
                            .eq("project_id", projectId)
                            .in("company_id", companyIds)];
                case 9:
                    pcRows = (_7.sent()).data;
                    for (_g = 0, _h = (pcRows !== null && pcRows !== void 0 ? pcRows : []); _g < _h.length; _g++) {
                        row = _h[_g];
                        cid = row.company_id;
                        targets = row.hypothesis_targets;
                        cnt = Array.isArray(targets) && targets.length > 0
                            ? (_q = targets[0].count) !== null && _q !== void 0 ? _q : 0
                            : 0;
                        existing = (_r = hypothesisCountByCompany.get(cid)) !== null && _r !== void 0 ? _r : 0;
                        hypothesisCountByCompany.set(cid, existing + cnt);
                    }
                    _7.label = 10;
                case 10:
                    allItems = [];
                    for (_j = 0, _k = grouped.entries(); _j < _k.length; _j++) {
                        _l = _k[_j], convId = _l[0], group = _l[1];
                        msgs = group.msgs;
                        inboxCount = 0;
                        outboxCount = 0;
                        lastMsg = null;
                        lastAt = null;
                        for (_m = 0, msgs_1 = msgs; _m < msgs_1.length; _m++) {
                            m = msgs_1[_m];
                            t = String((_t = (_s = m["type"]) !== null && _s !== void 0 ? _s : m["linkedin_type"]) !== null && _t !== void 0 ? _t : "").toLowerCase();
                            if (t === "inbox")
                                inboxCount++;
                            else if (t === "outbox")
                                outboxCount++;
                            at = m["sent_at"];
                            if (at && (!lastAt || at > lastAt)) {
                                lastAt = at;
                                lastMsg = m;
                            }
                        }
                        lastMsgType = lastMsg
                            ? String((_v = (_u = lastMsg["type"]) !== null && _u !== void 0 ? _u : lastMsg["linkedin_type"]) !== null && _v !== void 0 ? _v : "").toLowerCase()
                            : "";
                        contact = group.lead_uuid ? (_w = contactMap.get(group.lead_uuid)) !== null && _w !== void 0 ? _w : null : null;
                        sender = group.sender_profile_uuid ? (_x = senderMap.get(group.sender_profile_uuid)) !== null && _x !== void 0 ? _x : null : null;
                        companyId = contact ? ((_y = contact.company_id) !== null && _y !== void 0 ? _y : null) : null;
                        lastMessageIsOutbox = lastMsgType === "outbox";
                        replyTag = deriveConversationReplyTag({
                            inboxCount: inboxCount,
                            outboxCount: outboxCount,
                            lastMessageIsOutbox: lastMessageIsOutbox,
                        });
                        allItems.push({
                            conversationUuid: convId,
                            leadUuid: group.lead_uuid,
                            senderProfileUuid: group.sender_profile_uuid,
                            senderDisplayName: displayName(sender, "Unknown Sender"),
                            receiverDisplayName: displayName(contact, group.lead_uuid ? group.lead_uuid.slice(0, 8) + "…" : "Unknown"),
                            receiverTitle: contact ? ((_z = contact.position) !== null && _z !== void 0 ? _z : null) : null,
                            receiverCompanyName: contact ? ((_0 = contact.company_name) !== null && _0 !== void 0 ? _0 : null) : null,
                            receiverAvatarUrl: contact ? ((_1 = contact.avatar_url) !== null && _1 !== void 0 ? _1 : null) : null,
                            receiverCompanyId: companyId,
                            lastMessageText: lastMsg ? ((_2 = lastMsg.text) !== null && _2 !== void 0 ? _2 : null) : null,
                            lastMessageAt: lastAt,
                            messageCount: msgs.length,
                            inboxCount: inboxCount,
                            outboxCount: outboxCount,
                            lastMessageIsOutbox: lastMessageIsOutbox,
                            hypothesisCount: companyId ? ((_3 = hypothesisCountByCompany.get(companyId)) !== null && _3 !== void 0 ? _3 : 0) : 0,
                            replyTag: replyTag,
                        });
                    }
                    // Sort by lastMessageAt desc
                    allItems.sort(function (a, b) {
                        var _a, _b;
                        var da = (_a = a.lastMessageAt) !== null && _a !== void 0 ? _a : "";
                        var db = (_b = b.lastMessageAt) !== null && _b !== void 0 ? _b : "";
                        return db.localeCompare(da);
                    });
                    searchRaw = typeof (options === null || options === void 0 ? void 0 : options.search) === "string" ? options.search.trim().toLowerCase() : "";
                    filtered = allItems;
                    if (searchRaw.length > 0) {
                        filtered = allItems.filter(function (c) {
                            var _a, _b;
                            return c.receiverDisplayName.toLowerCase().includes(searchRaw) ||
                                c.senderDisplayName.toLowerCase().includes(searchRaw) ||
                                ((_a = c.receiverCompanyName) !== null && _a !== void 0 ? _a : "").toLowerCase().includes(searchRaw) ||
                                ((_b = c.lastMessageText) !== null && _b !== void 0 ? _b : "").toLowerCase().includes(searchRaw);
                        });
                    }
                    tagFilter = (_4 = options === null || options === void 0 ? void 0 : options.replyTag) !== null && _4 !== void 0 ? _4 : null;
                    if (tagFilter) {
                        filtered = filtered.filter(function (c) { return c.replyTag === tagFilter; });
                    }
                    offset = (_5 = options === null || options === void 0 ? void 0 : options.offset) !== null && _5 !== void 0 ? _5 : 0;
                    limit = Math.min((_6 = options === null || options === void 0 ? void 0 : options.limit) !== null && _6 !== void 0 ? _6 : 50, 200);
                    total = filtered.length;
                    return [2 /*return*/, { data: filtered.slice(offset, offset + limit), total: total, error: null }];
            }
        });
    });
}
// ── Company Hypotheses ────────────────────────────────────────────────────────
function getCompanyHypotheses(client, companyId, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, pcRows, pcErr, pc, projectCompanyId, _b, targets, tErr, hypotheses;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.PROJECT_COMPANIES_TABLE)
                        .select("id")
                        .eq("company_id", companyId)
                        .eq("project_id", projectId)
                        .limit(1)];
                case 1:
                    _a = _d.sent(), pcRows = _a.data, pcErr = _a.error;
                    if (pcErr)
                        return [2 /*return*/, { data: [], projectCompanyId: null, error: pcErr.message }];
                    pc = (pcRows !== null && pcRows !== void 0 ? pcRows : [])[0];
                    if (!pc)
                        return [2 /*return*/, { data: [], projectCompanyId: null, error: null }];
                    projectCompanyId = pc.id;
                    return [4 /*yield*/, client
                            .from(exports.HYPOTHESIS_TARGETS_TABLE)
                            .select("hypotheses(id, name)")
                            .eq("project_company_id", projectCompanyId)];
                case 2:
                    _b = _d.sent(), targets = _b.data, tErr = _b.error;
                    if (tErr)
                        return [2 /*return*/, { data: [], projectCompanyId: projectCompanyId, error: tErr.message }];
                    hypotheses = (targets !== null && targets !== void 0 ? targets : [])
                        .map(function (t) { return t.hypotheses; })
                        .filter(function (h) { return h != null && typeof h.id === "string"; })
                        .map(function (h) { return ({ id: h.id, name: h.name }); });
                    return [2 /*return*/, { data: hypotheses, projectCompanyId: projectCompanyId, error: null }];
            }
        });
    });
}
function getContactsByCompany(client, companyId, projectId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, contacts, cErr, contactRows, leadUuids, msgs, convsByLead, _i, _b, m, lu, cu, convMap, entry, at, result;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.CONTACTS_TABLE)
                        .select("uuid, first_name, last_name, name, position, avatar_url, company_id")
                        .eq("company_id", companyId)
                        .eq("project_id", projectId)
                        .order("created_at", { ascending: false })
                        .limit(50)];
                case 1:
                    _a = _d.sent(), contacts = _a.data, cErr = _a.error;
                    if (cErr)
                        return [2 /*return*/, { data: [], error: cErr.message }];
                    contactRows = (contacts !== null && contacts !== void 0 ? contacts : []);
                    if (contactRows.length === 0)
                        return [2 /*return*/, { data: [], error: null }];
                    leadUuids = contactRows.map(function (c) { return c.uuid; }).filter(Boolean);
                    return [4 /*yield*/, client
                            .from(exports.LINKEDIN_MESSAGES_TABLE)
                            .select("lead_uuid, linkedin_conversation_uuid, sent_at")
                            .in("lead_uuid", leadUuids)
                            .eq("project_id", projectId)
                            .order("sent_at", { ascending: false })
                            .limit(2000)];
                case 2:
                    msgs = (_d.sent()).data;
                    convsByLead = new Map();
                    for (_i = 0, _b = (msgs !== null && msgs !== void 0 ? msgs : []); _i < _b.length; _i++) {
                        m = _b[_i];
                        lu = m["lead_uuid"];
                        cu = m["linkedin_conversation_uuid"];
                        if (!lu || !cu)
                            continue;
                        if (!convsByLead.has(lu))
                            convsByLead.set(lu, new Map());
                        convMap = convsByLead.get(lu);
                        if (!convMap.has(cu))
                            convMap.set(cu, { count: 0, lastAt: null });
                        entry = convMap.get(cu);
                        entry.count++;
                        at = m["sent_at"];
                        if (at && (!entry.lastAt || at > entry.lastAt))
                            entry.lastAt = at;
                    }
                    result = contactRows.map(function (c) {
                        var _a, _b, _d, _e, _f, _g, _h;
                        var uuid = c.uuid;
                        var convMap = (_a = convsByLead.get(uuid)) !== null && _a !== void 0 ? _a : new Map();
                        var conversations = __spreadArray([], convMap.entries(), true).map(function (_a) {
                            var convId = _a[0], info = _a[1];
                            return ({ conversationUuid: convId, messageCount: info.count, lastMessageAt: info.lastAt });
                        })
                            .sort(function (a, b) { var _a, _b; return ((_a = b.lastMessageAt) !== null && _a !== void 0 ? _a : "").localeCompare((_b = a.lastMessageAt) !== null && _b !== void 0 ? _b : ""); });
                        return {
                            uuid: uuid,
                            first_name: (_b = c.first_name) !== null && _b !== void 0 ? _b : null,
                            last_name: (_d = c.last_name) !== null && _d !== void 0 ? _d : null,
                            name: (_e = c.name) !== null && _e !== void 0 ? _e : null,
                            position: (_f = c.position) !== null && _f !== void 0 ? _f : null,
                            avatar_url: (_g = c.avatar_url) !== null && _g !== void 0 ? _g : null,
                            company_id: (_h = c.company_id) !== null && _h !== void 0 ? _h : null,
                            conversations: conversations,
                        };
                    });
                    return [2 /*return*/, { data: result, error: null }];
            }
        });
    });
}
function getContextSnapshots(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var limit, offset, _a, data, error, count;
        var _b, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    limit = Math.min((_b = params.limit) !== null && _b !== void 0 ? _b : 50, 200);
                    offset = (_d = params.offset) !== null && _d !== void 0 ? _d : 0;
                    return [4 /*yield*/, client
                            .from(exports.CONTEXT_SNAPSHOTS_TABLE)
                            .select("*", { count: "exact" })
                            .eq("project_id", params.projectId)
                            .order("created_at", { ascending: false })
                            .range(offset, offset + limit - 1)];
                case 1:
                    _a = _e.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
function getContextSnapshotById(client, snapshotId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.CONTEXT_SNAPSHOTS_TABLE)
                        .select("*")
                        .eq("id", snapshotId)
                        .maybeSingle()];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: (_b = data) !== null && _b !== void 0 ? _b : null, error: null }];
            }
        });
    });
}
function saveContextSnapshot(client, params) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.CONTEXT_SNAPSHOTS_TABLE)
                        .insert({
                        project_id: params.projectId,
                        name: (_b = params.name) !== null && _b !== void 0 ? _b : null,
                        nodes: params.nodes,
                        context_text: params.contextText,
                    })
                        .select()
                        .single()];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: null, error: error.message }];
                    return [2 /*return*/, { data: data, error: null }];
            }
        });
    });
}
// ── Enrichment (agents, queue, runs, results) ────────────────────────────────
exports.ENRICHMENT_AGENTS_TABLE = "enrichment_agents";
exports.ENRICHMENT_QUEUE_TASKS_TABLE = "enrichment_queue_tasks";
exports.ENRICHMENT_AGENT_RUNS_TABLE = "enrichment_agent_runs";
exports.ENRICHMENT_AGENT_RESULTS_TABLE = "enrichment_agent_results";
function enrichmentEntityKey(entityId, agentName) {
    return "".concat(entityId, "::").concat(agentName);
}
function workerNameFromRun(run) {
    var meta = run.meta;
    if (meta && typeof meta.worker_name === "string") {
        var w = meta.worker_name.trim();
        if (w)
            return w;
    }
    var inp = run.input;
    if (inp && typeof inp.worker_name === "string") {
        var w = inp.worker_name.trim();
        if (w)
            return w;
    }
    return null;
}
/**
 * Derive per-cell status from latest queue row, optional result row, and latest run.
 */
function deriveEnrichmentCellState(task, result, run) {
    var _a, _b, _d, _e, _f;
    if (task) {
        if (task.status === "queued") {
            return {
                status: "queued",
                updatedAt: task.updated_at,
                workerName: null,
            };
        }
        if (task.status === "running") {
            var cb = (_a = task.claimed_by) === null || _a === void 0 ? void 0 : _a.trim();
            return {
                status: "running",
                updatedAt: task.updated_at,
                workerName: cb || (run ? workerNameFromRun(run) : null) || null,
            };
        }
        if (task.status === "error") {
            return {
                status: "error",
                updatedAt: task.updated_at,
                error: (_b = task.last_error) !== null && _b !== void 0 ? _b : null,
            };
        }
        if (task.status === "done") {
            if (result) {
                return {
                    status: "success",
                    updatedAt: result.updated_at,
                    resultPreview: result.agent_result,
                };
            }
            return { status: "success", updatedAt: task.updated_at };
        }
    }
    if (result) {
        return {
            status: "success",
            updatedAt: result.updated_at,
            resultPreview: result.agent_result,
        };
    }
    if (run) {
        if (run.status === "running") {
            return {
                status: "running",
                updatedAt: run.started_at,
                workerName: workerNameFromRun(run),
            };
        }
        if (run.status === "error") {
            return {
                status: "error",
                updatedAt: (_d = run.finished_at) !== null && _d !== void 0 ? _d : run.started_at,
                error: (_e = run.error) !== null && _e !== void 0 ? _e : null,
            };
        }
        if (run.status === "success") {
            return {
                status: "success",
                updatedAt: (_f = run.finished_at) !== null && _f !== void 0 ? _f : run.started_at,
                resultPreview: undefined,
            };
        }
    }
    return { status: "planned", updatedAt: null };
}
/** All rows in `enrichment_agents` (including inactive), for admin UI. */
function listAllEnrichmentAgents(client) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.ENRICHMENT_AGENTS_TABLE)
                        .select("name, entity_type, operation_name, is_active, created_at")
                        .order("name", { ascending: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), error: null }];
            }
        });
    });
}
function createEnrichmentAgent(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var name, et, error;
        var _a, _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    name = (_a = payload.name) === null || _a === void 0 ? void 0 : _a.trim();
                    if (!name)
                        return [2 /*return*/, { error: "name is required" }];
                    et = payload.entity_type;
                    if (et !== "company" && et !== "contact" && et !== "both") {
                        return [2 /*return*/, { error: "entity_type must be company, contact, or both" }];
                    }
                    return [4 /*yield*/, client.from(exports.ENRICHMENT_AGENTS_TABLE).insert({
                            name: name,
                            entity_type: et,
                            operation_name: ((_b = payload.operation_name) === null || _b === void 0 ? void 0 : _b.trim()) || null,
                            is_active: payload.is_active !== false,
                        })];
                case 1:
                    error = (_d.sent()).error;
                    if (error)
                        return [2 /*return*/, { error: error.message }];
                    return [2 /*return*/, { error: null }];
            }
        });
    });
}
function updateEnrichmentAgent(client, agentName, patch) {
    return __awaiter(this, void 0, void 0, function () {
        var name, updates, et, error;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    name = agentName === null || agentName === void 0 ? void 0 : agentName.trim();
                    if (!name)
                        return [2 /*return*/, { error: "name is required" }];
                    updates = {};
                    if (patch.entity_type !== undefined) {
                        et = patch.entity_type;
                        if (et !== "company" && et !== "contact" && et !== "both") {
                            return [2 /*return*/, { error: "entity_type must be company, contact, or both" }];
                        }
                        updates.entity_type = et;
                    }
                    if (patch.operation_name !== undefined) {
                        updates.operation_name =
                            patch.operation_name === null || patch.operation_name === ""
                                ? null
                                : String(patch.operation_name).trim();
                    }
                    if (patch.is_active !== undefined) {
                        updates.is_active = Boolean(patch.is_active);
                    }
                    if (Object.keys(updates).length === 0) {
                        return [2 /*return*/, { error: "No fields to update" }];
                    }
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_AGENTS_TABLE)
                            .update(updates)
                            .eq("name", name)];
                case 1:
                    error = (_a.sent()).error;
                    if (error)
                        return [2 /*return*/, { error: error.message }];
                    return [2 /*return*/, { error: null }];
            }
        });
    });
}
/**
 * Active enrichment agents for a base entity type (includes `both`).
 */
function listEnrichmentAgentsForEntityType(client, entityType) {
    return __awaiter(this, void 0, void 0, function () {
        var allowed, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    allowed = entityType === "company"
                        ? ["company", "both"]
                        : ["contact", "both"];
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_AGENTS_TABLE)
                            .select("name, entity_type, operation_name, is_active")
                            .eq("is_active", true)
                            .in("entity_type", allowed)
                            .order("name", { ascending: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, { data: [], error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), error: null }];
            }
        });
    });
}
function getContactsForProjectPage(client, projectId, limit, offset) {
    return __awaiter(this, void 0, void 0, function () {
        var lim, off, _a, data, error, count;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    lim = Math.min(Math.max(limit, 1), 100);
                    off = Math.max(offset, 0);
                    return [4 /*yield*/, client
                            .from(exports.CONTACTS_TABLE)
                            .select("*", { count: "exact" })
                            .eq("project_id", projectId)
                            .order("created_at", { ascending: false })
                            .range(off, off + lim - 1)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
function runRecencyMs(run) {
    if (run.finished_at)
        return new Date(run.finished_at).getTime();
    return new Date(run.started_at).getTime();
}
/**
 * Error messages for the Enrichment summary: only from the **current** outcome per agent
 * (latest queue task vs latest run by time). Older failed runs/tasks after a restart+success are ignored.
 */
function collectErrorSamplesForEntity(entityId, entityType, tasks, runs) {
    var _a, _b;
    var entityTasks = tasks.filter(function (t) {
        var eid = entityType === "company" ? t.company_id : t.contact_id;
        return eid === entityId;
    });
    var entityRuns = runs.filter(function (r) {
        var eid = entityType === "company" ? r.company_id : r.contact_id;
        return eid === entityId;
    });
    var agentNames = new Set();
    for (var _i = 0, entityTasks_1 = entityTasks; _i < entityTasks_1.length; _i++) {
        var t = entityTasks_1[_i];
        agentNames.add(t.agent_name);
    }
    for (var _d = 0, entityRuns_1 = entityRuns; _d < entityRuns_1.length; _d++) {
        var r = entityRuns_1[_d];
        agentNames.add(r.agent_name);
    }
    var messages = [];
    var _loop_1 = function (agentName) {
        var agentTasks = entityTasks.filter(function (t) { return t.agent_name === agentName; });
        var agentRuns = entityRuns.filter(function (r) { return r.agent_name === agentName; });
        var latestTask = agentTasks.length === 0
            ? undefined
            : agentTasks.reduce(function (a, b) {
                return new Date(a.updated_at).getTime() >= new Date(b.updated_at).getTime() ? a : b;
            });
        var latestRun = agentRuns.length === 0
            ? undefined
            : agentRuns.reduce(function (a, b) { return (runRecencyMs(b) >= runRecencyMs(a) ? b : a); });
        var taskMs = latestTask ? new Date(latestTask.updated_at).getTime() : -1;
        var runMs = latestRun ? runRecencyMs(latestRun) : -1;
        var preferTask = latestTask && (!latestRun || taskMs >= runMs);
        if (preferTask && latestTask) {
            if (latestTask.status === "error") {
                var err = ((_a = latestTask.last_error) !== null && _a !== void 0 ? _a : "").trim();
                if (err)
                    messages.push(err);
            }
        }
        else if (latestRun) {
            if (latestRun.status === "error") {
                var err = ((_b = latestRun.error) !== null && _b !== void 0 ? _b : "").trim();
                if (err)
                    messages.push(err);
            }
        }
    };
    for (var _e = 0, agentNames_1 = agentNames; _e < agentNames_1.length; _e++) {
        var agentName = agentNames_1[_e];
        _loop_1(agentName);
    }
    var seen = new Set();
    var out = [];
    for (var _f = 0, messages_1 = messages; _f < messages_1.length; _f++) {
        var m = messages_1[_f];
        if (seen.has(m))
            continue;
        seen.add(m);
        out.push(m);
        if (out.length >= 16)
            break;
    }
    return out;
}
function buildEnrichmentRunStatsForEntity(entityId, entityType, tasks, runs) {
    var entityRuns = runs.filter(function (r) {
        var eid = entityType === "company" ? r.company_id : r.contact_id;
        return eid === entityId;
    });
    var runsSuccess = 0;
    var runsError = 0;
    var runsRunning = 0;
    for (var _i = 0, entityRuns_2 = entityRuns; _i < entityRuns_2.length; _i++) {
        var r = entityRuns_2[_i];
        if (r.status === "success")
            runsSuccess++;
        else if (r.status === "error")
            runsError++;
        else if (r.status === "running")
            runsRunning++;
    }
    var queueQueued = 0;
    var queueRunning = 0;
    for (var _a = 0, tasks_1 = tasks; _a < tasks_1.length; _a++) {
        var t = tasks_1[_a];
        var eid = entityType === "company" ? t.company_id : t.contact_id;
        if (eid !== entityId)
            continue;
        if (t.status === "queued")
            queueQueued++;
        else if (t.status === "running")
            queueRunning++;
    }
    return {
        totalRuns: entityRuns.length,
        runsSuccess: runsSuccess,
        runsError: runsError,
        runsRunning: runsRunning,
        queueQueued: queueQueued,
        queueRunning: queueRunning,
        errorSamples: collectErrorSamplesForEntity(entityId, entityType, tasks, runs),
    };
}
/**
 * Paginated enrichment table: project companies or contacts plus merged agent column states.
 */
function getEnrichmentTableData(client, projectId, entityType, limit, offset) {
    return __awaiter(this, void 0, void 0, function () {
        var lim, off, baseRows, total, baseError, pc, c, entityIds, agentsRes_1, agentNames_3, idColumn, _a, agentsRes, tasksRes, runsRes, resultsRes, err, tasks, runs, results, nameSet, _i, _b, a, _d, tasks_2, t, _e, runs_1, r, _f, results_1, r, agentNames, latestTask, _g, tasks_3, t, eid, k, prev, latestRun, _h, runs_2, r, eid, k, prev, tNew, tPrev, resultByKey, _j, results_2, r, eid, k, rows, _k, baseRows_1, row, entityId, agentStates, _l, agentNames_2, agentName, k, runStats;
        var _m, _o, _p, _q, _r, _s, _t, _u, _v;
        return __generator(this, function (_w) {
            switch (_w.label) {
                case 0:
                    lim = Math.min(Math.max(limit, 1), 100);
                    off = Math.max(offset, 0);
                    baseRows = [];
                    total = 0;
                    baseError = null;
                    if (!(entityType === "company")) return [3 /*break*/, 2];
                    return [4 /*yield*/, getProjectCompanies(client, projectId, { limit: lim, offset: off })];
                case 1:
                    pc = _w.sent();
                    baseError = pc.error;
                    total = pc.total;
                    baseRows = pc.data.map(function (r) { return ({
                        project_company_id: r.project_company_id,
                        company_id: r.company_id,
                        status: r.status,
                        created_at: r.created_at,
                        name: r.name,
                        domain: r.domain,
                        linkedin_url: r.linkedin_url,
                        tags: r.tags,
                        hypotheses: r.hypotheses,
                        contact_count: r.contact_count,
                        contacts_preview: r.contacts_preview,
                    }); });
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, getContactsForProjectPage(client, projectId, lim, off)];
                case 3:
                    c = _w.sent();
                    baseError = c.error;
                    total = c.total;
                    baseRows = c.data;
                    _w.label = 4;
                case 4:
                    if (baseError) {
                        return [2 /*return*/, { total: 0, agentNames: [], rows: [], error: baseError }];
                    }
                    entityIds = baseRows
                        .map(function (row) {
                        return entityType === "company"
                            ? row.company_id
                            : row.uuid;
                    })
                        .filter(function (id) { return typeof id === "string" && id.length > 0; });
                    if (!(entityIds.length === 0)) return [3 /*break*/, 6];
                    return [4 /*yield*/, listEnrichmentAgentsForEntityType(client, entityType)];
                case 5:
                    agentsRes_1 = _w.sent();
                    agentNames_3 = agentsRes_1.data.map(function (a) { return a.name; });
                    return [2 /*return*/, {
                            total: total,
                            agentNames: agentNames_3,
                            rows: [],
                            error: agentsRes_1.error,
                        }];
                case 6:
                    idColumn = entityType === "company" ? "company_id" : "contact_id";
                    return [4 /*yield*/, Promise.all([
                            listEnrichmentAgentsForEntityType(client, entityType),
                            client
                                .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .in(idColumn, entityIds),
                            client
                                .from(exports.ENRICHMENT_AGENT_RUNS_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .in(idColumn, entityIds),
                            client
                                .from(exports.ENRICHMENT_AGENT_RESULTS_TABLE)
                                .select("*")
                                .eq("project_id", projectId)
                                .in(idColumn, entityIds),
                        ])];
                case 7:
                    _a = _w.sent(), agentsRes = _a[0], tasksRes = _a[1], runsRes = _a[2], resultsRes = _a[3];
                    if (tasksRes.error || runsRes.error || resultsRes.error) {
                        err = (_s = (_q = (_o = (_m = tasksRes.error) === null || _m === void 0 ? void 0 : _m.message) !== null && _o !== void 0 ? _o : (_p = runsRes.error) === null || _p === void 0 ? void 0 : _p.message) !== null && _q !== void 0 ? _q : (_r = resultsRes.error) === null || _r === void 0 ? void 0 : _r.message) !== null && _s !== void 0 ? _s : "enrichment fetch failed";
                        return [2 /*return*/, { total: total, agentNames: [], rows: [], error: err }];
                    }
                    tasks = ((_t = tasksRes.data) !== null && _t !== void 0 ? _t : []);
                    runs = ((_u = runsRes.data) !== null && _u !== void 0 ? _u : []);
                    results = ((_v = resultsRes.data) !== null && _v !== void 0 ? _v : []);
                    nameSet = new Set();
                    for (_i = 0, _b = agentsRes.data; _i < _b.length; _i++) {
                        a = _b[_i];
                        nameSet.add(a.name);
                    }
                    for (_d = 0, tasks_2 = tasks; _d < tasks_2.length; _d++) {
                        t = tasks_2[_d];
                        nameSet.add(t.agent_name);
                    }
                    for (_e = 0, runs_1 = runs; _e < runs_1.length; _e++) {
                        r = runs_1[_e];
                        nameSet.add(r.agent_name);
                    }
                    for (_f = 0, results_1 = results; _f < results_1.length; _f++) {
                        r = results_1[_f];
                        nameSet.add(r.agent_name);
                    }
                    agentNames = __spreadArray([], nameSet, true).sort(function (a, b) { return a.localeCompare(b); });
                    latestTask = new Map();
                    for (_g = 0, tasks_3 = tasks; _g < tasks_3.length; _g++) {
                        t = tasks_3[_g];
                        eid = entityType === "company" ? t.company_id : t.contact_id;
                        if (!eid)
                            continue;
                        k = enrichmentEntityKey(eid, t.agent_name);
                        prev = latestTask.get(k);
                        if (!prev ||
                            new Date(t.updated_at).getTime() > new Date(prev.updated_at).getTime()) {
                            latestTask.set(k, t);
                        }
                    }
                    latestRun = new Map();
                    for (_h = 0, runs_2 = runs; _h < runs_2.length; _h++) {
                        r = runs_2[_h];
                        eid = entityType === "company" ? r.company_id : r.contact_id;
                        if (!eid)
                            continue;
                        k = enrichmentEntityKey(eid, r.agent_name);
                        prev = latestRun.get(k);
                        tNew = new Date(r.started_at).getTime();
                        tPrev = prev ? new Date(prev.started_at).getTime() : 0;
                        if (!prev || tNew > tPrev)
                            latestRun.set(k, r);
                    }
                    resultByKey = new Map();
                    for (_j = 0, results_2 = results; _j < results_2.length; _j++) {
                        r = results_2[_j];
                        eid = entityType === "company" ? r.company_id : r.contact_id;
                        if (!eid)
                            continue;
                        k = enrichmentEntityKey(eid, r.agent_name);
                        resultByKey.set(k, r);
                    }
                    rows = [];
                    for (_k = 0, baseRows_1 = baseRows; _k < baseRows_1.length; _k++) {
                        row = baseRows_1[_k];
                        entityId = entityType === "company"
                            ? row.company_id
                            : row.uuid;
                        if (!entityId)
                            continue;
                        agentStates = {};
                        for (_l = 0, agentNames_2 = agentNames; _l < agentNames_2.length; _l++) {
                            agentName = agentNames_2[_l];
                            k = enrichmentEntityKey(entityId, agentName);
                            agentStates[agentName] = deriveEnrichmentCellState(latestTask.get(k), resultByKey.get(k), latestRun.get(k));
                        }
                        runStats = buildEnrichmentRunStatsForEntity(entityId, entityType, tasks, runs);
                        rows.push({ entity: row, agentStates: agentStates, runStats: runStats });
                    }
                    return [2 /*return*/, {
                            total: total,
                            agentNames: agentNames,
                            rows: rows,
                            error: agentsRes.error,
                        }];
            }
        });
    });
}
/**
 * Enqueue enrichment tasks (one queue row per entity id).
 */
function enqueueEnrichmentTasks(client, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var projectId, entityType, agentName, ids, unique, _a, agentRow, agentErr, et, active, op, meta, rowsToInsert, insErr;
        var _b, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    projectId = payload.projectId, entityType = payload.entityType, agentName = payload.agentName;
                    ids = entityType === "company"
                        ? (_b = payload.companyIds) !== null && _b !== void 0 ? _b : []
                        : (_d = payload.contactIds) !== null && _d !== void 0 ? _d : [];
                    unique = __spreadArray([], new Set(ids.map(function (id) { return id === null || id === void 0 ? void 0 : id.trim(); }).filter(Boolean)), true);
                    if (unique.length === 0) {
                        return [2 /*return*/, { inserted: 0, error: "No entity ids provided" }];
                    }
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_AGENTS_TABLE)
                            .select("name, entity_type, is_active")
                            .eq("name", agentName)
                            .maybeSingle()];
                case 1:
                    _a = _g.sent(), agentRow = _a.data, agentErr = _a.error;
                    if (agentErr)
                        return [2 /*return*/, { inserted: 0, error: agentErr.message }];
                    if (!agentRow)
                        return [2 /*return*/, { inserted: 0, error: "Unknown agent: ".concat(agentName) }];
                    et = agentRow.entity_type;
                    active = agentRow.is_active;
                    if (!active)
                        return [2 /*return*/, { inserted: 0, error: "Agent is inactive: ".concat(agentName) }];
                    if (et !== "both" && et !== entityType) {
                        return [2 /*return*/, {
                                inserted: 0,
                                error: "Agent \"".concat(agentName, "\" is not valid for entity type ").concat(entityType),
                            }];
                    }
                    op = (_e = payload.operationName) !== null && _e !== void 0 ? _e : null;
                    meta = (_f = payload.meta) !== null && _f !== void 0 ? _f : {};
                    rowsToInsert = unique.map(function (id) {
                        if (entityType === "company") {
                            return {
                                project_id: projectId,
                                agent_name: agentName,
                                operation_name: op,
                                company_id: id,
                                contact_id: null,
                                meta: meta,
                                status: "queued",
                            };
                        }
                        return {
                            project_id: projectId,
                            agent_name: agentName,
                            operation_name: op,
                            company_id: null,
                            contact_id: id,
                            meta: meta,
                            status: "queued",
                        };
                    });
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                            .insert(rowsToInsert)];
                case 2:
                    insErr = (_g.sent()).error;
                    if (insErr)
                        return [2 /*return*/, { inserted: 0, error: insErr.message }];
                    return [2 /*return*/, { inserted: unique.length, error: null }];
            }
        });
    });
}
var QUEUE_STATUS_SET = new Set(["queued", "running", "done", "error", "cancelled"]);
var RUN_STATUS_SET = new Set(["running", "success", "error"]);
/**
 * Paginated queue tasks for a project (newest first).
 */
function listEnrichmentQueueTasksForProject(client, projectId, options) {
    return __awaiter(this, void 0, void 0, function () {
        var lim, off, st, q, _a, data, error, count;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    lim = Math.min(Math.max(options.limit, 1), 100);
                    off = Math.max(options.offset, 0);
                    st = (_b = options.status) === null || _b === void 0 ? void 0 : _b.trim();
                    q = client
                        .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                        .select("*", { count: "exact" })
                        .eq("project_id", projectId)
                        .order("updated_at", { ascending: false })
                        .range(off, off + lim - 1);
                    if (st && QUEUE_STATUS_SET.has(st)) {
                        q = q.eq("status", st);
                    }
                    return [4 /*yield*/, q];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
/**
 * Paginated agent runs for a project (newest first).
 */
function listEnrichmentAgentRunsForProject(client, projectId, options) {
    return __awaiter(this, void 0, void 0, function () {
        var lim, off, st, q, _a, data, error, count;
        var _b;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    lim = Math.min(Math.max(options.limit, 1), 100);
                    off = Math.max(options.offset, 0);
                    st = (_b = options.status) === null || _b === void 0 ? void 0 : _b.trim();
                    q = client
                        .from(exports.ENRICHMENT_AGENT_RUNS_TABLE)
                        .select("*", { count: "exact" })
                        .eq("project_id", projectId)
                        .order("started_at", { ascending: false })
                        .range(off, off + lim - 1);
                    if (st && RUN_STATUS_SET.has(st)) {
                        q = q.eq("status", st);
                    }
                    return [4 /*yield*/, q];
                case 1:
                    _a = _d.sent(), data = _a.data, error = _a.error, count = _a.count;
                    if (error)
                        return [2 /*return*/, { data: [], total: 0, error: error.message }];
                    return [2 /*return*/, { data: (data !== null && data !== void 0 ? data : []), total: count !== null && count !== void 0 ? count : 0, error: null }];
            }
        });
    });
}
/**
 * Stop a queued or running task (cancel queue row; mark active run as error).
 */
function stopEnrichmentQueueTask(client, projectId, taskId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, row, fetchErr, task, st, nowIso, error, runningUpdate, error, _c, withoutClaimed, r2;
        var _b, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                        .select("*")
                        .eq("id", taskId)
                        .eq("project_id", projectId)
                        .maybeSingle()];
                case 1:
                    _a = _e.sent(), row = _a.data, fetchErr = _a.error;
                    if (fetchErr)
                        return [2 /*return*/, { ok: false, error: fetchErr.message }];
                    if (!row)
                        return [2 /*return*/, { ok: false, error: "Task not found" }];
                    task = row;
                    st = task.status;
                    if (st === "done" || st === "cancelled" || st === "error") {
                        return [2 /*return*/, { ok: false, error: "Task is already ".concat(st) }];
                    }
                    nowIso = new Date().toISOString();
                    if (!(st === "queued")) return [3 /*break*/, 3];
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                            .update({
                            status: "cancelled",
                            last_error: "Stopped by user",
                            updated_at: nowIso,
                        })
                            .eq("id", taskId)
                            .eq("project_id", projectId)];
                case 2:
                    error = (_e.sent()).error;
                    return [2 /*return*/, { ok: !error, error: (_b = error === null || error === void 0 ? void 0 : error.message) !== null && _b !== void 0 ? _b : null }];
                case 3:
                    if (!(st === "running")) return [3 /*break*/, 8];
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_AGENT_RUNS_TABLE)
                            .update({
                            status: "error",
                            finished_at: nowIso,
                            error: "Stopped by user",
                        })
                            .eq("queue_task_id", taskId)
                            .eq("status", "running")];
                case 4:
                    _e.sent();
                    runningUpdate = {
                        status: "cancelled",
                        last_error: "Stopped by user",
                        locked_until: null,
                        claimed_by: null,
                        updated_at: nowIso,
                    };
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                            .update(runningUpdate)
                            .eq("id", taskId)
                            .eq("project_id", projectId)];
                case 5:
                    error = (_e.sent()).error;
                    if (!(error &&
                        error.message.includes("claimed_by") &&
                        error.message.includes("schema cache"))) return [3 /*break*/, 7];
                    _c = runningUpdate.claimed_by, withoutClaimed = __rest(runningUpdate, ["claimed_by"]);
                    void _c;
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                            .update(withoutClaimed)
                            .eq("id", taskId)
                            .eq("project_id", projectId)];
                case 6:
                    r2 = _e.sent();
                    error = r2.error;
                    _e.label = 7;
                case 7: return [2 /*return*/, { ok: !error, error: (_d = error === null || error === void 0 ? void 0 : error.message) !== null && _d !== void 0 ? _d : null }];
                case 8: return [2 /*return*/, { ok: false, error: "Cannot stop task with status ".concat(st) }];
            }
        });
    });
}
/**
 * Re-queue a copy of a terminal task (done / error / cancelled).
 */
function restartEnrichmentQueueTask(client, projectId, taskId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, row, fetchErr, task, insertRow, _b, ins, insErr, newId;
        var _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, client
                        .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                        .select("*")
                        .eq("id", taskId)
                        .eq("project_id", projectId)
                        .maybeSingle()];
                case 1:
                    _a = _e.sent(), row = _a.data, fetchErr = _a.error;
                    if (fetchErr)
                        return [2 /*return*/, { ok: false, newTaskId: null, error: fetchErr.message }];
                    if (!row)
                        return [2 /*return*/, { ok: false, newTaskId: null, error: "Task not found" }];
                    task = row;
                    if (task.status !== "done" && task.status !== "error" && task.status !== "cancelled") {
                        return [2 /*return*/, {
                                ok: false,
                                newTaskId: null,
                                error: "Only finished tasks can be restarted (done, error, or cancelled)",
                            }];
                    }
                    insertRow = {
                        project_id: task.project_id,
                        agent_name: task.agent_name,
                        operation_name: task.operation_name,
                        company_id: task.company_id,
                        contact_id: task.contact_id,
                        meta: (_d = task.meta) !== null && _d !== void 0 ? _d : {},
                        status: "queued",
                    };
                    return [4 /*yield*/, client
                            .from(exports.ENRICHMENT_QUEUE_TASKS_TABLE)
                            .insert(insertRow)
                            .select("id")
                            .single()];
                case 2:
                    _b = _e.sent(), ins = _b.data, insErr = _b.error;
                    if (insErr)
                        return [2 /*return*/, { ok: false, newTaskId: null, error: insErr.message }];
                    newId = ins.id;
                    return [2 /*return*/, { ok: true, newTaskId: newId, error: null }];
            }
        });
    });
}

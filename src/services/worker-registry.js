"use strict";
/**
 * In-memory registry of worker heartbeats for the API process.
 * Workers POST periodically; entries older than TTL are omitted (and pruned on read).
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordWorkerHeartbeat = recordWorkerHeartbeat;
exports.getActiveWorkers = getActiveWorkers;
exports.isWorkerHeartbeatAuthOk = isWorkerHeartbeatAuthOk;
var store = new Map();
function ttlMs() {
    var _a;
    var n = Number((_a = process.env.WORKER_HEARTBEAT_TTL_MS) !== null && _a !== void 0 ? _a : 45000);
    return Number.isFinite(n) && n > 0 ? n : 45000;
}
function recordWorkerHeartbeat(payload) {
    var _a;
    var now = Date.now();
    store.set(payload.workerId, __assign(__assign({}, payload), { tasksInProgress: (_a = payload.tasksInProgress) !== null && _a !== void 0 ? _a : [], lastSeenAt: now }));
}
function getActiveWorkers() {
    var _a;
    var now = Date.now();
    var maxAge = ttlMs();
    var workers = [];
    for (var _i = 0, store_1 = store; _i < store_1.length; _i++) {
        var _b = store_1[_i], id = _b[0], row = _b[1];
        if (now - row.lastSeenAt > maxAge) {
            store.delete(id);
            continue;
        }
        workers.push({
            workerId: id,
            name: row.name,
            kind: row.kind,
            status: row.status,
            tasksInProgress: (_a = row.tasksInProgress) !== null && _a !== void 0 ? _a : [],
            lastSeenAt: new Date(row.lastSeenAt).toISOString(),
        });
    }
    workers.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { workers: workers };
}
function isWorkerHeartbeatAuthOk(req) {
    var _a;
    var secret = (_a = process.env.WORKER_HEARTBEAT_SECRET) === null || _a === void 0 ? void 0 : _a.trim();
    if (!secret)
        return true;
    var auth = req.headers.authorization;
    return auth === "Bearer ".concat(secret);
}

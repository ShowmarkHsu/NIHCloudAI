import type {
  PatientSnapshot,
  SourceRecord,
  SourceRecordType,
} from "../../domain";
import type { SnapshotDiagnostic } from "../../shared/patientSnapshotMessages";

/** The five NHI Cloud subsets that are deliberately in the MVP allow-list. */
export const NHI_ENDPOINTS = [
  {
    source: "medication",
    permission: "2.1",
    path: "imue0008/imue0008s02/get-data",
  },
  {
    source: "allergy",
    permission: "5.1",
    path: "imue0040/imue0040s02/get-data",
  },
  {
    source: "lab",
    permission: "6.1",
    path: "imue0060/imue0060s02/get-data",
  },
  {
    source: "imaging",
    permission: "6.2",
    path: "imue0130/imue0130s02/get-data",
  },
  {
    source: "discharge",
    permission: "8.1",
    path: "imue0070/imue0070s02/get-data",
  },
] as const satisfies ReadonlyArray<{
  source: SourceRecordType;
  permission: string;
  path: string;
}>;

export const NHI_CLOUD_API_ORIGIN = "https://medcloud2.nhi.gov.tw";

/** A storage seam kept intentionally smaller than the browser Storage API. */
export interface NhiSessionStorage {
  readonly length?: number;
  getItem(key: string): string | null;
  key?(index: number): string | null;
}

export type NhiClock = () => Date | number;
export type NhiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface NhiCloudAdapterDependencies {
  fetch: NhiFetch;
  sessionStorage: NhiSessionStorage;
  now: NhiClock;
}

/**
 * The only patient identity that leaves token inspection.  `sourcePatientKey`
 * is for the session controller to compare a page's selected patient; it is
 * deliberately not copied into a PatientSnapshot or sent in an API query.
 */
export interface NhiPatientContext {
  readonly sourcePatientKey: string;
  readonly permissionNodes: readonly string[];
  /** JWT expiry represented as an ISO date/time, never as the JWT itself. */
  readonly expiry: string;
}

export interface NhiSnapshotResult {
  readonly snapshot: PatientSnapshot;
  readonly diagnostics: readonly SnapshotDiagnostic[];
}

export interface NhiCloudAdapter {
  inspectPatientContext(): NhiPatientContext | null;
  fetchSnapshot(
    patientId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<NhiSnapshotResult>;
}

export type NhiAdapterErrorCode =
  | "missing-token"
  | "malformed-token"
  | "expired-token"
  | "invalid-identity";

/** Errors contain no token, claims, or response body. */
export class NhiAdapterError extends Error {
  readonly code: NhiAdapterErrorCode;

  constructor(code: NhiAdapterErrorCode, message: string) {
    super(message);
    this.name = "NhiAdapterError";
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

type TokenClaims = {
  sourcePatientKey: string;
  permissionNodes: string[];
  expiry: string;
  token: string;
};

type Endpoint = (typeof NHI_ENDPOINTS)[number];

const TOKEN_KEY_HINT = /(access[._-]?token|authorization|bearer|jwt|nhi|session)/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PERMISSION_NODE_PATTERN = /^\d+(?:\.\d+)+$/;

const DIRECT_IDENTIFIER_KEYS = new Set([
  "patientid",
  "patient_id",
  "patientno",
  "patient_no",
  "patientnumber",
  "patient_number",
  "personid",
  "person_id",
  "personno",
  "person_no",
  "nationalid",
  "national_id",
  "nationalidentity",
  "national_identity",
  "citizenid",
  "citizen_id",
  "idno",
  "id_no",
  "identityno",
  "identity_no",
  "cardno",
  "card_no",
  "chartno",
  "chart_no",
  "medicalrecordno",
  "medical_record_no",
  "socialsecurityno",
  "social_security_no",
]);

const DATE_KEY_PATTERN = /(date|time|datetime|_dt$|_tm$)/i;

/**
 * A small, dependency-injected adapter.  The token is read and held only in
 * the synchronous stack that starts each operation; it is never put on the
 * adapter, context, diagnostics, or result object.
 */
export class NhiCloudAdapterImpl implements NhiCloudAdapter {
  private readonly dependencies: NhiCloudAdapterDependencies;

  constructor(dependencies: NhiCloudAdapterDependencies) {
    this.dependencies = dependencies;
  }

  inspectPatientContext(): NhiPatientContext | null {
    try {
      const claims = this.readTokenClaims();
      return {
        sourcePatientKey: claims.sourcePatientKey,
        permissionNodes: Object.freeze([...claims.permissionNodes]),
        expiry: claims.expiry,
      };
    } catch (error) {
      // Page lifecycle code treats absent, malformed, and expired auth alike.
      // Do not expose the token or claims through an error object.
      if (error instanceof NhiAdapterError) return null;
      return null;
    }
  }

  async fetchSnapshot(
    patientId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<NhiSnapshotResult> {
    const safePatientId = assertOpaqueIdentifier(patientId, "patientId");
    const safeSessionId = assertOpaqueIdentifier(sessionId, "sessionId");
    const now = this.nowDate();
    const claims = this.readTokenClaims(now);
    const diagnostics: SnapshotDiagnostic[] = [];
    const records: SourceRecord[] = [];

    // Keep the token in this local variable only.  Passing it straight into
    // fetch is the sole place where an Authorization value is constructed.
    const token = claims.token;

    for (const endpoint of NHI_ENDPOINTS) {
      if (!claims.permissionNodes.includes(endpoint.permission)) {
        diagnostics.push({
          source: endpoint.source,
          level: "info",
          message: `NHI subset skipped: permission ${endpoint.permission} was not granted.`,
        });
        continue;
      }

      try {
        const response = await this.dependencies.fetch(
          makeEndpointUrl(endpoint, now),
          {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json,text/plain,*/*",
              Authorization: `Bearer ${token}`,
              "X-Requested-With": "XMLHttpRequest",
            },
            signal,
          },
        );

        if (!response.ok) {
          diagnostics.push({
            source: endpoint.source,
            level: "warning",
            message: `NHI ${endpoint.source} subset request failed with HTTP ${response.status}.`,
          });
          continue;
        }

        const payload: unknown = await response.json();
        const normalized = normalizeEndpointPayload(
          endpoint,
          payload,
          safePatientId,
          safeSessionId,
          now,
          records.length,
        );
        records.push(...normalized.records);
        diagnostics.push(...normalized.diagnostics);
      } catch (error) {
        // Cancellation is a caller control signal, not a partial-data warning.
        if (isAbortError(error) || signal?.aborted) {
          throw error;
        }
        diagnostics.push({
          source: endpoint.source,
          level: "warning",
          message: `NHI ${endpoint.source} subset could not be read.`,
        });
      }
    }

    const snapshot: PatientSnapshot = {
      patientId: safePatientId,
      sessionId: safeSessionId,
      capturedAt: now.toISOString(),
      records,
    };
    return { snapshot, diagnostics };
  }

  private nowDate(): Date {
    const value = this.dependencies.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new NhiAdapterError("malformed-token", "NHI adapter clock returned an invalid time.");
    }
    return date;
  }

  private readTokenClaims(now = this.nowDate()): TokenClaims {
    const token = findToken(this.dependencies.sessionStorage);
    if (!token) {
      throw new NhiAdapterError("missing-token", "NHI authorization is not available.");
    }

    const payload = decodeJwtPayload(token);
    if (!payload) {
      throw new NhiAdapterError("malformed-token", "NHI authorization is malformed.");
    }

    const expirySeconds = readExpirySeconds(payload);
    if (expirySeconds === undefined) {
      throw new NhiAdapterError("malformed-token", "NHI authorization has no valid expiry.");
    }
    const nowSeconds = now.getTime() / 1000;
    if (expirySeconds <= nowSeconds) {
      throw new NhiAdapterError("expired-token", "NHI authorization has expired.");
    }

    const sourcePatientKey = readSourcePatientKey(payload);
    if (!sourcePatientKey) {
      throw new NhiAdapterError("invalid-identity", "NHI authorization has no patient context.");
    }
    const permissionNodes = readPermissionNodes(payload);
    return {
      sourcePatientKey,
      permissionNodes,
      expiry: new Date(expirySeconds * 1000).toISOString(),
      token,
    };
  }
}

export function createNhiCloudAdapter(
  dependencies: NhiCloudAdapterDependencies,
): NhiCloudAdapter {
  return new NhiCloudAdapterImpl(dependencies);
}

function assertOpaqueIdentifier(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NhiAdapterError("invalid-identity", `${name} must be an opaque non-empty identifier.`);
  }
  return value.trim();
}

function findToken(storage: NhiSessionStorage): string | undefined {
  const candidates: string[] = [];
  const seenKeys = new Set<string>();

  const readKey = (key: string | null) => {
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    let value: string | null;
    try {
      value = storage.getItem(key);
    } catch {
      return;
    }
    if (value) candidates.push(value);
  };

  // Known names cover the common NHI page implementations even when their
  // Storage shim does not expose length/key().
  for (const key of [
    "nhiJwt",
    "nhiJWT",
    "nhi_token",
    "access_token",
    "accessToken",
    "authorization",
    "token",
    "jwt",
  ]) {
    readKey(key);
  }
  if (typeof storage.length === "number" && storage.key) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      // The page's token key is implementation-defined.  Reading every value
      // is still session-local and lets us locate an NHI JWT without relying
      // on a page-specific key name.
      if (key) readKey(key);
    }
  }

  let malformedCandidate: string | undefined;
  for (const candidate of candidates) {
    const direct = findJwtString(candidate);
    if (direct) return direct;
    try {
      const parsed: unknown = JSON.parse(candidate);
      const nested = findJwtInValue(parsed);
      if (nested) return nested;
    } catch {
      // Non-JSON values are normal Storage entries; continue scanning.
    }
    if (!malformedCandidate && candidate.trim()) malformedCandidate = candidate.trim();
  }
  // A value under a token-like key is reported as malformed rather than
  // silently treated as missing; callers still receive only a safe error/null.
  return malformedCandidate;
}

function findJwtString(value: string): string | undefined {
  const trimmed = value.trim();
  if (TOKEN_PATTERN.test(trimmed)) return trimmed;
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearerMatch && TOKEN_PATTERN.test(bearerMatch[1])) return bearerMatch[1];
  return undefined;
}

function findJwtInValue(value: unknown): string | undefined {
  if (typeof value === "string") return findJwtString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findJwtInValue(item);
      if (token) return token;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (TOKEN_KEY_HINT.test(key) || key === "access_token" || key === "accessToken") {
      const token = findJwtInValue(child);
      if (token) return token;
    }
  }
  return undefined;
}

function decodeJwtPayload(token: string): JsonObject | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const decoded = decodeBase64Utf8(padded);
    const parsed: unknown = JSON.parse(decoded);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Utf8(value: string): string {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  // This branch is useful in non-browser test runners with a Node global.
  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(value, "base64").toString("utf8");
  throw new Error("base64 decoder unavailable");
}

function readExpirySeconds(payload: JsonObject): number | undefined {
  for (const key of ["exp", "expiresAt", "expiry", "expiration"]) {
    const actualKey = findKey(payload, key);
    const value = actualKey ? payload[actualKey] : undefined;
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) {
      // Millisecond timestamps are accepted only when unambiguously large.
      return number > 10_000_000_000 ? number / 1000 : number;
    }
  }
  return undefined;
}

function readSourcePatientKey(payload: JsonObject): string | undefined {
  const candidates = [
    "sourcePatientKey",
    "source_patient_key",
    "UserID",
    "patientId",
    "patient_id",
    "patientKey",
    "patient_key",
    "subject",
    "sub",
  ];
  for (const key of candidates) {
    const actualKey = findKey(payload, key);
    const value = actualKey ? payload[actualKey] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readPermissionNodes(payload: JsonObject): string[] {
  const found = new Set<string>();
  for (const key of [
    "permissionNodes",
    "permission_nodes",
    "permissions",
    "permission",
    "Permission",
    "scope",
    "scopes",
    "nodes",
  ]) {
    const actualKey = findKey(payload, key);
    collectPermissionNodes(actualKey ? payload[actualKey] : undefined, found);
  }
  return [...found].sort();
}

function collectPermissionNodes(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    const pieces = value.split(/[\s,;|]+/).map((piece) => piece.trim());
    for (const piece of pieces) {
      if (PERMISSION_NODE_PATTERN.test(piece)) output.add(piece);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPermissionNodes(item, output));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (PERMISSION_NODE_PATTERN.test(key)) output.add(key);
    collectPermissionNodes(child, output);
  }
}

function makeEndpointUrl(endpoint: Endpoint, date: Date): string {
  const url = new URL(`/imu/api/${endpoint.path}`, NHI_CLOUD_API_ORIGIN);
  url.searchParams.set("cli_datetime", formatCliDatetime(date));
  url.searchParams.set("insert_log", "true");
  return url.toString();
}

function formatCliDatetime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function normalizeEndpointPayload(
  endpoint: Endpoint,
  payload: unknown,
  patientId: string,
  sessionId: string,
  capturedAt: Date,
  existingRecordCount: number,
): { records: SourceRecord[]; diagnostics: SnapshotDiagnostic[] } {
  const diagnostics: SnapshotDiagnostic[] = [];
  const rows = extractRows(payload);
  if (!rows) {
    diagnostics.push({
      source: endpoint.source,
      level: "warning",
      message: `NHI ${endpoint.source} response did not contain a supported rObject payload.`,
    });
    return { records: [], diagnostics };
  }
  if (rows.length === 0) {
    diagnostics.push({
      source: endpoint.source,
      level: "info",
      message: `NHI ${endpoint.source} subset returned no records.`,
    });
    return { records: [], diagnostics };
  }

  const records: SourceRecord[] = [];
  rows.forEach((row, rowIndex) => {
    const normalized = normalizeRecord(endpoint.source, row, patientId, sessionId, capturedAt);
    if (!normalized) {
      diagnostics.push({
        source: endpoint.source,
        level: "warning",
        message: `NHI ${endpoint.source} record ${rowIndex + 1} was missing usable clinical fields.`,
      });
      return;
    }
    records.push({
      ...normalized,
      id: `nhi-${sessionId}-${endpoint.source}-${existingRecordCount + records.length + 1}`,
    });
  });
  return { records, diagnostics };
}

function extractRows(payload: unknown): JsonObject[] | undefined {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return undefined;

  const preferred = findProperty(payload, "robject");
  if (preferred !== undefined) {
    if (Array.isArray(preferred)) return preferred.filter(isObject);
    if (isObject(preferred)) {
      const nested = findArray(preferred);
      return nested ?? [preferred];
    }
  }

  const array = findArray(payload);
  return array;
}

function findProperty(object: JsonObject, wanted: string): unknown {
  const entry = Object.entries(object).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

function findArray(object: JsonObject): JsonObject[] | undefined {
  for (const [key, value] of Object.entries(object)) {
    if (!["data", "result", "items", "rows", "records", "list", "robject"].includes(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) return value.filter(isObject);
    if (isObject(value)) {
      const nested = findArray(value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function normalizeRecord(
  source: SourceRecordType,
  raw: JsonObject,
  patientId: string,
  sessionId: string,
  capturedAt: Date,
): Omit<SourceRecord, "id"> | undefined {
  const fields = sourceFields(source, raw);
  const data = removeDirectIdentifiers(fields.data);
  const values = Object.values(data);
  if (values.length === 0) return undefined;
  const recordedAt = parseDate(firstPresent(raw, fields.dateKeys)) ?? capturedAt;
  const summary = summarize(source, data);
  return {
    patientId,
    sessionId,
    type: source,
    recordedAt: recordedAt.toISOString(),
    summary,
    data,
  };
}

type FieldSelection = { data: JsonObject; dateKeys: string[] };

function sourceFields(source: SourceRecordType, raw: JsonObject): FieldSelection {
  switch (source) {
    case "medication":
      return {
        data: pickFields(raw, {
          medicationName: ["drug_ename"],
          genericName: ["drug_ing_name"],
          code: ["drug_code"],
          dosage: ["dosage"],
          frequency: ["frequency"],
          hospital: ["hosp"],
          date: ["drug_date"],
        }),
        dateKeys: ["drug_date"],
      };
    case "allergy":
      return {
        data: pickFields(raw, {
          date: ["upload_d"],
          allergen: ["drug_name"],
          reaction: ["sympton_name"],
          severity: ["allerg_severity_level"],
          hospital: ["hosp"],
        }),
        dateKeys: ["upload_d"],
      };
    case "imaging":
      return {
        data: pickFields(raw, {
          date: ["real_inspect_date", "case_time", "recipe_date"],
          testName: ["order_name"],
          findings: ["inspect_result", "path_diag_2"],
          conclusion: ["path_diag_3"],
          hospital: ["hosp"],
          code: ["order_code"],
        }),
        dateKeys: ["real_inspect_date", "case_time", "recipe_date"],
      };
    case "discharge":
      return {
        data: pickFields(raw, {
          dischargeDate: ["out_date"],
          admissionDate: ["in_date"],
          hospital: ["hosp"],
          diagnosisCode: ["icd_code"],
          diagnosis: ["icd_cname"],
        }),
        dateKeys: ["out_date", "in_date"],
      };
    case "lab":
      return {
        // NHI's lab payload differs by release.  These are intentionally
        // conservative candidates; unknown fields are reported rather than
        // copied wholesale into the model input.
        data: pickFields(raw, {
          testName: ["test_name", "exam_name", "lab_name", "item_name", "order_name"],
          value: ["value", "result", "result_value", "lab_value", "exam_value"],
          unit: ["unit", "result_unit", "lab_unit"],
          referenceRange: ["reference_range", "ref_range", "normal_range", "range"],
          interpretation: ["interpretation", "abnormal_flag", "abnormality"],
          hospital: ["hosp", "hospital"],
          date: ["test_date", "exam_date", "lab_date", "report_date", "case_time"],
        }),
        dateKeys: ["test_date", "exam_date", "lab_date", "report_date", "case_time"],
      };
    default:
      return { data: {}, dateKeys: [] };
  }
}

function pickFields(raw: JsonObject, mapping: Record<string, string[]>): JsonObject {
  const data: JsonObject = {};
  for (const [canonical, candidates] of Object.entries(mapping)) {
    for (const candidate of candidates) {
      const key = findKey(raw, candidate);
      if (!key) continue;
      const value = raw[key];
      if (isScalar(value)) {
        data[canonical] = value;
        break;
      }
    }
  }
  return data;
}

function removeDirectIdentifiers(data: JsonObject): JsonObject {
  const safe: JsonObject = {};
  for (const [key, value] of Object.entries(data)) {
    if (DIRECT_IDENTIFIER_KEYS.has(normalizeKey(key))) continue;
    if (isScalar(value)) safe[key] = value;
  }
  return safe;
}

function summarize(source: SourceRecordType, data: JsonObject): string {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (isScalar(value) && String(value).trim()) return String(value).trim();
    }
    return undefined;
  };
  switch (source) {
    case "medication": {
      const name = get("medicationName", "genericName") ?? "medication";
      const dosage = get("dosage");
      return dosage ? `${name} (${dosage})` : name;
    }
    case "allergy":
      return `${get("allergen") ?? "Allergy"}${get("reaction") ? `: ${get("reaction")}` : ""}`;
    case "lab":
      return `${get("testName") ?? "Laboratory result"}${get("value") ? `: ${get("value")}${get("unit") ? ` ${get("unit")}` : ""}` : ""}`;
    case "imaging":
      return `${get("testName") ?? "Imaging study"}${get("conclusion", "findings") ? `: ${get("conclusion", "findings")}` : ""}`;
    case "discharge":
      return `${get("diagnosis") ?? "Discharge record"}${get("dischargeDate") ? ` (${get("dischargeDate")})` : ""}`;
    default:
      return "NHI clinical record";
  }
}

function firstPresent(raw: JsonObject, keys: readonly string[]): unknown {
  for (const key of keys) {
    const actual = findKey(raw, key);
    if (actual && raw[actual] !== undefined && raw[actual] !== null && String(raw[actual]).trim()) {
      return raw[actual];
    }
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const compact = text.replace(/[^0-9]/g, "");
  if (/^\d{14}$/.test(compact)) {
    const date = new Date(
      `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}Z`,
    );
    if (Number.isFinite(date.getTime())) return date;
  }
  if (/^\d{8}$/.test(compact)) {
    const date = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00Z`);
    if (Number.isFinite(date.getTime())) return date;
  }
  const roc = /^(\d{3})[./-]?(\d{1,2})[./-]?(\d{1,2})$/.exec(text);
  if (roc) {
    const date = new Date(
      `${Number(roc[1]) + 1911}-${roc[2].padStart(2, "0")}-${roc[3].padStart(2, "0")}T00:00:00Z`,
    );
    if (Number.isFinite(date.getTime())) return date;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function findKey(object: JsonObject, wanted: string): string | undefined {
  const normalizedWanted = normalizeKey(wanted);
  return Object.keys(object).find((key) => normalizeKey(key) === normalizedWanted);
}

function normalizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

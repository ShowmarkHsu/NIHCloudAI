import {
  ClinicalFactSchema,
  type ClinicalFact,
  PatientSnapshotSchema,
  type PatientSnapshot,
  SafetySignalSchema,
  type SafetySignal,
  type SourceRecord,
} from "../domain";

export const CLINICAL_RULES_VERSION = "clinical-rules.v2";

/**
 * Output of the deterministic, source-backed rule pass.
 *
 * The rule pass deliberately does not make a diagnosis or a treatment
 * recommendation.  It only restates values present in a patient snapshot or
 * describes a calculation whose inputs are cited in `sourceRefs`.
 */
export type ClinicalRuleEvaluation = Readonly<{
  facts: ClinicalFact[];
  safetySignals: SafetySignal[];
}>;

type DataObject = Record<string, unknown>;

type NumericLab = Readonly<{
  record: SourceRecord;
  testName: string;
  unit: string;
  value: number;
  recordedAt: number;
}>;

type MedicationInterval = Readonly<{
  record: SourceRecord;
  identityKey: string;
  identityDisplay: string;
  start: number;
  end: number;
}>;

type AllergyAssertion = "present" | "absent";

type AllergyAssertionRecord = Readonly<{
  record: SourceRecord;
  allergenKey: string;
  allergenDisplay: string;
  assertion: AllergyAssertion;
}>;

type ExplicitInterpretation = Readonly<{
  label: string;
  critical: boolean;
}>;

const FACT_TYPE_ORDER: Record<ClinicalFact["type"], number> = {
  medication: 0,
  allergy: 1,
  trend: 2,
  lab: 2,
  event: 3,
  imaging: 4,
  discharge: 5,
  hospitalization: 6,
  other: 7,
};

const SIGNAL_KIND_ORDER: Record<SafetySignal["kind"], number> = {
  "abnormal-lab": 0,
  "lab-trend": 1,
  "medication-overlap": 2,
  "duplicate-test": 3,
  "allergy-risk": 4,
  "missing-data": 5,
  contradiction: 6,
  other: 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate all conservative clinical rules for one validated patient
 * snapshot.  The snapshot is parsed first, which both validates patient/
 * session identity and gives this function a private copy to read from; no
 * caller-owned array or record is ever sorted or modified.
 */
export function evaluateClinicalRules(
  snapshotInput: PatientSnapshot,
): ClinicalRuleEvaluation {
  const snapshot = PatientSnapshotSchema.parse(snapshotInput);
  const facts: ClinicalFact[] = [];
  const safetySignals: SafetySignal[] = [];

  for (const record of snapshot.records) {
    if (record.type === "medication") {
      facts.push(makeMedicationFact(snapshot, record));
    } else if (record.type === "allergy") {
      facts.push(makeAllergyFact(snapshot, record));
    }
  }

  const numericLabs = collectNumericLabs(snapshot.records);
  facts.push(...makeTrendFacts(snapshot, numericLabs));
  safetySignals.push(...makeAbnormalLabSignals(snapshot));
  safetySignals.push(...makeMedicationOverlapSignals(snapshot));
  safetySignals.push(...makeAllergyContradictionSignals(snapshot));

  const sortedFacts = facts.slice().sort(compareFacts);
  const sortedSignals = safetySignals.slice().sort(compareSignals);

  // Parse at the boundary so every result returned by the canonical
  // interface is guaranteed to satisfy the domain contract, including source
  // references and patient/session identity.
  return {
    facts: ClinicalFactSchema.array().parse(sortedFacts),
    safetySignals: SafetySignalSchema.array().parse(sortedSignals),
  };
}

function makeMedicationFact(
  snapshot: PatientSnapshot,
  record: SourceRecord,
): ClinicalFact {
  const data = record.data;
  const medicationName =
    readText(data, ["medicationName", "drugName", "name", "genericName"]) ??
    record.summary;
  const dosage = readText(data, ["dosage", "dose"]);
  const display = dosage ? `${medicationName}（${dosage}）` : medicationName;

  return {
    id: makeRuleId(snapshot, "medication", record.id),
    patientId: snapshot.patientId,
    sessionId: snapshot.sessionId,
    type: "medication",
    text: `來源紀錄列有用藥：${display}。`,
    sourceRefs: [record.id],
    derived: false,
  };
}

function makeAllergyFact(
  snapshot: PatientSnapshot,
  record: SourceRecord,
): ClinicalFact {
  const data = record.data;
  const allergen =
    readText(data, ["allergen", "drugName", "allergyName", "name"]) ??
    record.summary;
  const reaction = readText(data, ["reaction", "symptom", "symptonName"]);
  const display = reaction ? `${allergen}（反應：${reaction}）` : allergen;

  return {
    id: makeRuleId(snapshot, "allergy", record.id),
    patientId: snapshot.patientId,
    sessionId: snapshot.sessionId,
    type: "allergy",
    text: `來源紀錄列有過敏紀錄：${display}。`,
    sourceRefs: [record.id],
    derived: false,
  };
}

function collectNumericLabs(records: readonly SourceRecord[]): NumericLab[] {
  return records
    .filter((record) => record.type === "lab")
    .map((record) => {
      const testName = readText(record.data, ["testName", "examName", "labName", "itemName"]);
      const unit = readText(record.data, ["unit", "resultUnit", "labUnit"]);
      const value = parseNumeric(readValue(record.data, ["value", "result", "resultValue", "labValue", "examValue"]));
      if (!testName || !unit || value === undefined) return undefined;
      const recordedAt = Date.parse(record.recordedAt);
      if (!Number.isFinite(recordedAt)) return undefined;
      return { record, testName, unit, value, recordedAt };
    })
    .filter((value): value is NumericLab => value !== undefined);
}

function makeTrendFacts(
  snapshot: PatientSnapshot,
  numericLabs: readonly NumericLab[],
): ClinicalFact[] {
  const groups = new Map<string, NumericLab[]>();
  for (const lab of numericLabs) {
    const key = `${normalizeText(lab.testName)}\u0000${normalizeText(lab.unit)}`;
    const existing = groups.get(key);
    if (existing) existing.push(lab);
    else groups.set(key, [lab]);
  }

  const facts: ClinicalFact[] = [];
  for (const [groupKey, rows] of groups) {
    if (rows.length < 2) continue;
    const ordered = rows.slice().sort(compareNumericLabs);
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const direction =
      latest.value > first.value
        ? "上升"
        : latest.value < first.value
          ? "下降"
          : "持平";
    const sourceRefs = ordered.map((row) => row.record.id);

    facts.push({
      id: makeRuleId(snapshot, "lab-trend", `${groupKey}|${sourceRefs.join("|")}`),
      patientId: snapshot.patientId,
      sessionId: snapshot.sessionId,
      type: "trend",
      text: `檢驗「${first.testName}」（${first.unit}）數值由 ${formatNumber(first.value)} 變為 ${formatNumber(latest.value)}，呈${direction}。`,
      sourceRefs,
      derived: true,
    });
  }
  return facts;
}

function makeAbnormalLabSignals(snapshot: PatientSnapshot): SafetySignal[] {
  const signals: SafetySignal[] = [];
  const labRecords = snapshot.records
    .filter((record) => record.type === "lab")
    .slice()
    .sort(compareRecords);

  for (const record of labRecords) {
    const interpretationText = readText(record.data, [
      "interpretation",
      "abnormalFlag",
      "abnormality",
      "resultFlag",
      "flag",
    ]);
    const interpretation = interpretationText
      ? classifyInterpretation(interpretationText)
      : undefined;
    const value = parseNumeric(
      readValue(record.data, ["value", "result", "resultValue", "labValue", "examValue"]),
    );
    const range = parseReferenceRange(
      readText(record.data, ["referenceRange", "refRange", "normalRange", "range"]),
    );
    const outsideRange =
      value !== undefined &&
      range !== undefined &&
      (value < range.low || value > range.high);

    if (!interpretation && !outsideRange) continue;

    const testName =
      readText(record.data, ["testName", "examName", "labName", "itemName"]) ??
      "此項檢驗";
    let reason: string;
    if (interpretation) {
      reason = `來源紀錄標示為「${interpretationText?.trim() ?? interpretation.label}」`;
    } else {
      reason = `數值 ${formatNumber(value as number)} 超出參考區間 ${formatNumber(range!.low)}-${formatNumber(range!.high)}`;
    }

    signals.push({
      id: makeRuleId(snapshot, "abnormal-lab", record.id),
      patientId: snapshot.patientId,
      sessionId: snapshot.sessionId,
      kind: "abnormal-lab",
      text: `檢驗「${testName}」${reason}，請核對原始檢驗紀錄。`,
      sourceRefs: [record.id],
      severity: interpretation?.critical ? "urgent-review" : "attention",
    });
  }
  return signals;
}

function makeMedicationOverlapSignals(snapshot: PatientSnapshot): SafetySignal[] {
  const intervals: MedicationInterval[] = [];
  for (const record of snapshot.records) {
    if (record.type !== "medication") continue;
    const identity = medicationIdentity(record);
    const interval = medicationInterval(record);
    if (!identity || !interval) continue;
    intervals.push({ record, ...identity, ...interval });
  }

  const signals: SafetySignal[] = [];
  const ordered = intervals.slice().sort((left, right) => compareText(left.record.id, right.record.id));
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex];
      if (left.identityKey !== right.identityKey) continue;
      if (left.end < right.start || right.end < left.start) continue;

      const sourceRefs = [left.record.id, right.record.id].sort(compareText);
      signals.push({
        id: makeRuleId(snapshot, "medication-overlap", sourceRefs.join("|")),
        patientId: snapshot.patientId,
        sessionId: snapshot.sessionId,
        kind: "medication-overlap",
        text: `用藥「${left.identityDisplay}」的兩筆來源紀錄具有明確且相交的使用區間，請核對原始用藥紀錄。`,
        sourceRefs,
        severity: "attention",
      });
    }
  }
  return signals;
}

function makeAllergyContradictionSignals(snapshot: PatientSnapshot): SafetySignal[] {
  const groups = new Map<string, AllergyAssertionRecord[]>();
  for (const record of snapshot.records) {
    if (record.type !== "allergy") continue;

    // A contradiction requires an explicitly named allergen and an
    // explicitly recognised assertion.  Reactions, record age, or a missing
    // assertion are deliberately not used as proxies for allergy status.
    const allergenDisplay = readText(record.data, ["allergen", "drugName", "allergyName", "name"]);
    const assertionText = readText(record.data, [
      "assertion",
      "allergyAssertion",
      "allergyStatus",
      "status",
    ]);
    const assertion = assertionText ? classifyAllergyAssertion(assertionText) : undefined;
    if (!allergenDisplay || !assertion) continue;

    const allergenKey = normalizeText(allergenDisplay);
    const existing = groups.get(allergenKey);
    const item = { record, allergenKey, allergenDisplay, assertion };
    if (existing) existing.push(item);
    else groups.set(allergenKey, [item]);
  }

  const signals: SafetySignal[] = [];
  for (const [allergenKey, records] of groups) {
    const hasPresent = records.some((item) => item.assertion === "present");
    const hasAbsent = records.some((item) => item.assertion === "absent");
    if (!hasPresent || !hasAbsent) continue;

    const sourceRefs = records.map((item) => item.record.id).sort(compareText);
    const display = records
      .slice()
      .sort((left, right) => compareText(left.record.id, right.record.id))[0]
      .allergenDisplay.trim();
    signals.push({
      id: makeRuleId(snapshot, "allergy-contradiction", `${allergenKey}|${sourceRefs.join("|")}`),
      patientId: snapshot.patientId,
      sessionId: snapshot.sessionId,
      kind: "contradiction",
      text: `過敏項目「${display}」的來源紀錄有明確矛盾，請核對原始來源。`,
      sourceRefs,
      severity: "attention",
    });
  }
  return signals;
}

function classifyAllergyAssertion(value: string): AllergyAssertion | undefined {
  const normalized = normalizeText(value).replace(/[_-]+/g, " ");
  if (["allergy present", "present", "positive"].includes(normalized)) return "present";
  if (["allergy absent", "absent", "negative"].includes(normalized)) return "absent";
  return undefined;
}

function medicationIdentity(
  record: SourceRecord,
): { identityKey: string; identityDisplay: string } | undefined {
  const genericName = readText(record.data, ["genericName", "generic"]);
  const medicationName = readText(record.data, ["medicationName", "drugName", "name"]);
  const identityDisplay = genericName ?? medicationName;
  if (!identityDisplay) return undefined;
  return {
    identityKey: normalizeText(identityDisplay),
    identityDisplay,
  };
}

function medicationInterval(
  record: SourceRecord,
): { start: number; end: number } | undefined {
  const startDate = parseDateValue(readValue(record.data, ["startDate", "start"]));
  const endDate = parseDateValue(readValue(record.data, ["endDate", "end"]));
  if (startDate !== undefined && endDate !== undefined && endDate >= startDate) {
    return { start: startDate, end: endDate };
  }

  const date = parseDateValue(readValue(record.data, ["date", "medicationDate", "drugDate"]));
  const daysSupply = parseDaysSupply(readValue(record.data, ["daysSupply", "days"]));
  if (date === undefined || daysSupply === undefined) return undefined;
  // A days-supply interval is inclusive of its first and last day.  One day
  // therefore ends on the start date; adjacent courses do not overlap unless
  // their explicit dates share a boundary day.
  return { start: date, end: date + (daysSupply - 1) * DAY_MS };
}

function parseDaysSupply(value: unknown): number | undefined {
  const parsed = parseNumeric(value);
  if (parsed === undefined || parsed < 1 || !Number.isInteger(parsed)) return undefined;
  return parsed;
}

function classifyInterpretation(value: string): ExplicitInterpretation | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;

  const tokens = normalized
    .replace(/[()[\],;:/|_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const has = (markers: readonly string[]) =>
    markers.some(
      (marker) =>
        tokens.includes(marker) ||
        (marker.length > 1 && normalized.includes(marker)),
    );

  const critical = ["critical", "crit", "c", "危急", "危急值", "危險值"];
  if (has(critical)) return { label: "critical", critical: true };

  const abnormal = [
    "abnormal",
    "ab",
    "abn",
    "a",
    "high",
    "h",
    "hh",
    "low",
    "l",
    "ll",
    "positive",
    "pos",
    "p",
    "異常",
    "高",
    "偏高",
    "低",
    "偏低",
    "陽性",
    "陽",
    "+",
  ];
  return has(abnormal) ? { label: normalized, critical: false } : undefined;
}

function parseReferenceRange(
  value: string | undefined,
): { low: number; high: number } | undefined {
  if (!value) return undefined;
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[-–—]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(value);
  if (!match) return undefined;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return undefined;
  return { low, high };
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDateValue(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // NHI payloads can encode dates as numeric YYYYMMDD or
    // YYYYMMDDhhmmss.  Recognise those compact forms before considering
    // epoch seconds/milliseconds; otherwise 20260105 would be interpreted as
    // a date in 1970.
    if (Number.isInteger(value)) {
      const compact = String(value);
      if (/^\d{8}$|^\d{14}$/.test(compact)) {
        return parseCompactDate(compact);
      }
    }
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;

  const compact = text.replace(/[^0-9]/g, "");
  if (/^\d{8}$|^\d{14}$/.test(compact)) return parseCompactDate(compact);
  const roc = /^(\d{3})[./-]?(\d{1,2})[./-]?(\d{1,2})$/.exec(text);
  if (roc) {
    const parsed = Date.parse(
      `${Number(roc[1]) + 1911}-${roc[2].padStart(2, "0")}-${roc[3].padStart(2, "0")}T00:00:00Z`,
    );
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCompactDate(compact: string): number | undefined {
  if (/^\d{8}$/.test(compact)) {
    const parsed = Date.parse(
      `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00Z`,
    );
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (/^\d{14}$/.test(compact)) {
    const parsed = Date.parse(
      `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}Z`,
    );
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readValue(data: DataObject, aliases: readonly string[]): unknown {
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(data)) {
    if (wanted.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function readText(data: DataObject, aliases: readonly string[]): string | undefined {
  const value = readValue(data, aliases);
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function makeRuleId(snapshot: PatientSnapshot, rule: string, input: string): string {
  return `rule-${rule}-${stableHash(`${snapshot.patientId}|${snapshot.sessionId}|${input}`)}`;
}

function stableHash(value: string): string {
  // FNV-1a is small, deterministic, and avoids putting source/patient labels
  // into generated identifiers while retaining stable IDs for this session.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareRecords(left: SourceRecord, right: SourceRecord): number {
  const dateDifference = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  return dateDifference !== 0 ? dateDifference : compareText(left.id, right.id);
}

function compareNumericLabs(left: NumericLab, right: NumericLab): number {
  const dateDifference = left.recordedAt - right.recordedAt;
  return dateDifference !== 0 ? dateDifference : compareText(left.record.id, right.record.id);
}

function compareFacts(left: ClinicalFact, right: ClinicalFact): number {
  const typeDifference = FACT_TYPE_ORDER[left.type] - FACT_TYPE_ORDER[right.type];
  if (typeDifference !== 0) return typeDifference;
  const refDifference = compareText(left.sourceRefs.join("\u0000"), right.sourceRefs.join("\u0000"));
  return refDifference !== 0 ? refDifference : compareText(left.id, right.id);
}

function compareSignals(left: SafetySignal, right: SafetySignal): number {
  const kindDifference = SIGNAL_KIND_ORDER[left.kind] - SIGNAL_KIND_ORDER[right.kind];
  if (kindDifference !== 0) return kindDifference;
  const refDifference = compareText(left.sourceRefs.join("\u0000"), right.sourceRefs.join("\u0000"));
  return refDifference !== 0 ? refDifference : compareText(left.id, right.id);
}

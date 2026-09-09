function createEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

function selectStoredValues(store, query) {
  if (query == null) return structuredClone(store);
  if (typeof query === 'string') return {[query]: structuredClone(store[query])};
  if (Array.isArray(query)) {
    return Object.fromEntries(query.map((key) => [key, structuredClone(store[key])]));
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, fallback]) => [
      key,
      structuredClone(Object.hasOwn(store, key) ? store[key] : fallback),
    ]),
  );
}

export function installChromeMock(initialSync = {}, sourceStates = {}) {
  const storageChanged = createEvent();
  const runtimeMessages = createEvent();
  const stores = {sync: {...initialSync}, local: {}};

  function storageArea(areaName) {
    const store = stores[areaName];
    return {
      get(query, callback) {
        queueMicrotask(() => callback(selectStoredValues(store, query)));
      },
      set(values, callback = () => {}) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = {oldValue: store[key], newValue: value};
          store[key] = structuredClone(value);
        }
        queueMicrotask(() => {
          storageChanged.emit(changes, areaName);
          callback();
        });
      },
      remove(keys, callback = () => {}) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const key of list) {
          changes[key] = {oldValue: store[key], newValue: undefined};
          delete store[key];
        }
        queueMicrotask(() => {
          storageChanged.emit(changes, areaName);
          callback();
        });
      },
    };
  }

  globalThis.chrome = {
    storage: {
      sync: storageArea('sync'),
      local: storageArea('local'),
      onChanged: storageChanged,
    },
    runtime: {
      lastError: null,
      onMessage: runtimeMessages,
      getManifest: () => ({
        name: 'NIHCloudAI synthetic characterization',
        version: '26.702.2',
        description: 'Synthetic-only visual baseline harness',
      }),
      getURL: (path) => new URL(path, window.location.href).href,
      sendMessage(message, callback = () => {}) {
        if (message?.action === 'getDataStatus') {
          const statusKeys = new Map([
            ['western-medication', 'medication'],
            ['lab', 'labData'],
            ['chinese-medication', 'chineseMed'],
            ['imaging', 'imaging'],
            ['allergy', 'allergy'],
            ['surgery', 'surgery'],
            ['discharge', 'discharge'],
            ['medication-days', 'medDays'],
            ['patient-summary', 'patientSummary'],
            ['adult-health-check', 'adultHealthCheck'],
            ['cancer-screening', 'cancerScreening'],
          ]);
          const dataStatus = Object.fromEntries(Object.entries(sourceStates)
            .filter(([source]) => statusKeys.has(source))
            .map(([source, state]) => [statusKeys.get(source), state]));
          queueMicrotask(() => callback({dataStatus}));
          return;
        }
        runtimeMessages.emit(message, {}, () => {});
        queueMicrotask(() => callback({ok: true}));
      },
    },
    tabs: {
      create: ({url}, callback = () => {}) => queueMicrotask(() => callback({id: 2, url})),
      query: (_query, callback) => queueMicrotask(() => callback([{id: 1}])),
      sendMessage: (_tabId, _message, callback = () => {}) => queueMicrotask(() => callback({status: 'started'})),
    },
  };

  return {stores, runtimeMessages};
}

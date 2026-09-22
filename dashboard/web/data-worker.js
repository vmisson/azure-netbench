const DAY = 86400000;
const RANGE_DAYS = { '72h': 3, '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: 365 };
const COLUMNS = ['Timestamp', 'RowKey', 'Source', 'Destination', 'Bandwidth', 'Latency'];
const REGIONS = [
    ['francecentral', 'France Central', 'frc'], ['francesouth', 'France South', 'frs'],
    ['westeurope', 'West Europe', 'we'], ['northeurope', 'North Europe', 'ne'],
    ['centralus', 'Central US', 'cus'], ['eastus', 'East US', 'eus'], ['eastus2', 'East US 2', 'eus2'],
    ['westus', 'West US', 'wus'], ['westus2', 'West US 2', 'wus2'], ['westus3', 'West US 3', 'wus3'],
    ['eastasia', 'East Asia', 'ea'], ['southeastasia', 'Southeast Asia', 'sea'],
    ['australiaeast', 'Australia East', 'ae'], ['australiasoutheast', 'Australia Southeast', 'ase'],
    ['australiacentral', 'Australia Central', 'acl'], ['australiacentral2', 'Australia Central 2', 'acl2'],
    ['brazilsouth', 'Brazil South', 'brs'], ['brazilsoutheast', 'Brazil Southeast', 'brse'],
    ['canadacentral', 'Canada Central', 'cnc'], ['canadaeast', 'Canada East', 'cae'],
    ['chinaeast', 'China East'], ['chinaeast2', 'China East 2'], ['chinanorth', 'China North'],
    ['chinanorth2', 'China North 2'], ['chinanorth3', 'China North 3'],
    ['germanywestcentral', 'Germany West Central', 'gwc'], ['germanynorth', 'Germany North', 'gn'],
    ['centralindia', 'Central India', 'inc', 'indiacentral'], ['westindia', 'West India', 'inw', 'indiawest'],
    ['southindia', 'South India', 'ins', 'indiasouth'],
    ['japaneast', 'Japan East', 'jpe'], ['japanwest', 'Japan West', 'jpw'],
    ['koreacentral', 'Korea Central', 'krc'], ['koreasouth', 'Korea South', 'krs'],
    ['norwayeast', 'Norway East', 'noe', 'nwe'], ['norwaywest', 'Norway West', 'now'],
    ['southafricanorth', 'South Africa North', 'san'], ['southafricawest', 'South Africa West', 'saw'],
    ['southcentralus', 'South Central US', 'scus'], ['northcentralus', 'North Central US', 'ncus'],
    ['westcentralus', 'West Central US', 'wcus'], ['swedencentral', 'Sweden Central', 'sdc'],
    ['swedensouth', 'Sweden South', 'sds'], ['switzerlandnorth', 'Switzerland North', 'szn'],
    ['switzerlandwest', 'Switzerland West', 'szw'], ['uaecentral', 'UAE Central', 'uac'],
    ['uaenorth', 'UAE North', 'uan'], ['uksouth', 'UK South', 'uks'], ['ukwest', 'UK West', 'ukw'],
    ['eastus2euap', 'East US 2 EUAP'], ['centraluseuap', 'Central US EUAP'],
    ['austriaeast', 'Austria East'], ['chilecentral', 'Chile Central', 'clc'],
    ['italynorth', 'Italy North', 'itn'], ['israelcentral', 'Israel Central', 'isc', 'ilc'],
    ['polandcentral', 'Poland Central', 'plc'], ['qatarcentral', 'Qatar Central', 'qac'],
    ['spaincentral', 'Spain Central', 'spc'], ['taiwannorth', 'Taiwan North', 'twn'],
    ['taiwannorthwest', 'Taiwan Northwest', 'twnw'], ['mexicocentral', 'Mexico Central', 'mxc'],
    ['belgiumcentral', 'Belgium Central', 'bec'], ['newzealandnorth', 'New Zealand North', 'nzn'],
    ['indonesiacentral', 'Indonesia Central', 'idc'], ['malaysiawest', 'Malaysia West', 'myw']
];
const REGION_NAMES = new Map(REGIONS.flatMap(([region, name, ...aliases]) =>
    [region, ...aliases].map(alias => [alias, name])));

function formatRegionName(region) {
    return REGION_NAMES.get(region) || region.charAt(0).toUpperCase() + region.slice(1);
}

function parseMetric(value, kind) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase().replace(/[\u03bc\u00b5]/g, 'u').replace(/\s/g, '');
    let factor;
    if (kind === 'latency') {
        factor = { '': 1, us: 1, usec: 1, ms: 1000, msec: 1000, ns: 0.001, s: 1000000, sec: 1000000 }[unit];
    } else if (!unit) {
        factor = 1;
    } else {
        const bandwidthUnit = unit.match(/^([kmgt]?)(?:b|bits?)(?:\/s(?:ec)?|ps)?$/);
        if (bandwidthUnit) factor = { '': 1e-9, k: 1e-6, m: 0.001, g: 1, t: 1000 }[bandwidthUnit[1]];
    }
    const result = amount * factor;
    return Number.isFinite(result) && result >= 0 ? result : null;
}

function normalizeData(payload) {
    const legacy = Array.isArray(payload);
    if (!legacy && (payload?.schemaVersion !== 1 || !Array.isArray(payload.columns) || !Array.isArray(payload.rows))) {
        throw new Error('The API returned an unsupported data format.');
    }
    const indexes = legacy ? [] : COLUMNS.map(column => payload.columns.indexOf(column));
    if (indexes.some(index => index < 0)) throw new Error('The API response is missing benchmark columns.');
    const rows = legacy ? payload : payload.rows;
    const records = [];
    let skipped = 0;
    for (const row of rows) {
        if (row?.PartitionKey === 'fallback') throw new Error('The API returned synthetic fallback data, not real benchmarks.');
        const values = legacy ? COLUMNS.map(column => row?.[column]) : indexes.map(index => row?.[index]);
        const timestamp = typeof values[0] === 'number' ? values[0] : Date.parse(values[0]);
        const latency = parseMetric(values[5], 'latency');
        if (!Number.isFinite(timestamp) || latency === null) {
            skipped++;
            continue;
        }
        records.push({
            timestamp,
            region: String(values[1] || 'unknown'),
            source: String(values[2] || 'unknown'),
            destination: String(values[3] || 'unknown'),
            bandwidth: parseMetric(values[4], 'bandwidth'),
            latency
        });
    }
    records.sort((left, right) => right.timestamp - left.timestamp);
    return {
        records,
        meta: { ...payload.meta, received: rows.length, skipped, legacy },
        options: {
            regions: [...new Set(records.map(record => record.region))]
                .map(id => ({ id, name: formatRegionName(id) })).sort((left, right) => left.name.localeCompare(right.name)),
            sources: [...new Set(records.map(record => record.source))].sort(),
            destinations: [...new Set(records.map(record => record.destination))].sort()
        }
    };
}

function filterRecords(records, filters = {}, now = Date.now()) {
    const regions = new Set(filters.regions || []);
    const sources = new Set(filters.sources || []);
    const destinations = new Set(filters.destinations || []);
    const since = now - (RANGE_DAYS[filters.range] || 30) * DAY;
    return records.filter(record => record.timestamp >= since && record.timestamp <= now &&
        (!regions.size || regions.has(record.region)) &&
        (!sources.size || sources.has(record.source)) &&
        (!destinations.size || destinations.has(record.destination)) &&
        (filters.scope !== 'intra' || record.source === record.destination) &&
        (filters.scope !== 'inter' || record.source !== record.destination));
}

function isAbnormal(record) {
    return record.latency > (record.source === record.destination ? 500 : 1000);
}

function percentile(values, fraction = 0.95) {
    if (!values.length) return null;
    values.sort((left, right) => left - right);
    return values[Math.ceil(values.length * fraction) - 1];
}

function addBucket(timeline, time, record) {
    if (!timeline.has(time)) timeline.set(time, { total: 0, count: 0 });
    const bucket = timeline.get(time);
    bucket.total += record.latency;
    bucket.count++;
}

function timelinePoints(timeline) {
    return [...timeline].sort(([left], [right]) => left - right)
        .map(([time, bucket]) => ({ x: time, y: bucket.total / bucket.count, count: bucket.count }));
}

function aggregateData(records, filters = {}, now = Date.now()) {
    const filtered = filterRecords(records, filters, now);
    const bucketSize = filters.range === '72h' ? 3600000 : DAY;
    const regions = new Map();
    const pairs = new Map();
    const latencies = [];
    const abnormal = [];
    let latencySum = 0;
    let bandwidthSum = 0;
    let bandwidthCount = 0;

    for (const record of filtered) {
        const time = Math.floor(record.timestamp / bucketSize) * bucketSize;
        const anomaly = isAbnormal(record);
        latencySum += record.latency;
        latencies.push(record.latency);
        if (anomaly) abnormal.push(record);
        if (record.bandwidth !== null) {
            bandwidthSum += record.bandwidth;
            bandwidthCount++;
        }
        if (!regions.has(record.region)) {
            regions.set(record.region, {
                id: record.region, name: formatRegionName(record.region), count: 0,
                latencySum: 0, bandwidthSum: 0, bandwidthCount: 0, anomalies: 0, latencies: [], timeline: new Map()
            });
        }
        const region = regions.get(record.region);
        region.count++;
        region.latencySum += record.latency;
        region.latencies.push(record.latency);
        region.anomalies += Number(anomaly);
        if (record.bandwidth !== null) {
            region.bandwidthSum += record.bandwidth;
            region.bandwidthCount++;
        }
        addBucket(region.timeline, time, record);

        const pairId = JSON.stringify([record.source, record.destination]);
        if (!pairs.has(pairId)) {
            pairs.set(pairId, { id: pairId, source: record.source, destination: record.destination, total: 0, count: 0, timeline: new Map() });
        }
        const pair = pairs.get(pairId);
        pair.total += record.latency;
        pair.count++;
        addBucket(pair.timeline, time, record);
    }

    return {
        summary: {
            tests: filtered.length,
            regions: regions.size,
            avgLatency: filtered.length ? latencySum / filtered.length : null,
            p95Latency: percentile(latencies),
            avgBandwidth: bandwidthCount ? bandwidthSum / bandwidthCount : null,
            anomalies: abnormal.length,
            healthyPercent: filtered.length ? (filtered.length - abnormal.length) / filtered.length * 100 : null,
            latest: filtered[0]?.timestamp ?? null
        },
        regions: [...regions.values()].map(region => ({
            id: region.id, name: region.name, count: region.count,
            latency: region.latencySum / region.count,
            p95: percentile(region.latencies),
            bandwidth: region.bandwidthCount ? region.bandwidthSum / region.bandwidthCount : null,
            anomalies: region.anomalies,
            timeline: timelinePoints(region.timeline)
        })).sort((left, right) => left.name.localeCompare(right.name)),
        pairs: [...pairs.values()].map(pair => ({
            id: pair.id, source: pair.source, destination: pair.destination,
            latency: pair.total / pair.count, count: pair.count, timeline: timelinePoints(pair.timeline)
        })).sort((left, right) => left.id.localeCompare(right.id)),
        recent: filtered.slice(0, 100),
        abnormal: abnormal.slice(0, 50)
    };
}

function convertToCSV(records) {
    const escape = value => {
        let text = String(value ?? '');
        if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [['Timestamp (UTC)', 'Region', 'Source', 'Destination', 'Bandwidth (Gb/s)', 'Latency (us)']];
    for (const record of records) {
        rows.push([new Date(record.timestamp).toISOString(), record.region, record.source, record.destination,
            record.bandwidth?.toFixed(2) ?? '', record.latency.toFixed(2)]);
    }
    return rows.map(row => row.map(escape).join(',')).join('\r\n');
}

function generateDemoData(now = Date.now(), range = '30d') {
    const regions = ['francecentral', 'westeurope', 'northeurope', 'swedencentral', 'germanywestcentral',
        'uksouth', 'belgiumcentral', 'eastus', 'eastus2', 'centralus', 'japaneast', 'southeastasia'];
    const baselines = [180, 215, 240, 135, 155, 190, 125, 420, 360, 310, 280, 340];
    const rows = [];
    let seed = 42;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const days = RANGE_DAYS[range] || 30;
    const intervalSize = days > 30 ? 21600000 : 7200000;
    const latest = Math.floor(now / intervalSize) * intervalSize;
    for (let interval = 0; interval < days * DAY / intervalSize; interval++) {
        for (const [regionIndex, region] of regions.entries()) {
            for (let source = 1; source <= 3; source++) {
                for (let destination = 1; destination <= 3; destination++) {
                    const sameZone = source === destination;
                    const spike = random() > 0.989;
                    const baseline = sameZone ? 38 + regionIndex * 5 : baselines[regionIndex] + source * 12;
                    const latency = Math.max(1, baseline * (0.85 + random() * 0.3) * (spike ? 8 : 1));
                    const bandwidth = (sameZone ? 25 : 17 + random() * 7) * (spike ? 0.6 : 1);
                    rows.push([new Date(latest - interval * intervalSize).toISOString(), region, `az${source}`, `az${destination}`,
                        `${bandwidth.toFixed(2)} Gb/sec`, `${latency.toFixed(2)} us`]);
                }
            }
        }
    }
    return { schemaVersion: 1, columns: COLUMNS, rows, meta: { fetchedAt: new Date(now).toISOString(), truncated: false } };
}

function cacheOperation(mode, key, value) {
    return new Promise(resolve => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const open = indexedDB.open('azure-netbench', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
        open.onerror = open.onblocked = () => resolve(null);
        open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction('snapshots', mode);
            const store = transaction.objectStore('snapshots');
            const request = mode === 'readonly' ? store.get(key) : store.put(value, key);
            transaction.oncomplete = () => { database.close(); resolve(request.result ?? null); };
            transaction.onerror = transaction.onabort = () => { database.close(); resolve(null); };
        };
    }).catch(() => null);
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    const state = { loadId: 0, normalized: null, filters: {}, phase: 'loading', loading: false, stale: false };
    let controller;

    function publish(extra = {}) {
        if (!state.normalized) return;
        self.postMessage({
            type: 'result', loadId: state.loadId, phase: state.phase, loading: state.loading, stale: state.stale,
            model: aggregateData(state.normalized.records, state.filters),
            options: state.normalized.options, meta: state.normalized.meta, ...extra
        });
    }

    async function load(message) {
        controller?.abort();
        controller = new AbortController();
        const requestController = controller;
        state.loadId = message.loadId;
        state.filters = message.filters;
        state.loading = true;
        state.stale = false;
        state.normalized = null;
        const current = () => state.loadId === message.loadId;
        if (message.demo) {
            state.normalized = normalizeData(generateDemoData(Date.now(), message.filters.range));
            state.phase = 'demo';
            state.loading = false;
            publish();
            return;
        }

        const endpoint = new URL(message.endpoint, self.location.origin);
        endpoint.searchParams.set('range', message.filters.range === 'all' ? '365d' : message.filters.range);
        endpoint.searchParams.set('format', 'compact');
        const cacheKey = endpoint.href;
        let cached = await cacheOperation('readonly', cacheKey);
        if (!current()) return;
        if (cached && Date.now() - cached.savedAt < DAY) {
            try {
                state.normalized = normalizeData(cached.payload);
                state.normalized.meta.fetchedAt = cached.fetchedAt;
                state.phase = 'cache';
                state.stale = true;
                publish();
            } catch {
                cached = null;
            }
        } else {
            cached = null;
        }

        const timeout = setTimeout(() => requestController.abort(), 120000);
        try {
            const headers = cached?.etag ? { 'If-None-Match': cached.etag } : {};
            const response = await fetch(endpoint, { headers, signal: requestController.signal, cache: 'no-cache' });
            if (!current()) return;
            if (response.status !== 304 && !response.ok) throw new Error(`The data API is unavailable (HTTP ${response.status}).`);
            const payload = response.status === 304 && cached ? cached.payload : await response.json();
            if (!current()) return;
            state.normalized = normalizeData(payload);
            state.normalized.meta.fetchedAt = response.headers.get('X-Data-Fetched-At') || payload.meta?.fetchedAt ||
                (response.status === 304 ? cached?.fetchedAt : null) || new Date().toISOString();
            state.normalized.meta.truncated = payload.meta?.truncated === true || response.headers.get('X-Data-Truncated') === 'true';
            state.phase = 'live';
            state.stale = response.headers.get('X-Data-Stale') === 'true';
            state.loading = false;
            publish({ cache: response.headers.get('X-Data-Cache') });
            void cacheOperation('readwrite', cacheKey, {
                payload, fetchedAt: state.normalized.meta.fetchedAt, savedAt: Date.now(),
                etag: response.headers.get('ETag') || (response.status === 304 ? cached?.etag : null)
            });
        } catch (error) {
            if (!current()) return;
            state.loading = false;
            state.stale = true;
            publish();
            self.postMessage({
                type: 'error', loadId: state.loadId, hasData: Boolean(state.normalized),
                message: requestController.signal.aborted ? 'The data request timed out. Please retry.' : error.message
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    self.onmessage = event => {
        const message = event.data;
        if (message.type === 'load') {
            void load(message).catch(error => {
                if (state.loadId === message.loadId) self.postMessage({ type: 'error', loadId: message.loadId, hasData: false, message: error.message });
            });
        } else if (message.loadId === state.loadId && message.type === 'filter') {
            state.filters = message.filters;
            publish();
        } else if (message.loadId === state.loadId && message.type === 'export' && state.normalized) {
            const csv = convertToCSV(filterRecords(state.normalized.records, state.filters));
            self.postMessage({ type: 'export', loadId: state.loadId, csv });
        }
    };
}

if (typeof module !== 'undefined') {
    module.exports = { parseMetric, normalizeData, filterRecords, aggregateData, convertToCSV, generateDemoData, formatRegionName };
}
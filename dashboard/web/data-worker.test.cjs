const assert = require('node:assert/strict');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');
const { parseMetric, normalizeData, aggregateData, filterRecords, convertToCSV, generateDemoData, formatRegionName } = require('./data-worker');
const now = Date.parse('2026-09-17T12:00:00Z');

function row(latency, source = 'az1', destination = 'az2', region = 'frc', timestamp = now) {
    return { Timestamp: new Date(timestamp).toISOString(), RowKey: region, Source: source,
        Destination: destination, Bandwidth: '15000 Mb/sec', Latency: `${latency} us` };
}

test('normalizes bandwidth and latency units without inventing zero measurements', () => {
    assert.equal(parseMetric('15000 Mb/sec', 'bandwidth'), 15);
    assert.equal(parseMetric('15 Gbits/sec', 'bandwidth'), 15);
    assert.equal(parseMetric('125000000 bits/sec', 'bandwidth'), 0.125);
    assert.equal(parseMetric('0.125 ms', 'latency'), 125);
    assert.equal(parseMetric('12 \u00b5s', 'latency'), 12);
    assert.equal(parseMetric('12 \u03bcs', 'latency'), 12);
    assert.equal(parseMetric('500 ns', 'latency'), 0.5);
    assert.equal(parseMetric('-12 us', 'latency'), null);
    assert.equal(parseMetric('unavailable', 'bandwidth'), null);
    assert.equal(parseMetric(Infinity, 'latency'), null);
});

test('supports the legacy API, rejects synthetic fallback data and skips corrupt samples', () => {
    const result = normalizeData([row(100), { ...row(200), Timestamp: 'invalid' }, row(-1)]);
    assert.equal(result.records.length, 1);
    assert.equal(result.meta.skipped, 2);
    assert.equal(result.options.regions[0].name, 'France Central');
    assert.equal(formatRegionName('centralindia'), 'Central India');
    assert.throws(() => normalizeData([{ PartitionKey: 'fallback' }]), /synthetic/);
    assert.throws(() => normalizeData({ schemaVersion: 2 }), /unsupported/);
});

test('preserves weighted region means, directional AZ series and exact anomaly thresholds', () => {
    const records = normalizeData([row(100), row(300), row(800, 'az2', 'az1'),
        row(500, 'az1', 'az1'), row(501, 'az1', 'az1'), row(1000), row(1001)]).records;
    const result = aggregateData(records, { range: '72h' }, now);
    assert.equal(result.summary.tests, 7);
    assert.equal(result.summary.avgLatency, 4202 / 7);
    assert.equal(result.summary.avgBandwidth, 15);
    assert.equal(result.summary.p95Latency, 1001);
    assert.equal(result.summary.anomalies, 2);
    assert.equal(result.regions[0].latency, 4202 / 7);
    assert.equal(result.regions[0].timeline[0].y, 4202 / 7);
    assert.equal(result.pairs.length, 3);
    assert.equal(result.pairs.find(pair => pair.source === 'az2').latency, 800);
    assert.equal(result.pairs.find(pair => pair.source === 'az1' && pair.destination === 'az2').latency, 600.25);
});

test('combines multiselect, date and intra/inter-zone filters without mutating records', () => {
    const records = normalizeData([row(200, 'az1', 'az2'), row(50, 'az1', 'az1'),
        row(900, 'az1', 'az2', 'we'), row(100, 'az1', 'az2', 'frc', now - 8 * 86400000)]).records;
    const filters = { range: '7d', regions: ['frc'], sources: ['az1'], destinations: ['az2'], scope: 'inter' };
    assert.equal(filterRecords(records, filters, now).length, 1);
    assert.equal(aggregateData(records, { scope: 'intra' }, now).summary.avgLatency, 50);
    assert.equal(aggregateData(records, { regions: ['missing'] }, now).summary.avgLatency, null);
    assert.equal(records.length, 4);
});

test('exports all filtered rows with quoting and spreadsheet formula protection', () => {
    const records = normalizeData([row(125, 'az1', 'az2', '=SUM(1,2)'), row(200, 'az1', 'az2', 'a"b')]).records;
    const csv = convertToCSV(records);
    assert.match(csv, /"'=SUM\(1,2\)"/);
    assert.match(csv, /"a""b"/);
    assert.equal(csv.split('\r\n').length, 3);
});

test('includes exact 90-day and 365-day boundaries in filters, charts and exports', () => {
    const day = 86400000;
    const ages = [0, 30 * day, 30 * day + 1, 90 * day, 90 * day + 1, 365 * day, 365 * day + 1, -1];
    const records = normalizeData(ages.map(age => row(125, 'az1', 'az2', 'frc', now - age))).records;

    for (const [range, expectedCount] of [['30d', 2], ['90d', 4], ['365d', 6], ['all', 6]]) {
        const filtered = filterRecords(records, { range }, now);
        const result = aggregateData(records, { range }, now);
        assert.equal(filtered.length, expectedCount);
        assert.equal(result.summary.tests, expectedCount);
        assert.equal(result.summary.avgLatency, 125);
        assert.equal(result.summary.p95Latency, 125);
        assert.ok(result.regions[0].timeline.every(point => point.x % day === 0));
        assert.equal(result.regions[0].timeline.reduce((count, point) => count + point.count, 0), expectedCount);
        assert.equal(result.pairs[0].timeline.reduce((count, point) => count + point.count, 0), expectedCount);
        assert.equal(convertToCSV(filtered).split('\r\n').length, expectedCount + 1);
    }
    assert.deepEqual(filterRecords(records, { range: 'all' }, now), filterRecords(records, { range: '365d' }, now));
});

test('demo data spans the requested 90-day and yearly windows with bounded size', () => {
    for (const [range, days] of [['90d', 90], ['all', 365]]) {
        const demo = generateDemoData(now, range);
        const newest = Date.parse(demo.rows[0][0]);
        const oldest = Date.parse(demo.rows.at(-1)[0]);
        assert.ok(newest <= now);
        assert.ok(oldest >= now - days * 86400000);
        assert.ok(oldest < now - (days - 1) * 86400000);
        assert.ok(demo.rows.length < 200000);
    }
});

test('handles a 200,000-row snapshot and only transfers bounded chart and table results', () => {
    const demo = generateDemoData(now);
    assert.deepEqual(demo.rows[0], generateDemoData(now).rows[0]);
    const payload = { ...demo, rows: Array.from({ length: 200000 }, (_, index) => demo.rows[index % demo.rows.length]) };
    const start = performance.now();
    const normalized = normalizeData(payload);
    const result = aggregateData(normalized.records, { range: '30d' }, now);
    assert.equal(result.summary.tests, 200000);
    assert.equal(result.summary.regions, 12);
    assert.equal(result.pairs.length, 9);
    assert.equal(result.recent.length, 100);
    assert.equal(result.abnormal.length, 50);
    assert.ok(result.regions.every(region => region.timeline.length <= 31));
    assert.ok(JSON.stringify(result).length < 150000);
    console.log(`200,000 rows normalized and aggregated in ${Math.round(performance.now() - start)} ms`);
});
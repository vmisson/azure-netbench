const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TableClient } = require('@azure/data-tables');
const { gunzipSync } = require('node:zlib');

function freshHandler() {
    delete require.cache[require.resolve('./index')];
    return require('./index');
}

function mockStorage(testContext, entities) {
    return testContext.mock.method(TableClient.prototype, 'listEntities', function () {
        return (async function* () {
            yield* entities;
        })();
    });
}

async function invoke(handler, query = {}, headers = {}) {
    const context = { log() {}, error() {} };
    await handler(context, { method: 'GET', query, headers });
    return context.res;
}

const sample = {
    partitionKey: 'sample', rowKey: 'francecentral', Source: 'az1', Destination: 'az2',
    Bandwidth: '15.23 Gb/sec', Latency: '125 us', timestamp: new Date().toISOString()
};

test('filters the storage query by date and projects only dashboard columns', async (testContext) => {
    const handler = freshHandler();
    let query;
    const timestamp = new Date().toISOString();
    testContext.mock.method(TableClient.prototype, 'listEntities', function (options) {
        query = options;
        return (async function* () {
            yield {
                partitionKey: 'sample',
                rowKey: 'francecentral',
                Source: 'az1',
                Destination: 'az2',
                Bandwidth: '15.23 Gb/sec',
                Latency: '125 us',
                timestamp
            };
        })();
    });
    const context = { log() {}, error() {} };

    await handler(context, { query: {}, headers: {} });

    assert.equal(context.res.status, 200);
    assert.match(query.queryOptions.filter, /^Timestamp ge datetime'/);
    const cutoff = Date.parse(query.queryOptions.filter.split("'")[1]);
    assert.ok(Math.abs(Date.now() - cutoff - 30 * 86400000) < 5000);
    assert.deepEqual(query.queryOptions.select, [
        'PartitionKey', 'RowKey', 'Source', 'Destination', 'Bandwidth', 'Latency', 'Timestamp'
    ]);
    assert.equal(JSON.parse(context.res.body)[0].RowKey, 'francecentral');
});

test('shares concurrent reads and reuses the warm cache', async (testContext) => {
    const storage = mockStorage(testContext, [sample]);
    const handler = freshHandler();
    const responses = await Promise.all([invoke(handler), invoke(handler), invoke(handler)]);
    const cached = await invoke(handler);
    assert.equal(storage.mock.callCount(), 1);
    assert.equal(responses[0].headers['X-Data-Cache'], 'MISS');
    assert.equal(responses[1].headers['X-Data-Cache'], 'COALESCED');
    assert.equal(cached.headers['X-Data-Cache'], 'HIT');
});

test('supports compact gzip responses and conditional HTTP validation', async (testContext) => {
    mockStorage(testContext, [sample]);
    const handler = freshHandler();
    const query = { range: '7d', format: 'compact' };
    const response = await invoke(handler, query, { 'accept-encoding': 'br, gzip' });
    const payload = JSON.parse(gunzipSync(response.body).toString());
    assert.equal(response.headers['Content-Encoding'], 'gzip');
    assert.equal(payload.schemaVersion, 1);
    assert.deepEqual(payload.rows[0], [sample.timestamp, 'francecentral', 'az1', 'az2', '15.23 Gb/sec', '125 us']);
    assert.equal(payload.meta.truncated, false);
    const unchanged = await invoke(handler, query, { 'if-none-match': response.headers.ETag });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.body, undefined);
    const uncompressed = await invoke(handler, query, { 'accept-encoding': 'gzip;q=0' });
    assert.equal(uncompressed.headers['Content-Encoding'], undefined);
    assert.equal(JSON.parse(uncompressed.body).rows.length, 1);
});

test('keeps date ranges separate and rejects invalid query parameters', async (testContext) => {
    const storage = mockStorage(testContext, []);
    const handler = freshHandler();
    await invoke(handler, { range: '72h' });
    await invoke(handler, { range: '7d' });
    const query = storage.mock.calls[0].arguments[0];
    const cutoff = Date.parse(query.queryOptions.filter.split("'")[1]);
    assert.ok(Math.abs(Date.now() - cutoff - 3 * 86400000) < 5000);
    assert.ok(query.abortSignal instanceof AbortSignal);
    assert.equal((await invoke(handler, { range: 'invalid' })).status, 400);
    assert.equal((await invoke(handler, { range: '__proto__' })).status, 400);
    assert.equal((await invoke(handler, { format: 'xml' })).status, 400);
    assert.equal(storage.mock.callCount(), 2);
});

test('queries 90-day and 365-day windows and shares the yearly cache with all', async (testContext) => {
    const storage = mockStorage(testContext, [sample]);
    const handler = freshHandler();
    const clock = Date.now();
    testContext.mock.method(Date, 'now', () => clock);

    for (const [range, days] of [['90d', 90], ['365d', 365]]) {
        const response = await invoke(handler, { range, format: 'compact' });
        assert.equal(response.status, 200);
        const payload = JSON.parse(response.body);
        const since = new Date(clock - days * 86400000).toISOString();
        assert.equal(payload.meta.range, range);
        assert.equal(payload.meta.since, since);
        assert.equal(storage.mock.calls.at(-1).arguments[0].queryOptions.filter, `Timestamp ge datetime'${since}'`);
    }

    const yearly = await invoke(handler, { range: '365d', format: 'compact' });
    const history = await invoke(handler, { range: 'all', format: 'compact' });
    assert.equal(JSON.parse(history.body).meta.range, '365d');
    assert.equal(history.headers['X-Data-Cache'], 'HIT');
    assert.equal(history.headers.ETag, yearly.headers.ETag);
    assert.equal(storage.mock.callCount(), 2);
});

test('reports truncation without falsely flagging an exactly full result', async (testContext) => {
    const previousLimit = process.env.MAX_RESULTS;
    process.env.MAX_RESULTS = '1';
    testContext.after(() => {
        if (previousLimit === undefined) delete process.env.MAX_RESULTS;
        else process.env.MAX_RESULTS = previousLimit;
    });
    const storage = mockStorage(testContext, [sample, sample]);
    const truncated = await invoke(freshHandler(), { format: 'compact' });
    assert.equal(JSON.parse(truncated.body).meta.truncated, true);
    storage.mock.mockImplementation(() => (async function* () { yield sample; })());
    const complete = await invoke(freshHandler(), { format: 'compact' });
    assert.equal(JSON.parse(complete.body).meta.truncated, false);
});

test('returns an honest service error instead of synthetic benchmark results', async (testContext) => {
    testContext.mock.method(TableClient.prototype, 'listEntities', function () {
        throw new Error('Storage offline');
    });
    const response = await invoke(freshHandler());
    assert.equal(response.status, 503);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(typeof JSON.parse(response.body).error, 'string');
});

test('serves stale data on a refresh failure only within the grace period', async (testContext) => {
    const clock = Date.now();
    const dateMock = testContext.mock.method(Date, 'now', () => clock);
    const storage = mockStorage(testContext, [sample]);
    const handler = freshHandler();
    await invoke(handler);
    dateMock.mock.mockImplementation(() => clock + 301000);
    storage.mock.mockImplementation(() => { throw new Error('Storage offline'); });
    const response = await invoke(handler);
    assert.equal(response.status, 200);
    assert.equal(response.headers['X-Data-Stale'], 'true');
    assert.equal(response.headers['X-Data-Cache'], 'STALE');
    dateMock.mock.mockImplementation(() => clock + 2101000);
    assert.equal((await invoke(handler)).status, 503);
});

test('allows conditional-request CORS preflights without accessing storage', async (testContext) => {
    const storage = mockStorage(testContext, []);
    const context = { log() {}, error() {} };
    await freshHandler()(context, { method: 'OPTIONS' });
    assert.equal(context.res.status, 204);
    assert.match(context.res.headers['Access-Control-Allow-Headers'], /If-None-Match/);
    assert.equal(storage.mock.callCount(), 0);
});
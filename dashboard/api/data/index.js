const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');
const { createHash } = require('node:crypto');
const { gzip } = require('node:zlib');
const { promisify } = require('node:util');

const compress = promisify(gzip);
const ranges = { '72h': 3, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const columns = ['Timestamp', 'RowKey', 'Source', 'Destination', 'Bandwidth', 'Latency'];
const snapshots = new Map();
const pendingReads = new Map();
const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag, X-Data-Cache, X-Data-Stale, X-Data-Truncated, X-Data-Fetched-At',
    'Vary': 'Accept-Encoding'
};

function setting(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const cacheTtl = setting('CACHE_TTL_SECONDS', 300) * 1000;
const staleTtl = setting('STALE_IF_ERROR_SECONDS', 1800) * 1000;
const maxResults = setting('MAX_RESULTS', 2000000);
let tableClient;

async function readStorage(range) {
    if (!tableClient) {
        const account = process.env.AZURE_STORAGE_ACCOUNT_NAME || 'sanetprdfrc001';
        tableClient = new TableClient(
            `https://${account}.table.core.windows.net`,
            process.env.AZURE_STORAGE_TABLE_NAME || 'perf',
            new DefaultAzureCredential()
        );
    }

    const since = new Date(Date.now() - ranges[range] * 86400000).toISOString();
    const entities = [];
    let truncated = false;
    const iterator = tableClient.listEntities({
        abortSignal: AbortSignal.timeout(setting('STORAGE_TIMEOUT_MS', 45000)),
        queryOptions: {
            filter: `Timestamp ge datetime'${since}'`,
            select: ['PartitionKey', 'RowKey', 'Source', 'Destination', 'Bandwidth', 'Latency', 'Timestamp']
        }
    });

    for await (const entity of iterator) {
        if (entities.length >= maxResults) {
            truncated = true;
            break;
        }
        entities.push({
            PartitionKey: entity.partitionKey,
            RowKey: entity.rowKey,
            Source: entity.Source,
            Destination: entity.Destination,
            Bandwidth: entity.Bandwidth,
            Latency: entity.Latency,
            Timestamp: entity.timestamp
        });
    }

    const fetchedAt = Date.now();
    return {
        entities,
        fetchedAt,
        meta: { range, since, fetchedAt: new Date(fetchedAt).toISOString(), count: entities.length, truncated },
        representations: new Map()
    };
}

async function getSnapshot(range, context) {
    const cached = snapshots.get(range);
    if (cached && Date.now() - cached.fetchedAt < cacheTtl) {
        return { snapshot: cached, cache: 'HIT', stale: false };
    }

    const coalesced = pendingReads.has(range);
    if (!coalesced) {
        const pending = readStorage(range).then(snapshot => {
            snapshots.set(range, snapshot);
            context.log(`Loaded ${snapshot.entities.length} rows for ${range}; truncated=${snapshot.meta.truncated}`);
            return snapshot;
        }).finally(() => pendingReads.delete(range));
        pendingReads.set(range, pending);
    }

    try {
        return { snapshot: await pendingReads.get(range), cache: coalesced ? 'COALESCED' : 'MISS', stale: false };
    } catch (error) {
        if (cached && Date.now() - cached.fetchedAt < cacheTtl + staleTtl) {
            context.error('Storage unavailable; serving the last snapshot:', error);
            return { snapshot: cached, cache: 'STALE', stale: true };
        }
        throw error;
    }
}

function representation(snapshot, format) {
    if (!snapshot.representations.has(format)) {
        const payload = format === 'compact' ? {
            schemaVersion: 1,
            columns,
            rows: snapshot.entities.map(entity => columns.map(column => entity[column])),
            meta: snapshot.meta
        } : snapshot.entities;
        const body = JSON.stringify(payload);
        const etag = `W/"${createHash('sha256').update(body).digest('hex')}"`;
        snapshot.representations.set(format, { body, etag });
    }
    return snapshot.representations.get(format);
}

module.exports = async function (context, req) {
    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers: corsHeaders };
        return;
    }

    const requestedRange = req.query?.range || '30d';
    const range = requestedRange === 'all' ? '365d' : requestedRange;
    const format = req.query?.format || 'raw';
    if (!Object.hasOwn(ranges, range) || !['raw', 'compact'].includes(format)) {
        context.res = {
            status: 400,
            headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ error: 'Use range=72h, 7d, 30d, 90d, 365d or all and format=raw or compact.' })
        };
        return;
    }

    try {
        const { snapshot, cache, stale } = await getSnapshot(range, context);
        const result = representation(snapshot, format);
        const headers = {
            ...corsHeaders,
            'Cache-Control': 'public, no-cache',
            'ETag': result.etag,
            'X-Data-Cache': cache,
            'X-Data-Stale': String(stale),
            'X-Data-Truncated': String(snapshot.meta.truncated),
            'X-Data-Fetched-At': snapshot.meta.fetchedAt
        };
        const validators = (req.headers?.['if-none-match'] || '').split(',').map(value => value.trim());
        if (validators.includes(result.etag) || validators.includes('*')) {
            context.res = { status: 304, headers };
            return;
        }

        const acceptsGzip = (req.headers?.['accept-encoding'] || '').split(',').some(encoding => {
            const [name, quality] = encoding.trim().split(';');
            return name.toLowerCase() === 'gzip' && (!quality || Number(quality.trim().replace(/^q=/, '')) > 0);
        });
        let body = result.body;
        if (acceptsGzip) {
            result.compressed ??= compress(result.body);
            body = await result.compressed;
            headers['Content-Encoding'] = 'gzip';
        }
        context.res = { status: 200, headers, body, isRaw: true };
    } catch (error) {
        context.error('Error retrieving data from Azure Table Storage:', error);
        context.res = {
            status: 503,
            headers: { ...corsHeaders, 'Cache-Control': 'no-store', 'Retry-After': '30' },
            body: JSON.stringify({ error: 'Benchmark storage is temporarily unavailable. Please retry.' })
        };
    }
};

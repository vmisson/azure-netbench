const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Readable } = require('node:stream');

const host = process.env.HOST || '127.0.0.1';
const upstream = process.env.API_URL || 'https://fa-azure-network-benchmark.azurewebsites.net/api/data';
const localApi = process.env.LOCAL_API === '1' ? require('../api/data') : null;
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/script.js', ['script.js', 'application/javascript; charset=utf-8']],
    ['/data-worker.js', ['data-worker.js', 'application/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/netbench-logo.png', ['netbench-logo.png', 'image/png']]
]);

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
        response.end();
        return;
    }
    try {
        if (url.pathname === '/api/data') {
            if (localApi) {
                const context = { log: console.log, error: console.error };
                await localApi(context, { method: request.method, query: Object.fromEntries(url.searchParams), headers: request.headers });
                response.writeHead(context.res.status, context.res.headers);
                response.end(request.method === 'HEAD' ? undefined : context.res.body);
                return;
            }
            const target = new URL(upstream);
            for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
            const headers = request.headers['if-none-match'] ? { 'If-None-Match': request.headers['if-none-match'] } : {};
            const remote = await fetch(target, { method: request.method, headers, signal: AbortSignal.timeout(125000) });
            const outgoing = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
            for (const name of ['etag', 'x-data-cache', 'x-data-stale', 'x-data-truncated', 'x-data-fetched-at', 'retry-after']) {
                if (remote.headers.has(name)) outgoing[name] = remote.headers.get(name);
            }
            response.writeHead(remote.status, outgoing);
            if (remote.body) Readable.fromWeb(remote.body).on('error', () => response.destroy()).pipe(response);
            else response.end();
            return;
        }
        const asset = files.get(url.pathname);
        if (!asset) { response.writeHead(404); response.end('Not found'); return; }
        const body = await readFile(join(__dirname, asset[0]));
        response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
        console.error('Local request failed:', error.message);
        if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'The data API could not be reached.' }));
    }
});

const firstPort = Number(process.env.PORT || 4173);
function listen(port) {
    const onListening = () => {
        server.removeListener('error', onError);
        console.log(`Azure Netbench: http://${host}:${port}`);
        console.log(`Data source: ${localApi ? 'local Azure API (DefaultAzureCredential)' : upstream}`);
        console.log(`Demo: http://${host}:${port}/?demo=1`);
    };
    const onError = error => {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE' && port < firstPort + 20) listen(port + 1);
        else { console.error(error.message); process.exitCode = 1; }
    };
    server.once('error', onError);
    server.listen(port, host, onListening);
}
listen(firstPort);
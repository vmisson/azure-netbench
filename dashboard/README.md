# Azure Network Benchmark Dashboard

A comprehensive dashboard for visualizing Azure network performance data stored in Azure Table Storage.

## Architecture

- **Frontend**: Static Web App with responsive HTML5/CSS3/JavaScript
- **Backend**: Azure Functions API for data access
- **Data Storage**: Azure Table Storage containing network performance metrics
- **Infrastructure**: Terraform for Infrastructure as Code
- **Deployment**: Azure Developer CLI (azd)

## Features

- **Existing charts preserved**: Mean latency by region, latency evolution by region, and directional latency evolution by AZ pair.
- **Additional analysis**: P95 latency by region and an interactive source/destination AZ latency matrix.
- **Timeline inspection**: Hover near a curve to bring it to the foreground, dim other series, and display one tooltip with the full UTC date, latency and sample count. Hovering or focusing a legend item highlights its curve; clicking still toggles visibility. Highlighting redraws the chart without reloading or reaggregating measurements.
- **Bandwidth is informational only**: Individual measurements remain in result tables and CSV exports. There is no bandwidth chart or aggregate KPI because VM sizes are not recorded per region, making throughput comparisons misleading.
- **Filters**: Always-visible multiselect lists for regions and source/destination AZs, time windows, and intra/inter-zone traffic.
- **Results**: Latest 100 tests and latest 50 abnormal results, paginated in groups of 25. CSV exports include **all** matching measurements, not only the current table page.
- **Explicit data states**: Live, cached, partial, unavailable, or demo. Storage failures never silently become synthetic benchmark results.
- **Readable interface**: Full-width, vertically stacked latency charts, four primary summary metrics, larger high-contrast text and uncollapsed legends. Desktop, tablet and mobile layouts retain keyboard-accessible controls and reduced-motion support.
- **Automatic refresh**: Every five minutes while the page is visible; filters are retained. A tab returning from the background refreshes if its snapshot is older than five minutes.

### Loading Strategy

The browser requests only the selected window (`72h`, `7d`, `30d`, `90d`, or `365d`), in a compact column/row format. "Available history (365d)" uses the yearly window; the default selection remains seven days. The original array response remains available for older clients. The UI can also consume the existing deployed API, but the new Function must be deployed to support the longer windows.

- The Azure SDK date filter is passed through `queryOptions.filter`, with a projection of the required columns.
- The API reuses its Table client, caches snapshots for five minutes **per Function process**, and coalesces simultaneous requests for the same window into one Storage read. There are five possible cache keys; `all` and `365d` share the yearly cache.
- Serialized responses and gzip output are cached. ETags permit `304 Not Modified` responses without resending the dataset.
- A Web Worker performs fetching, parsing, normalization, filtering, aggregation and CSV generation. Only chart series and bounded table results reach the UI thread. Chart instances are updated in place.
- IndexedDB stores the last snapshot per endpoint/window for immediate display during revalidation. Snapshots older than 24 hours are not used. Cache failures do not prevent live requests.
- If Storage fails, the API can serve an expired snapshot during its configured grace period, explicitly marked stale. Without usable data it returns HTTP 503. Demo data is available only through an explicit user choice.

**Cold-read limitation:** Current producers use random UUID partition keys. Azure Table Storage does not index `Timestamp`, so even a correctly filtered first read can scan the table. These changes reduce repeat reads, transferred bytes and browser work; they do not make cold scans indexed. At larger scale, use a date-prefixed partition key (with migration/backfill), or periodically materialize dashboard snapshots in Blob Storage. Neither ingestion nor existing records are changed here.

**Coverage:** `MAX_RESULTS` remains a safety limit, not pagination or sampling. If exceeded, statistics and exports describe a partial result and the UI warns about it. Table key order is not chronological, so that partial result is not guaranteed to be the newest N records. Reducing the time window may avoid the limit. The old API does not report completeness, which is also made visible in the UI. "Available history" means the API's maximum 365-day query window, not all stored history. The 90-day and yearly windows retain the same 200,000-row default limit and 45-second Storage deadline; adding them does not change retention or create missing historical measurements.

**Calculations:** Region and AZ means use individual measurements, not unweighted averages of daily averages. P95 uses the nearest-rank percentile. Hourly buckets are used for 72 hours, daily buckets otherwise; buckets and displayed times use UTC. Abnormal thresholds are strictly greater than 500 microseconds intra-zone or 1,000 microseconds inter-zone. Invalid timestamps/latencies are excluded and counted; missing bandwidth is not treated as zero.

## Quick Start

### Prerequisites

- [Azure Developer CLI](https://docs.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli)
- Azure subscription

### Deployment

1. **Initialize the environment**:
   ```bash
   cd dashboard
   azd auth login
   azd init
   ```

2. **Deploy infrastructure and application**:
   ```bash
   azd up
   ```

3. **Access your dashboard**:
   The deployment will output the URL of your Static Web App.

### Local Development

Use Node.js 22 LTS or newer. No frontend build or package installation is required:

```bash
cd dashboard/web
npm start
```

Open **http://localhost:4173**. The local server proxies `/api/data` to the currently deployed Function, avoiding browser CORS issues. If the port is occupied, it selects the next available port and prints the URL. `HOST` and `PORT` can override the defaults. The local server is a development tool, not a production host.

Open **http://localhost:4173/?demo=1** for an explicitly labelled, deterministic demo dataset. An API failure does not activate this mode automatically.

To exercise the **modified API against real Storage** instead of the deployed Function:

```bash
cd dashboard/api
npm install
az login
cd ../web
npm run start:local-api
```

This invokes the Function handler through the local server using `DefaultAzureCredential`. The signed-in identity needs **Storage Table Data Reader** access to the benchmark account, and its network/firewall rules must allow the connection. No connection string or secret is sent to the frontend.

Alternatively, run the Azure Functions host (`npm start` in `dashboard/api`, with Functions Core Tools installed), then start the frontend with:

```bash
API_URL=http://127.0.0.1:7071/api/data npm start
```

For static hosting, configure the deployed Function URL using the `api-url` meta tag in `web/index.html`. The supplied Node server handles `/api/data` only during local development; a generic static file server does not provide this proxy. Chart.js, Bootstrap Icons and fonts load from CDN URLs or their original hosts, so the first page load requires internet access. The header and favicon use the original, locally hosted Netbench cloud/network mark (`web/netbench-logo.png`, with its editable source in `web/netbench-logo.svg`), not the official Azure logo.

### Verification

```bash
npm install --prefix dashboard/api
npm test --prefix dashboard/api
npm test --prefix dashboard/web
```

Tests use the built-in Node test runner. API tests mock Storage and cover query options, concurrent reads, warm/stale caches, ETag, gzip, range isolation, CORS, truncation and service errors. Frontend tests cover units, weighted means, directional pairs, percentile/anomaly thresholds, filters, CSV escaping and a 200,000-row dataset. No Azure subscription is needed for these tests.

Deploy **both** the frontend and Function to activate all optimizations in Azure. `npm start` does not deploy cloud resources. Terraform configures the Function runtime as Node.js 22.

## Configuration

### Environment Variables

The Azure Function requires these environment variables:

- `AZURE_STORAGE_ACCOUNT_NAME`: Name of your Azure Storage Account
- `AZURE_STORAGE_TABLE_NAME`: Name of the table containing performance data (default: "perf")
- `MAX_RESULTS`: Maximum rows per snapshot (default: `200000`)
- `CACHE_TTL_SECONDS`: In-process snapshot freshness (default: `300`)
- `STALE_IF_ERROR_SECONDS`: Additional stale-data grace period after cache expiry (default: `1800`)
- `STORAGE_TIMEOUT_MS`: Storage query deadline (default: `45000`)

### API Contract

`GET /api/data` preserves the legacy JSON array format and defaults to a 30-day window.

`GET /api/data?range=7d&format=compact` returns:

```json
{
   "schemaVersion": 1,
   "columns": ["Timestamp", "RowKey", "Source", "Destination", "Bandwidth", "Latency"],
   "rows": [["2026-09-17T10:00:00Z", "frc", "az1", "az2", "15.23 Gb/sec", "125 us"]],
   "meta": {
      "range": "7d",
      "since": "2026-09-10T10:00:00Z",
      "fetchedAt": "2026-09-17T10:00:00Z",
      "count": 1,
      "truncated": false
   }
}
```

Supported ranges: `72h`, `7d`, `30d`, `90d`, `365d`; `all` is an alias for `365d`. The API default without a `range` parameter remains `30d` for compatibility. Dashboard URLs accept `?range=90d`, `?range=all` and `?range=365d` (normalized to `all`). Unsupported parameters return HTTP 400. Clients may send `If-None-Match` and negotiate gzip. Response headers include `ETag`, `X-Data-Cache` (`MISS`, `HIT`, `COALESCED`, `STALE`), `X-Data-Stale`, `X-Data-Truncated` and `X-Data-Fetched-At`. These headers are exposed for cross-origin clients. HTTP responses require revalidation so stale/partial state remains visible; the server-side snapshot TTL controls Storage reads.

### Data Format

The expected data format in Azure Table Storage:

```json
{
  "PartitionKey": "test-partition",
  "RowKey": "region-name",
  "Source": "az1",
  "Destination": "az2", 
  "Bandwidth": "15.23 Gb/sec",
  "Latency": "125 us",
  "Timestamp": "2025-01-01T12:00:00Z"
}
```

## Project Structure

```
dashboard/
├── api/                    # Azure Functions backend
│   ├── data/               # HTTP trigger function and API tests
│   ├── host.json          # Functions runtime config
│   └── package.json       # Node.js dependencies
├── web/                   # Static web application
│   ├── index.html         # Main dashboard page
│   ├── script.js          # Dashboard logic and charts
│   ├── styles.css         # Responsive dashboard styles
│   ├── data-worker.js     # Fetching, browser cache and data processing
│   ├── data-worker.test.cjs # Calculation and large-dataset tests
│   ├── server.cjs         # Local static server and API proxy
│   └── package.json       # Static app metadata
├── infra/                 # Terraform infrastructure
│   ├── main.tf           # Main infrastructure resources
│   ├── variables.tf      # Input variables
│   ├── outputs.tf        # Output values
│   └── providers.tf      # Provider configurations
└── azure.yaml            # azd configuration
```

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript, Chart.js 4, Bootstrap Icons, Web Workers and IndexedDB
- **Backend**: Node.js, Azure Functions v4
- **Infrastructure**: Terraform, Azure Resource Manager
- **Storage**: Azure Table Storage
- **Identity**: Azure Managed Identity
- **Hosting**: Azure Static Web Apps, Azure Functions

## Monitoring and Troubleshooting

### View Logs

```bash
# Function App logs
az functionapp logs tail --name <function-app-name> --resource-group <resource-group>

# Application Insights (if configured)
# Check the Azure portal for Application Insights dashboard
```

### Common Issues

1. **API not responding**: Check Function App permissions and managed identity configuration
2. **Data not loading**: Verify storage account name and table name in environment variables
3. **Charts not displaying**: Check browser console for JavaScript errors

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

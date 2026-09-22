const COLORS = ['#087f8c', '#3777cf', '#d89524', '#d96068', '#668c3d', '#936d9d',
    '#369ab4', '#d47d48', '#6868a4', '#4b9180', '#a69a39', '#a96886'];
const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const timestampFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const tooltipTimestampFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', timeZone: 'UTC' });
const element = id => document.getElementById(id);
const formatted = (value, decimal = false) => value === null || value === undefined ? '--' : (decimal ? decimalFormat : numberFormat).format(value);

function setTimelineFocus(chart, datasetIndex, pointIndex = null) {
    if (datasetIndex !== null && !chart.isDatasetVisible(datasetIndex)) datasetIndex = null;
    if (datasetIndex === null) pointIndex = null;
    const seriesChanged = (chart.$focusedDataset ?? null) !== datasetIndex;
    const pointChanged = (chart.$focusedPoint ?? null) !== pointIndex;
    chart.$focusedDataset = datasetIndex;
    chart.$focusedPoint = pointIndex;
    if (seriesChanged) {
        const legend = chart.canvas.closest('.analysis-section')?.querySelector('.series-legend');
        legend?.querySelectorAll('.legend-item').forEach((button, index) => {
            button.classList.toggle('is-focused', index === datasetIndex);
            button.classList.toggle('is-muted', datasetIndex !== null && index !== datasetIndex);
        });
    }
    return seriesChanged || pointChanged;
}

const timelineFocusPlugin = {
    id: 'timelineFocus',
    afterEvent(chart, args) {
        const active = args.inChartArea && args.event.type !== 'mouseout' ? chart.getActiveElements()[0] : null;
        if (setTimelineFocus(chart, active?.datasetIndex ?? null, active?.index ?? null)) args.changed = true;
    },
    beforeDatasetsDraw(chart) {
        if (chart.$focusedDataset == null || !chart.isDatasetVisible(chart.$focusedDataset)) return;
        chart.ctx.save();
        chart.ctx.globalAlpha *= 0.16;
    },
    afterDatasetsDraw(chart) {
        if (chart.$focusedDataset == null || !chart.isDatasetVisible(chart.$focusedDataset)) return;
        const context = chart.ctx;
        context.restore();
        const meta = chart.getDatasetMeta(chart.$focusedDataset);
        const originalOptions = meta.dataset.options;
        const point = chart.$focusedPoint === null ? null : meta.data[chart.$focusedPoint];
        const area = chart.chartArea;
        context.save();
        context.beginPath();
        context.rect(area.left, area.top, area.width, area.height);
        context.clip();
        try {
            if (point) {
                context.strokeStyle = '#64798c';
                context.lineWidth = 1;
                context.setLineDash([4, 4]);
                context.beginPath();
                context.moveTo(point.x, area.top);
                context.lineTo(point.x, area.bottom);
                context.stroke();
                context.setLineDash([]);
            }
            meta.dataset.options = { ...originalOptions, borderWidth: 4 };
            meta.controller.draw();
            if (point) {
                context.beginPath();
                context.arc(point.x, point.y, 6, 0, Math.PI * 2);
                context.fillStyle = chart.data.datasets[chart.$focusedDataset].borderColor;
                context.fill();
                context.lineWidth = 2;
                context.strokeStyle = '#ffffff';
                context.stroke();
            }
        } finally {
            meta.dataset.options = originalOptions;
            context.restore();
        }
    }
};

class NetworkBenchmarkDashboard {
    constructor() {
        const params = new URLSearchParams(window.location.search);
        const requestedRange = params.get('range') === '365d' ? 'all' : params.get('range');
        const range = ['72h', '7d', '30d', '90d', 'all'].includes(requestedRange) ? requestedRange : '7d';
        this.filters = { regions: [], sources: [], destinations: [], range, scope: 'all' };
        this.demo = params.get('demo') === '1';
        this.charts = {};
        this.hiddenSeries = { regions: new Set(), pairs: new Set() };
        this.optionsKey = '';
        this.regionNames = new Map();
        this.latencySortOrder = 'alphabetical';
        this.activeLoad = 0;
        this.model = null;
        this.resultTab = 'recent';
        this.tablePage = 0;
        this.isLoading = false;
        this.lastRefresh = 0;
        element('timeFilter').value = range;
        element('dataSource').value = this.demo ? 'demo' : 'live';
        element('exportButton').setAttribute('aria-label', 'Export filtered results to CSV');
        element('exportButton').title = 'Export filtered results to CSV';
        this.setupEventListeners();
        if (typeof Worker === 'undefined' || typeof Chart === 'undefined') {
            this.showError('The chart library or Web Worker could not be loaded. Check your connection and reload the page.', false);
            return;
        }
        Chart.defaults.font.family = "'Manrope', sans-serif";
        Chart.defaults.font.size = 14;
        Chart.defaults.color = '#334155';
        Chart.defaults.animation = false;
        this.worker = new Worker('data-worker.js');
        this.worker.onmessage = event => this.handleWorkerMessage(event.data);
        this.worker.onerror = () => this.showError('The data worker stopped unexpectedly. Reload the page to reconnect.', Boolean(this.model));
        this.loadData();
        this.refreshInterval = setInterval(() => {
            if (!document.hidden && !this.demo && !this.isLoading) this.loadData();
        }, 5 * 60 * 1000);
    }

    setupEventListeners() {
        element('refreshButton').addEventListener('click', () => this.loadData());
        element('retryButton').addEventListener('click', () => this.loadData());
        element('demoButton').addEventListener('click', () => this.changeSource(true));
        element('dataSource').addEventListener('change', event => this.changeSource(event.target.value === 'demo'));
        element('exportButton').addEventListener('click', () => this.exportData());
        element('clearFiltersButton').addEventListener('click', () => this.clearFilters());
        element('emptyResetButton').addEventListener('click', () => this.clearFilters());
        element('timeFilter').addEventListener('change', event => {
            this.filters.range = event.target.value;
            this.loadData();
        });
        const filterGroups = { regionFilter: 'regions', sourceFilter: 'sources', destinationFilter: 'destinations' };
        for (const [id, key] of Object.entries(filterGroups)) {
            element(id).addEventListener('change', () => {
                this.filters[key] = [...element(id).querySelectorAll('input:checked')].map(input => input.value);
                this.applyFilters();
            });
        }
        document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => {
            this.filters[button.dataset.clear] = [];
            this.syncFilterControls();
            this.applyFilters();
        }));
        element('regionSearch').addEventListener('input', event => {
            const query = event.target.value.toLowerCase().trim();
            element('regionFilter').querySelectorAll('label').forEach(label => {
                label.hidden = !label.textContent.toLowerCase().includes(query) && !label.querySelector('input').value.includes(query);
            });
        });
        document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
            this.filters.scope = button.dataset.scope;
            this.applyFilters();
        }));
        document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => this.sortLatencyChart(button.dataset.sort)));
        element('allResultsTab').addEventListener('click', () => this.setResultTab('recent'));
        element('abnormalResultsTab').addEventListener('click', () => this.setResultTab('abnormal'));
        document.querySelector('.result-tabs').addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tab = event.key === 'Home' ? 'recent' : event.key === 'End' ? 'abnormal' : this.resultTab === 'recent' ? 'abnormal' : 'recent';
            this.setResultTab(tab);
            element(tab === 'recent' ? 'allResultsTab' : 'abnormalResultsTab').focus();
        });
        element('abnormalCard').addEventListener('click', () => {
            this.setResultTab('abnormal');
            element('results').scrollIntoView({ behavior: this.scrollBehavior() });
        });
        element('previousPage').addEventListener('click', () => { this.tablePage--; this.renderDataTable(); });
        element('nextPage').addEventListener('click', () => { this.tablePage++; this.renderDataTable(); });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.demo && !this.isLoading && Date.now() - this.lastRefresh > 300000) this.loadData();
        });
        window.addEventListener('pagehide', event => {
            if (!event.persisted) { this.worker?.terminate(); clearInterval(this.refreshInterval); }
        });
    }

    scrollBehavior() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    }

    changeSource(demo) {
        this.demo = demo;
        element('dataSource').value = demo ? 'demo' : 'live';
        this.loadData();
    }

    loadData() {
        if (!this.worker) return;
        this.activeLoad++;
        this.loadStarted = performance.now();
        this.lastRefresh = Date.now();
        this.isLoading = true;
        element('errorMessage').hidden = true;
        element('dataNotice').hidden = true;
        element('emptyState').hidden = true;
        element('refreshButton').disabled = true;
        element('exportButton').disabled = true;
        element('loadingSpinner').hidden = false;
        element('loadingText').textContent = this.demo ? 'Preparing demo measurements' : 'Fetching measurements from Azure Table Storage';
        element('loadTiming').textContent = '';
        element('main').setAttribute('aria-busy', 'true');
        this.setConnection(this.demo ? 'demo' : 'loading', this.demo ? 'Demo data' : 'Updating');
        const url = new URL(window.location.href);
        if (this.demo) url.searchParams.set('demo', '1');
        else url.searchParams.delete('demo');
        if (this.filters.range !== '7d') url.searchParams.set('range', this.filters.range);
        else url.searchParams.delete('range');
        window.history.replaceState(null, '', url);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
            window.location.hostname.endsWith('.app.github.dev') || window.location.hostname.endsWith('.devtunnels.ms');
        const endpoint = local ? '/api/data' : document.querySelector('meta[name="api-url"]').content;
        this.worker.postMessage({ type: 'load', loadId: this.activeLoad, filters: this.filters, demo: this.demo, endpoint });
    }

    handleWorkerMessage(message) {
        if (message.loadId !== this.activeLoad) return;
        if (message.type === 'error') {
            this.showError(message.message, message.hasData);
            return;
        }
        if (message.type === 'export') {
            const url = URL.createObjectURL(new Blob(['\uFEFF', message.csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `azure-netbench-${this.demo ? 'demo-' : ''}${this.filters.range}-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            element('exportButton').disabled = false;
            return;
        }
        if (message.type !== 'result') return;
        const wasLoading = this.isLoading;
        this.isLoading = message.loading;
        this.model = message.model;
        this.tablePage = 0;
        this.populateFilters(message.options);
        this.renderDashboard();
        this.updateStatus(message);
        if (wasLoading && !message.loading) element('loadTiming').textContent = `${((performance.now() - this.loadStarted) / 1000).toFixed(1)} s`;
    }

    updateStatus(message) {
        element('main').setAttribute('aria-busy', String(message.loading));
        element('loadingSpinner').hidden = !message.loading;
        element('refreshButton').disabled = message.loading;
        element('exportButton').disabled = message.loading || !this.model.summary.tests;
        if (message.phase === 'demo') {
            this.setConnection('demo', 'Demo data');
            element('loadingText').textContent = 'Demo dataset';
        } else if (message.stale || message.phase === 'cache') {
            this.setConnection('cache', 'Cached data');
            element('loadingText').textContent = message.loading ? 'Saved snapshot loaded. Checking for new measurements...' : 'Cached snapshot. Live data is currently unavailable.';
        } else {
            this.setConnection('live', 'Live data');
            element('loadingText').textContent = 'Data up to date';
        }
        const fetchedAt = Date.parse(message.meta.fetchedAt);
        element('lastUpdated').textContent = Number.isFinite(fetchedAt) ? `Snapshot ${timestampFormat.format(fetchedAt)} UTC` : 'Snapshot time unavailable';
        const notices = [];
        if (message.meta.truncated) notices.push(`Storage limit reached (${formatted(message.meta.received)} rows). Results are partial; reduce the time window.`);
        else if (message.meta.legacy && !this.demo) notices.push('The deployed API does not report dataset completeness. Results may be partial.');
        if (message.meta.skipped) notices.push(`${formatted(message.meta.skipped)} invalid measurements excluded.`);
        if (message.stale && !message.loading) notices.push('This is a saved snapshot, not a live update.');
        element('dataNoticeText').textContent = notices.join(' ');
        element('dataNotice').hidden = !notices.length;
        element('datasetInfo').textContent = `${formatted(message.meta.received)} rows loaded \u00b7 ${this.demo ? 'Demo dataset' : 'Azure Table Storage'} \u00b7 UTC`;
        if (message.stale) element('healthLabel').textContent = 'Saved snapshot';
        if (this.demo) element('healthLabel').textContent = `Demo \u00b7 ${formatted(this.model.summary.healthyPercent, true)}% within thresholds`;
    }

    setConnection(state, label) {
        element('connectionStatus').dataset.state = state;
        element('connectionText').textContent = label;
    }

    showError(message, hasData) {
        this.isLoading = false;
        element('main').setAttribute('aria-busy', 'false');
        element('loadingSpinner').hidden = true;
        element('refreshButton').disabled = false;
        element('exportButton').disabled = !hasData || !this.model?.summary.tests;
        element('errorTitle').textContent = hasData ? 'Live update unavailable' : 'Data unavailable';
        element('errorText').textContent = hasData ? `${message} The saved snapshot remains visible.` : message;
        element('errorMessage').hidden = false;
        element('loadingText').textContent = hasData ? 'Cached snapshot; live update failed' : 'No live measurements loaded';
        this.setConnection(hasData ? 'cache' : 'error', hasData ? 'Cached data' : 'Unavailable');
        element('healthLabel').textContent = hasData ? 'Saved snapshot' : 'Data unavailable';
        if (!hasData && this.model) {
            this.model = { summary: { tests: 0, regions: 0, avgLatency: null, p95Latency: null, avgBandwidth: null, anomalies: 0, healthyPercent: null }, regions: [], pairs: [], recent: [], abnormal: [] };
            this.renderDashboard();
            element('emptyState').hidden = true;
            element('healthLabel').textContent = 'Data unavailable';
            element('lastUpdated').textContent = 'No snapshot loaded';
            element('datasetInfo').textContent = 'No measurements loaded';
        }
    }

    populateFilters(options) {
        options.regions.forEach(region => this.regionNames.set(region.id, region.name));
        const key = JSON.stringify(options);
        if (key === this.optionsKey) {
            this.syncFilterControls();
            return;
        }
        this.optionsKey = key;
        const groups = [
            ['regionFilter', 'regions', options.regions],
            ['sourceFilter', 'sources', options.sources.map(id => ({ id, name: id }))],
            ['destinationFilter', 'destinations', options.destinations.map(id => ({ id, name: id }))]
        ];
        for (const [id, field, values] of groups) {
            const choices = new Map(values.map(value => [value.id, value.name]));
            this.filters[field].forEach(value => { if (!choices.has(value)) choices.set(value, this.regionNames.get(value) || value); });
            const fragment = document.createDocumentFragment();
            for (const [value, name] of choices) {
                const label = document.createElement('label');
                label.className = 'filter-option';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = value;
                input.checked = this.filters[field].includes(value);
                label.append(input, document.createTextNode(name));
                fragment.append(label);
            }
            element(id).replaceChildren(fragment);
        }
        element('regionSearch').dispatchEvent(new Event('input'));
        this.syncFilterControls();
    }

    syncFilterControls() {
        const groups = [['regionFilter', 'regions', 'regionFilterLabel', 'All regions'],
            ['sourceFilter', 'sources', 'sourceFilterLabel', 'All zones'],
            ['destinationFilter', 'destinations', 'destinationFilterLabel', 'All zones']];
        for (const [id, field, labelId, empty] of groups) {
            const values = this.filters[field];
            element(id).querySelectorAll('input').forEach(input => { input.checked = values.includes(input.value); });
            element(labelId).textContent = !values.length ? empty : values.length === 1 ? (field === 'regions' ? this.regionNames.get(values[0]) || values[0] : values[0]) : `${values.length} selected`;
        }
        document.querySelectorAll('[data-scope]').forEach(button => {
            const active = button.dataset.scope === this.filters.scope;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        element('selectionSummary').textContent = `${this.filters.regions.length ? `${this.filters.regions.length} selected regions` : 'All regions'} \u00b7 ${this.filters.scope === 'all' ? 'All AZ paths' : `${this.filters.scope === 'intra' ? 'Intra' : 'Inter'}-zone paths`}`;
        element('timeFilter').value = this.filters.range;
    }

    applyFilters() {
        this.syncFilterControls();
        this.worker?.postMessage({ type: 'filter', loadId: this.activeLoad, filters: this.filters });
    }

    clearFilters() {
        const changedRange = this.filters.range !== '7d';
        this.filters = { regions: [], sources: [], destinations: [], range: '7d', scope: 'all' };
        element('regionSearch').value = '';
        element('regionSearch').dispatchEvent(new Event('input'));
        this.syncFilterControls();
        if (changedRange) this.loadData();
        else this.applyFilters();
    }

    renderDashboard() {
        const summary = this.model.summary;
        for (const [id, value, decimal] of [['totalTests', summary.tests], ['uniqueRegions', summary.regions],
            ['avgLatency', summary.avgLatency], ['p95Latency', summary.p95Latency], ['abnormalCount', summary.anomalies]]) {
            const compact = value >= 100000 || (value >= 10000 && ['avgLatency', 'p95Latency'].includes(id));
            element(id).textContent = compact ? compactFormat.format(value) : formatted(value, decimal);
            element(id).title = formatted(value, decimal);
        }
        const rangeLabels = { '72h': 'Last 72 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'Available 365-day history' };
        element('totalTestsDetail').textContent = rangeLabels[this.filters.range];
        element('regionDetail').textContent = `${summary.regions} Azure ${summary.regions === 1 ? 'region' : 'regions'}`;
        element('abnormalDetail').textContent = summary.tests ? `${formatted(summary.anomalies / summary.tests * 100, true)}% of selected tests` : 'Above latency thresholds';
        element('abnormalCard').classList.toggle('healthy', summary.tests > 0 && !summary.anomalies);
        element('healthLabel').textContent = summary.tests ? `${formatted(summary.healthyPercent, true)}% within thresholds` : 'No matching measurements';
        element('emptyState').hidden = summary.tests > 0;
        element('regionChartDetail').textContent = `${summary.regions} regions \u00b7 Mean and P95 \u00b7 \u00b5s`;
        element('resultsTotal').textContent = `${formatted(summary.tests)} matching measurements`;
        element('recentBadge').textContent = formatted(summary.tests);
        element('anomalyBadge').textContent = formatted(summary.anomalies);
        document.querySelectorAll('.granularity-label').forEach(label => { label.textContent = this.filters.range === '72h' ? 'Hourly' : 'Daily'; });
        this.renderLatencyChart();
        this.renderTimeline('latencyEvolutionChart', this.model.regions.map(region => ({ id: region.id, label: region.name, data: region.timeline })), 'regions', 'regionLegend');
        this.renderTimeline('latencyAZPairsChart', this.model.pairs.map(pair => ({ id: pair.id, label: `${pair.source} \u2192 ${pair.destination}`, data: pair.timeline })), 'pairs', 'pairLegend');
        this.renderMatrix();
        this.renderDataTable();
    }

    chartOptions() {
        return {
            responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 80,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: '#24323e', padding: 14, cornerRadius: 4, titleFont: { size: 15 }, bodyFont: { size: 14 } } },
            scales: {
                x: { border: { display: false }, grid: { color: '#d9e1e7', drawTicks: false }, ticks: { padding: 12, font: { size: 14 }, maxTicksLimit: 6 } },
                y: { border: { display: false }, grid: { display: false }, ticks: { padding: 12, font: { size: 14 }, autoSkip: false } }
            }
        };
    }

    updateChart(id, type, data, options) {
        const canvas = element(id);
        const hasData = data.datasets.some(dataset => dataset.data.some(value => value !== null));
        canvas.closest('.chart-viewport, .line-chart-wrap').querySelector('.chart-empty').hidden = hasData;
        if (this.charts[id]) {
            if (type === 'line') setTimelineFocus(this.charts[id], null);
            this.charts[id].data = data;
            this.charts[id].options = options;
            this.charts[id].update('none');
        } else {
            this.charts[id] = new Chart(canvas, { type, data, options, plugins: type === 'line' ? [timelineFocusPlugin] : [] });
        }
    }

    sortedRegions() {
        const regions = [...this.model.regions];
        if (this.latencySortOrder === 'asc') regions.sort((left, right) => left.latency - right.latency);
        if (this.latencySortOrder === 'desc') regions.sort((left, right) => right.latency - left.latency);
        return regions;
    }

    renderLatencyChart() {
        if (!this.model) return;
        const regions = this.sortedRegions();
        element('latencyChartContainer').style.height = `${Math.max(440, regions.length * 38 + 56)}px`;
        const options = this.chartOptions();
        options.indexAxis = 'y';
        options.interaction.axis = 'y';
        options.scales.x.beginAtZero = true;
        options.scales.x.title = { display: true, text: 'One-way latency (\u00b5s)', font: { size: 14 } };
        options.plugins.tooltip.callbacks = {
            label: item => `${item.dataset.label}: ${formatted(item.raw, true)} \u00b5s`,
            afterTitle: items => `${formatted(regions[items[0].dataIndex].count)} measurements`
        };
        this.updateChart('latencyChart', 'bar', {
            labels: regions.map(region => region.name),
            datasets: [
                { label: 'Mean', data: regions.map(region => region.latency), backgroundColor: '#087f8c', borderRadius: 2, barThickness: 12 },
                { label: 'P95', data: regions.map(region => region.p95), backgroundColor: '#9bc9cf', borderRadius: 2, barThickness: 9 }
            ]
        }, options);
    }

    sortLatencyChart(order) {
        this.latencySortOrder = order;
        document.querySelectorAll('[data-sort]').forEach(button => {
            button.classList.toggle('active', button.dataset.sort === order);
            button.setAttribute('aria-pressed', String(button.dataset.sort === order));
        });
        this.renderLatencyChart();
    }

    renderTimeline(id, series, group, legendId) {
        const options = this.chartOptions();
        options.parsing = false;
        options.interaction.mode = 'nearest';
        options.interaction.axis = 'xy';
        options.scales.y.beginAtZero = true;
        options.scales.y.grid = { color: '#d9e1e7', drawTicks: false };
        options.scales.y.ticks = { maxTicksLimit: 6, padding: 12, font: { size: 14 } };
        options.scales.x.type = 'linear';
        options.scales.x.grid = { display: false };
        options.scales.x.ticks.stepSize = this.filters.range === '72h' ? 3600000 : 86400000;
        options.scales.x.ticks.callback = value => (this.filters.range === '72h' ? hourFormat : dayFormat).format(value);
        const times = series.flatMap(item => item.data.map(point => point.x));
        if (times.length) {
            options.scales.x.min = Math.min(...times);
            options.scales.x.max = Math.max(...times);
            if (options.scales.x.min === options.scales.x.max) {
                options.scales.x.min -= 3600000;
                options.scales.x.max += 3600000;
            }
        }
        options.plugins.tooltip.filter = (item, index) => index === 0;
        options.plugins.tooltip.displayColors = false;
        options.plugins.tooltip.titleFont = { size: 17 };
        options.plugins.tooltip.bodyFont = { size: 15 };
        options.plugins.tooltip.bodySpacing = 6;
        options.plugins.tooltip.titleMarginBottom = 10;
        options.plugins.tooltip.borderWidth = 2;
        options.plugins.tooltip.borderColor = context => context.tooltip?.dataPoints?.[0]?.dataset.borderColor || '#24323e';
        options.plugins.tooltip.callbacks = {
            title: items => items[0].dataset.label,
            beforeBody: items => `${tooltipTimestampFormat.format(items[0].parsed.x)} UTC`,
            label: item => `Latency: ${formatted(item.parsed.y, true)} \u00b5s`,
            afterLabel: item => `${formatted(item.raw.count)} measurements`
        };
        const datasets = series.map((item, index) => ({
            ...item, borderColor: COLORS[index % COLORS.length], backgroundColor: COLORS[index % COLORS.length],
            borderWidth: 2.5, pointRadius: item.data.length <= 8 ? 4 : 2, pointHoverRadius: 6,
            pointHitRadius: 12, tension: 0.18, spanGaps: false, fill: false, hidden: this.hiddenSeries[group].has(item.id)
        }));
        this.updateChart(id, 'line', { datasets }, options);
        const fragment = document.createDocumentFragment();
        datasets.forEach((dataset, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'legend-item';
            const chart = this.charts[id];
            button.classList.toggle('is-focused', chart.$focusedDataset === index);
            button.classList.toggle('is-muted', chart.$focusedDataset != null && chart.$focusedDataset !== index);
            button.setAttribute('aria-pressed', String(!dataset.hidden));
            button.title = `Toggle ${dataset.label}`;
            const swatch = document.createElement('span');
            swatch.className = 'legend-swatch';
            swatch.style.setProperty('--series-color', dataset.borderColor);
            button.append(swatch, document.createTextNode(dataset.label));
            const focus = () => {
                chart.setActiveElements([]);
                chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                setTimelineFocus(chart, index);
                chart.draw();
            };
            const clearFocus = () => {
                if (chart.$focusedDataset === index && setTimelineFocus(chart, null)) chart.draw();
            };
            button.addEventListener('mouseenter', focus);
            button.addEventListener('mouseleave', () => {
                if (document.activeElement !== button) clearFocus();
            });
            button.addEventListener('focus', focus);
            button.addEventListener('blur', () => {
                if (!button.matches(':hover')) clearFocus();
            });
            button.addEventListener('click', () => {
                const visible = chart.isDatasetVisible(index);
                if (visible) this.hiddenSeries[group].add(dataset.id);
                else this.hiddenSeries[group].delete(dataset.id);
                setTimelineFocus(chart, null);
                chart.setDatasetVisibility(index, !visible);
                chart.update('none');
                button.setAttribute('aria-pressed', String(!visible));
                if (!visible) focus();
            });
            fragment.append(button);
        });
        element(legendId).replaceChildren(fragment);
    }

    renderMatrix() {
        const pairs = this.model.pairs;
        if (!pairs.length) {
            const empty = document.createElement('div');
            empty.className = 'matrix-empty';
            empty.textContent = 'No matching measurements';
            element('azMatrix').replaceChildren(empty);
        } else {
            const sources = [...new Set(pairs.map(pair => pair.source))].sort();
            const destinations = [...new Set(pairs.map(pair => pair.destination))].sort();
            const minimum = Math.min(...pairs.map(pair => pair.latency));
            const maximum = Math.max(...pairs.map(pair => pair.latency));
            const table = document.createElement('table');
            table.className = 'heatmap';
            table.setAttribute('aria-label', 'Average latency from source rows to destination columns, in microseconds');
            const heading = table.createTHead().insertRow();
            ['', ...destinations].forEach(destination => {
                const cell = document.createElement('th');
                cell.scope = 'col';
                cell.textContent = destination;
                heading.append(cell);
            });
            const tbody = table.createTBody();
            for (const source of sources) {
                const row = tbody.insertRow();
                const heading = document.createElement('th');
                heading.scope = 'row';
                heading.textContent = source;
                row.append(heading);
                for (const destination of destinations) {
                    const pair = pairs.find(item => item.source === source && item.destination === destination);
                    const button = document.createElement('button');
                    button.className = `heat-cell${source === destination ? ' diagonal' : ''}`;
                    button.type = 'button';
                    button.disabled = !pair;
                    button.textContent = pair ? formatted(pair.latency) : '--';
                    const strength = pair ? (pair.latency - minimum) / (maximum - minimum || 1) : 0;
                    button.style.backgroundColor = `hsl(${160 + strength * 28} ${32 + strength * 9}% ${94 - strength * 54}%)`;
                    if (strength > 0.65) button.style.color = '#ffffff';
                    button.title = pair ? `${source} \u2192 ${destination}: ${formatted(pair.latency, true)} \u00b5s, ${formatted(pair.count)} tests` : 'No measurements for this path';
                    button.setAttribute('aria-label', button.title);
                    button.addEventListener('click', () => {
                        this.filters.sources = [source];
                        this.filters.destinations = [destination];
                        this.applyFilters();
                    });
                    row.insertCell().append(button);
                }
            }
            element('azMatrix').replaceChildren(table);
        }
        for (const [id, sameZone] of [['intraLatency', true], ['interLatency', false]]) {
            const matches = pairs.filter(pair => (pair.source === pair.destination) === sameZone);
            const count = matches.reduce((sum, pair) => sum + pair.count, 0);
            const mean = count ? matches.reduce((sum, pair) => sum + pair.latency * pair.count, 0) / count : null;
            element(id).textContent = `${formatted(mean)} \u00b5s`;
        }
    }

    setResultTab(tab) {
        this.resultTab = tab;
        this.tablePage = 0;
        for (const [id, name, panel] of [['allResultsTab', 'recent', 'recentPanel'], ['abnormalResultsTab', 'abnormal', 'abnormalPanel']]) {
            const active = name === tab;
            element(id).setAttribute('aria-selected', String(active));
            element(id).tabIndex = active ? 0 : -1;
            element(panel).hidden = !active;
        }
        this.renderDataTable();
    }

    renderDataTable() {
        const data = this.model?.[this.resultTab] || [];
        const pages = Math.max(1, Math.ceil(data.length / 25));
        this.tablePage = Math.max(0, Math.min(this.tablePage, pages - 1));
        const start = this.tablePage * 25;
        const fragment = document.createDocumentFragment();
        for (const record of data.slice(start, start + 25)) {
            const row = document.createElement('tr');
            const abnormal = record.latency > (record.source === record.destination ? 500 : 1000);
            const values = [timestampFormat.format(record.timestamp), this.regionNames.get(record.region) || record.region,
                record.source, record.destination, formatted(record.bandwidth, true), formatted(record.latency)];
            values.forEach((value, index) => {
                const cell = row.insertCell();
                cell.textContent = value;
                if (index === 0) cell.title = new Date(record.timestamp).toISOString();
                if (index === 2 || index === 3) cell.className = 'zone-tag';
                if (index === 4 || index === 5) {
                    cell.className = `numeric${index === 5 && abnormal ? ' high-latency' : ''}`;
                    const unit = document.createElement('span');
                    unit.className = 'cell-unit';
                    unit.textContent = index === 4 ? 'Gb/s' : '\u00b5s';
                    cell.append(unit);
                }
            });
            const badge = document.createElement('span');
            badge.className = `result-status${abnormal ? ' elevated' : ''}`;
            badge.textContent = abnormal ? 'Elevated' : 'Expected';
            row.insertCell().append(badge);
            fragment.append(row);
        }
        if (!data.length) {
            const row = document.createElement('tr');
            const cell = row.insertCell();
            cell.colSpan = 7;
            cell.className = 'table-empty';
            cell.textContent = this.resultTab === 'abnormal' ? 'No abnormal results in the selected measurements.' : 'No measurements match the current filters.';
            fragment.append(row);
        }
        element(this.resultTab === 'recent' ? 'dataTableBody' : 'abnormalResultsTableBody').replaceChildren(fragment);
        element('tablePageInfo').textContent = data.length ? `${start + 1}\u2013${Math.min(start + 25, data.length)} of ${data.length} latest ${this.resultTab === 'abnormal' ? 'abnormal ' : ''}results` : '0 results';
        element('pageNumber').textContent = `${this.tablePage + 1} / ${pages}`;
        element('previousPage').disabled = this.tablePage === 0;
        element('nextPage').disabled = this.tablePage >= pages - 1;
    }

    exportData() {
        if (!this.model?.summary.tests || this.isLoading) return;
        element('exportButton').disabled = true;
        this.worker.postMessage({ type: 'export', loadId: this.activeLoad });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new NetworkBenchmarkDashboard();
    window.exportData = () => window.dashboard.exportData();
    window.clearFilters = () => window.dashboard.clearFilters();
});
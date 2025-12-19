import { attachPanel } from './floatingDock.js';

const PANEL_ID = 'ib-activity-overlay';
const ACTIVITY_HEADING_REGEX = /activity\s+log/i;
const SWEEP_DELAY_MS = 80;
const SWEEP_STEP_RATIO = 0.75;
const SWEEP_MIN_STEP = 120;

let panel;
let currentPlayerId = null;
let gridObserver = null;
let gridWatchObserver = null;
let gridScrollListener = null;
let gridScrollTarget = null;
let observedContainer = null;
let syncScheduled = false;
let sweepPromise = null;
let entryCache = new Map();

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const ensurePanel = () => {
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'ib-panel ib-panel-activity';
    panel.innerHTML = `
        <header class="ib-panel__header">
            <div class="ib-panel__titles">
                <p class="ib-panel__eyebrow">IdentifierBuster</p>
                <h3 class="ib-panel__title">Activity Log</h3>
                <p class="ib-panel__subtitle" data-field="player">No player loaded</p>
            </div>
            <div class="ib-panel__actions">
                <button type="button" class="ib-panel__action" aria-label="Capture full activity log" data-action="capture">⇵</button>
                <button type="button" class="ib-panel__action" aria-label="Refresh visible activity" data-action="refresh">⟳</button>
                <button type="button" class="ib-panel__action" aria-label="Collapse activity log" data-action="collapse">−</button>
            </div>
        </header>
        <div class="ib-panel__body">
            <div class="ib-panel__status" data-field="status">Open a player profile to view the log.</div>
            <ul class="ib-activity-list" data-field="entries"></ul>
        </div>
    `;

    const actions = panel.querySelector('.ib-panel__actions');
    actions?.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'collapse') {
            panel.classList.toggle('collapsed');
            button.textContent = panel.classList.contains('collapsed') ? '+' : '−';
        } else if (action === 'refresh') {
            synchronizeNow(true);
        } else if (action === 'capture') {
            captureEntireLog();
        }
    });

    attachPanel(panel, { position: 'top' });
    return panel;
};

const setPlayerLabel = (playerId) => {
    const label = panel?.querySelector('[data-field="player"]');
    if (!label) return;
    label.textContent = playerId ? `Player #${playerId}` : 'No player loaded';
};

const setStatus = (message) => {
    const statusEl = panel?.querySelector('[data-field="status"]');
    if (!statusEl) return;
    if (message) {
        statusEl.textContent = message;
        statusEl.hidden = false;
    } else {
        statusEl.hidden = true;
        statusEl.textContent = '';
    }
};

const clearEntries = () => {
    entryCache.clear();
    const list = panel?.querySelector('[data-field="entries"]');
    if (list) {
        list.replaceChildren();
    }
};

const findActivityLogGrid = () => {
    const columns = document.querySelectorAll('.col-md-6');
    for (const column of columns) {
        const heading = column.querySelector(':scope > h2');
        if (heading && ACTIVITY_HEADING_REGEX.test(heading.textContent || '')) {
            const grid = column.querySelector('.ReactVirtualized__Grid');
            if (grid) return grid;
        }
    }
    return null;
};

const stopObservingGrid = () => {
    if (gridObserver) {
        gridObserver.disconnect();
        gridObserver = null;
    }
    if (gridWatchObserver) {
        gridWatchObserver.disconnect();
        gridWatchObserver = null;
    }
    if (gridScrollTarget && gridScrollListener) {
        gridScrollTarget.removeEventListener('scroll', gridScrollListener);
    }
    observedContainer = null;
    gridScrollListener = null;
    gridScrollTarget = null;
};

const scheduleGridLookup = () => {
    if (gridWatchObserver || !document.body) return;
    gridWatchObserver = new MutationObserver(() => {
        if (!currentPlayerId) return;
        const grid = findActivityLogGrid();
        if (grid) {
            gridWatchObserver?.disconnect();
            gridWatchObserver = null;
            bindToGrid(grid);
        }
    });
    gridWatchObserver.observe(document.body, { childList: true, subtree: true });
};

const bindToGrid = (grid) => {
    stopObservingGrid();
    const innerScroll = grid.querySelector('.ReactVirtualized__Grid__innerScrollContainer') || grid;
    observedContainer = innerScroll;

    gridObserver = new MutationObserver(scheduleSync);
    gridObserver.observe(innerScroll, { childList: true, subtree: true });

    gridScrollListener = scheduleSync;
    gridScrollTarget = grid;
    gridScrollTarget.addEventListener('scroll', gridScrollListener, { passive: true });

    setStatus(null);
    scheduleSync();
    captureEntireLog();
};

const scheduleSync = () => {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => {
        syncScheduled = false;
        synchronizeNow();
    });
};

const synchronizeNow = (forceStatus = false) => {
    if (!observedContainer) {
        clearEntries();
        setStatus('Waiting for Activity Log…');
        scheduleGridLookup();
        return;
    }
    const entries = collectEntries(observedContainer);
    if (!entries.length && entryCache.size === 0) {
        if (forceStatus) setStatus('Scroll the BattleMetrics activity log to capture events.');
        return;
    }
    mergeEntries(entries);
    renderFromCache();
};

const collectEntries = (container) => {
    const nodes = Array.from(container.children);
    const entries = [];
    nodes.forEach((node, index) => {
        if (!(node instanceof HTMLElement)) return;
        const position = parseFloat(node.style.top) || index;
        const body = node.querySelector('.css-ym7lu8');
        const timeEl = node.querySelector('time');
        if (body && timeEl) {
            const content = body.cloneNode(true);
            content.querySelectorAll('a').forEach((anchor) => {
                anchor.setAttribute('target', '_blank');
                anchor.setAttribute('rel', 'noopener noreferrer');
            });
            entries.push({
                type: 'event',
                timeLabel: timeEl.textContent?.trim() || '',
                timestamp: timeEl.getAttribute('datetime') || '',
                contentHTML: content.innerHTML,
                key: `event:${timeEl.getAttribute('datetime') || ''}:${position}`,
                position
            });
            return;
        }
        const divider = node.querySelector('.css-4cdnnd');
        if (divider) {
            entries.push({
                type: 'divider',
                label: divider.textContent?.trim() || '',
                key: `divider:${divider.textContent || ''}:${position}`,
                position
            });
        }
    });
    return entries;
};

const mergeEntries = (entries) => {
    entries.forEach((entry) => {
        if (!entry.key) return;
        const existing = entryCache.get(entry.key);
        if (!existing || entry.position > existing.position) {
            entryCache.set(entry.key, entry);
        }
    });
};

const renderFromCache = () => {
    const list = panel?.querySelector('[data-field="entries"]');
    if (!list) return;
    list.replaceChildren();

    const entries = Array.from(entryCache.values())
        .sort((a, b) => a.position - b.position);

    if (!entries.length) {
        setStatus('Scroll the BattleMetrics activity log to capture events.');
        return;
    }

    setStatus(null);
    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
        if (entry.type === 'divider') {
            const li = document.createElement('li');
            li.className = 'ib-activity-divider';
            li.textContent = entry.label;
            fragment.appendChild(li);
            return;
        }
        const li = document.createElement('li');
        li.className = 'ib-activity-entry';

        if (entry.timestamp) {
            const time = document.createElement('time');
            time.className = 'ib-activity-entry__time';
            time.textContent = entry.timeLabel;
            time.dateTime = entry.timestamp;
            li.appendChild(time);
        }

        const body = document.createElement('div');
        body.className = 'ib-activity-entry__body';
        body.innerHTML = entry.contentHTML;
        body.querySelectorAll('a').forEach((anchor) => {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
        });
        li.appendChild(body);

        fragment.appendChild(li);
    });

    list.appendChild(fragment);
};

const captureEntireLog = async () => {
    if (!gridScrollTarget || !observedContainer) {
        synchronizeNow(true);
        return;
    }
    if (sweepPromise) return sweepPromise;

    const initialScroll = gridScrollTarget.scrollTop;
    const maxScroll = Math.max(0, gridScrollTarget.scrollHeight - gridScrollTarget.clientHeight);
    const step = Math.max(SWEEP_MIN_STEP, gridScrollTarget.clientHeight * SWEEP_STEP_RATIO);

    sweepPromise = (async () => {
        try {
            if (!entryCache.size) {
                setStatus('Capturing full activity log…');
            }
            for (let position = 0; position <= maxScroll + 1; position += step) {
                gridScrollTarget.scrollTo({ top: Math.min(position, maxScroll), behavior: 'auto' });
                await wait(SWEEP_DELAY_MS);
                if (!observedContainer) break;
                mergeEntries(collectEntries(observedContainer));
                renderFromCache();
            }
            setStatus(entryCache.size ? null : 'No activity entries found.');
        } finally {
            gridScrollTarget.scrollTo({ top: initialScroll, behavior: 'auto' });
            sweepPromise = null;
        }
    })();

    return sweepPromise;
};

export const mountActivityLogOverlay = ({ playerId }) => {
    ensurePanel();
    currentPlayerId = playerId;
    setPlayerLabel(playerId);
    if (!playerId) {
        setStatus('Open a player profile to view the log.');
        clearEntries();
        stopObservingGrid();
        return;
    }

    const grid = findActivityLogGrid();
    if (grid) {
        bindToGrid(grid);
    } else {
        clearEntries();
        setStatus('Waiting for Activity Log…');
        scheduleGridLookup();
    }
};

export const resetActivityLogOverlay = () => {
    currentPlayerId = null;
    setPlayerLabel(null);
    setStatus('Open a player profile to view the log.');
    clearEntries();
    stopObservingGrid();
};

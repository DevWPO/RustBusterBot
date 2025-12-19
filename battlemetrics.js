// battlemetrics.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const SAFE_MARGIN = { perSecond: 1, perMinute: 2 };
const MIN_REMAINING_THRESHOLD = 4;
const COOLDOWN_PADDING_MS = 800;

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

const PROFILES = {
    authenticated: { perSecond: 44, perMinute: 298 },
    anonymous: { perSecond: 14, perMinute: 58 }
};

const pickProfileForLimit = (limit = 0) => (limit >= 200 ? PROFILES.authenticated : PROFILES.anonymous);

const parseHeaderNumber = (headers, name) => {
    if (!headers) return NaN;
    const value = headers.get(name);
    if (!value) return NaN;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
};

const parseResetDelayMs = raw => {
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        if (numeric <= 120) return Math.max(0, numeric * SECOND_MS);
        if (numeric > 1_000_000_000_000) return Math.max(0, numeric - Date.now());
        if (numeric > 1_000_000_000) return Math.max(0, numeric * SECOND_MS - Date.now());
        return Math.max(0, numeric * SECOND_MS);
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return Math.max(0, parsed - Date.now());
    return null;
};

class SlidingWindowRateLimiter {
    constructor({ perSecond, perMinute }) {
        this.perSecondLimit = perSecond || 1;
        this.perMinuteLimit = perMinute || 60;
        this.secondWindowMs = SECOND_MS;
        this.minuteWindowMs = MINUTE_MS;
        this.secondTimestamps = [];
        this.minuteTimestamps = [];
        this.queue = [];
        this.processing = false;
        this.suspendUntil = 0;
    }

    schedule(task) {
        if (typeof task !== 'function') return Promise.reject(new Error('Rate limiter requires a function task.'));
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing) return;
        this.processing = true;
        try {
            while (this.queue.length > 0) {
                const now = Date.now();
                if (this.suspendUntil > now) {
                    await sleep(this.suspendUntil - now);
                    continue;
                }

                this.trim(now);

                const availableSecond = this.perSecondLimit - this.secondTimestamps.length;
                const availableMinute = this.perMinuteLimit - this.minuteTimestamps.length;
                const allowed = Math.max(0, Math.min(availableSecond, availableMinute, this.queue.length));

                if (allowed === 0) {
                    const waitSecond = this.secondTimestamps[0] + this.secondWindowMs - now;
                    const waitMinute = this.minuteTimestamps[0] + this.minuteWindowMs - now;
                    await sleep(Math.max(10, Math.min(waitSecond, waitMinute)));
                    continue;
                }

                const batch = this.queue.splice(0, allowed);
                const promises = batch.map(entry =>
                    entry.task()
                        .then(res => entry.resolve(res))
                        .catch(err => entry.reject(err))
                );

                const ts = Date.now();
                for (let i = 0; i < allowed; i++) {
                    this.secondTimestamps.push(ts);
                    this.minuteTimestamps.push(ts);
                }

                await Promise.all(promises);
            }
        } finally {
            this.processing = false;
        }
    }

    trim(now) {
        const secondCutoff = now - this.secondWindowMs;
        while (this.secondTimestamps.length && this.secondTimestamps[0] <= secondCutoff) this.secondTimestamps.shift();

        const minuteCutoff = now - this.minuteWindowMs;
        while (this.minuteTimestamps.length && this.minuteTimestamps[0] <= minuteCutoff) this.minuteTimestamps.shift();
    }

    updateLimits({ perSecond, perMinute } = {}) {
        if (Number.isFinite(perSecond) && perSecond > 0) this.perSecondLimit = perSecond;
        if (Number.isFinite(perMinute) && perMinute > 0) this.perMinuteLimit = perMinute;
    }

    enforceCooldown(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return;
        this.suspendUntil = Math.max(this.suspendUntil, Date.now() + ms);
    }
}

const battleMetricsRateLimiter = new SlidingWindowRateLimiter(PROFILES.authenticated);

const rateLimitedFetch = (url, options = {}) => battleMetricsRateLimiter.schedule(() => fetch(url, options));

const withBattleMetricsRateLimit = task => battleMetricsRateLimiter.schedule(task);

const recordRateLimitHeaders = headers => {
    if (!headers) return;
    const minuteLimitRaw = parseHeaderNumber(headers, 'x-ratelimit-limit');
    if (Number.isFinite(minuteLimitRaw) && minuteLimitRaw > 0) {
        const profile = pickProfileForLimit(minuteLimitRaw);
        const adjustedLimits = {
            perSecond: Math.max(1, profile.perSecond - SAFE_MARGIN.perSecond),
            perMinute: Math.max(0, Math.min(profile.perMinute, minuteLimitRaw - SAFE_MARGIN.perMinute))
        };
        battleMetricsRateLimiter.updateLimits(adjustedLimits);
    }

    const remaining = parseHeaderNumber(headers, 'x-ratelimit-remaining');
    if (Number.isFinite(remaining) && remaining <= MIN_REMAINING_THRESHOLD) {
        const resetDelay = parseResetDelayMs(headers.get('x-ratelimit-reset'));
        if (resetDelay) battleMetricsRateLimiter.enforceCooldown(resetDelay + COOLDOWN_PADDING_MS);
    }
};

module.exports = {
    rateLimitedFetch,
    withBattleMetricsRateLimit,
    recordRateLimitHeaders,
    battleMetricsRateLimiter
};

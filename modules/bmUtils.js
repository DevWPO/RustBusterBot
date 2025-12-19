// Node-safe BattleMetrics helpers (NO browser code)

export function calculateDaysSinceMostRecentBan(bans) {
    if (!Array.isArray(bans) || bans.length === 0) return null;

    const timestamps = bans
        .map(ban =>
            ban?.attributes?.timestamp ||
            ban?.attributes?.createdAt ||
            ban?.attributes?.updatedAt
        )
        .map(v => Date.parse(v))
        .filter(Number.isFinite);

    if (timestamps.length === 0) return null;

    const mostRecent = Math.max(...timestamps);
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    return Math.max(0, Math.floor((Date.now() - mostRecent) / MS_PER_DAY));
}

export function summarizeBattleMetricsBans(bans) {
    if (!Array.isArray(bans) || bans.length === 0) {
        return { reasonLabel: null, reasonDetail: null };
    }

    const classify = (reason = '') => {
        const r = reason.toLowerCase();
        if (/ban\s*evad|evading/.test(r)) return 'Ban evading';
        if (/cheat|hack|aimbot|esp/.test(r)) return 'Cheating';
        if (/group\s*limit|teaming|over\s*group/.test(r)) return 'Breaking group limit';
        if (/suspicious|alt|association/.test(r)) return 'Suspicious ban';
        return 'Server ban';
    };

    const mapped = bans.map(b => ({
        raw: b?.attributes?.reason || '',
        label: classify(b?.attributes?.reason || '')
    }));

    const priority = [
        'Ban evading',
        'Cheating',
        'Breaking group limit',
        'Suspicious ban',
        'Server ban'
    ];

    for (const p of priority) {
        const match = mapped.find(m => m.label === p);
        if (match) return { reasonLabel: match.label, reasonDetail: match.raw };
    }

    return { reasonLabel: null, reasonDetail: mapped[0]?.raw || null };
}

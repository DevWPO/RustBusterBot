import { rateLimitedFetch,recordRateLimitHeaders } from './battlemetrics.js';

export async function bmFetch(url,token){
    const response = await rateLimitedFetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'}
    });
    recordRateLimitHeaders(response.headers);
    if (!response.ok){
        await response.text()
        throw new Error(`BattleMetrics API error: ${response.status}`);
    } 
    return response.json();}
import { bmFetch } from "./bmFetch.js";
import { isWithin24hours } from "./other/IsWithin24hours.js";
export async function getActivity(BMToken, Arkan= false, Guardian= false, BMID) {
    const url = `https://api.battlemetrics.com/activity?tagTypeMode=and&filter[types][blacklist]=event:query&filter[players]=${BMID}&include=organization,user&page[size]=1000`;
    const data = await bmFetch(url,BMToken);
    
    const activityLogs = data.data || [];

    let stats = {
        kills: 0, kills24h: 0,
        deaths: 0, deaths24h: 0,
        reports: 0, reports24h: 0
    };

    for (const activity of activityLogs) {
        const type = activity.attributes.messageType;
        const eventData = activity.attributes.data;
        const isRecent = isWithin24hours(new Date(activity.attributes.timestamp));

        // 1. Handle PVP Kills/Deaths using ID matching
        if (type === "rustLog:playerDeath:PVP") {
            if (eventData.killer_id == BMID) {
                stats.kills++;
                if (isRecent) stats.kills24h++;
            } else if (eventData.player_id == BMID) {
                stats.deaths++;
                if (isRecent) stats.deaths24h++;
            }
        } 
        // 2. Handle Player Reports
        else if (type === "rustLog:playerReport") {
            if (eventData.forPlayerId == BMID) {
                stats.reports++;
                if (isRecent) stats.reports24h++;
            }
        }
    }

    // Calculate KDs
    stats.kd = stats.deaths === 0 ? stats.kills : (stats.kills / stats.deaths).toFixed(2);
    stats.kd24h = stats.deaths24h === 0 ? stats.kills24h : (stats.kills24h / stats.deaths24h).toFixed(2);

    return stats;
}

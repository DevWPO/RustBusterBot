import { bmFetch } from './bmFetch.js';
export async function getPlayerInfo(playerId, BMToken) {
    const url = `https://api.battlemetrics.com/players/${playerId}?include=server&fields[server]=name,ip,port`;
    const data = await bmFetch(url,BMToken);
    if (!data) return null;
    const currentSession = {
        server: "Offline",
        online: false,
    }
    let totalBMHours = 0;

    // Look through the servers this player has played on
    if (data.included) {
        for (const server of data.included.filter(i => i.type === "server")) {
            // Sum up total playtime across all servers
            totalBMHours += (server.meta?.timePlayed || 0) / 3600;

            // Check if they are CURRENTLY online
            if (server.meta?.online === true) {
                currentSession.online = true;
                currentSession.server = server.attributes.name;
            }
        }
    }

    return {
        online: currentSession.online,
        currentServer: currentSession.server,
        totalHours: totalBMHours.toFixed(1)
    };
}
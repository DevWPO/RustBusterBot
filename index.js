import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { rateLimitedFetch, recordRateLimitHeaders }  from'./battlemetrics.js';
import { scorePlayer } from './modules/scoring.js';
import { calculateDaysSinceMostRecentBan, summarizeBattleMetricsBans } from './modules/bmUtils.js';
import { isWithin24hours } from "./modules/other/isWithin24hours.js";
import dotenv from 'dotenv';
dotenv.config();
const commands = [
    { name: 'test', description: 'Test' },
    { name: 'bans', description: 'Get server bans by ID' },
    { name: 'players', description: 'Get server players by ID' }
];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error('Missing required environment variables. Please set TOKEN, CLIENT_ID, and GUILD_ID.');
    process.exit(1);
}


const rest = new REST({ version: '10' }).setToken(token);
rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});


async function bmFetch(url){
    const response = await rateLimitedFetch(url, {
        headers: {
            Authorization: `Bearer ${process.env.BATTLEMETRICS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });
    recordRateLimitHeaders(response.headers);
    if (!response.ok){
        await response.text()
        throw new Error(`BattleMetrics API error: ${response.status}`);
    } 
    return response.json();
}
async function getPlayersStream(serverId, onlineOnly, onPlayer) {
    let url = `https://api.battlemetrics.com/players?filter[servers]=${serverId}&page[size]=100`;
    if (onlineOnly) url += '&filter[online]=true';

    while (url) {
        const data = await bmFetch(url);
        for (const player of data.data) {
            await onPlayer(player);
        }

        url = data.links?.next || null;
    }
}

async function fetchPlayerBundle(playerId) {
    const bans = await bmFetch(
        `https://api.battlemetrics.com/bans?filter[player]=${playerId}&filter[expired]=false`
    );

    return { bans: bans.data || [] };
}

async function getActivity(BMToken, Arkan= false, Guardian= false, BMID) {
    const url = `https://api.battlemetrics.com/activity?tagTypeMode=and&filter[types][blacklist]=event:query&filter[players]=${BMID}&include=organization,user&page[size]=1000`;
    const data = await bmFetch(url);
    
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

async function getPlayerInfo(playerId) {
    const url = `https://api.battlemetrics.com/players/${playerId}?include=server&fields[server]=name,ip,port`;
    const data = await bmFetch(url);
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
client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    if (args[0] !== '!players' || !args[1]) return;

    const serverId = args[1];
    const loadingMsg = await message.channel.send('🔄 Streaming players…');

    let count = 0;

    try {
        await getPlayersStream(serverId, true, async (player) => {
            const bundle = await fetchPlayerBundle(player.id);
            await sleep(100); // To avoid rate limits
            const activityStats = await getActivity(token, false, false, player.id);
            await sleep(100);
            const detailedInfo = await getPlayerInfo(player.id);
            if (!detailedInfo || !detailedInfo.online) return;
            count++;
            const sbDaysAgo = calculateDaysSinceMostRecentBan(bundle.bans);
            const scored = scorePlayer({
                nameMatch: 0,
                banStatus: { sb: bundle.bans.length, sbDaysAgo },
                activityStats: activityStats });

            const emoji =
                scored.severity === 'Critical' ? '🔴' :
                scored.severity === 'Risky' ? '🟠' :
                scored.severity === 'Watch' ? '🟡' :
                '🟢';
            
            await message.channel.send(
                `${detailedInfo.online ? '🔵' : '⚪'} **${player.attributes.name}** (ID: \`${player.id}\`)\n` +
                `Score: **${scored.score}** (${scored.severity}) | BM: **${detailedInfo.totalHours}h**\n` +
                `**24h (C):** K/D: **${activityStats.kd24h}** | K: **${activityStats.kills24h}** | D: **${activityStats.deaths24h}** | Reports: **${activityStats.reports24h}**\n` +
                `**Total (T):** K/D: **${activityStats.kd}** | K: **${activityStats.kills}** | D: **${activityStats.deaths}** | Reports: **${activityStats.reports}**\n` +
                `Bans: **${bundle.bans.length}**` + (sbDaysAgo !== null ? ` | Last: ${sbDaysAgo}d ago` : ''));
            await sleep(500);
        });

        await loadingMsg.edit(`✅ Done. Streamed **${count} players**.`);
    } catch (err) {
        console.error(err);
        await loadingMsg.edit('❌ Error while streaming players.');
    }
});


client.login(token);

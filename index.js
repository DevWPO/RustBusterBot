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

async function getActivity(BMToken, Arkan= false, Guardian= false, playerID) {
    const url = `https://api.battlemetrics.com/activity?tagTypeMode=and&filter[types][blacklist]=event:query&filter[players]=${playerID}&include=organization,user&page[size]=100`;
    const responses = await bmFetch(url);
    return responses.data || [];
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
            count++;
            const [bundle,activity, detiledInfo] = await Promise.all([
                fetchPlayerBundle(player.id),
                getActivity(token, null, null, player.id),
                getPlayerInfo(player.id)
            ]);
            const sbDaysAgo = calculateDaysSinceMostRecentBan(bundle.bans);
            const recentActivity = activity.filter(act => isWithin24hours(act.attributes.timestamp));
            const cKills = recentActivity.filter(act =>
                act.attributes.messageType === 'rustLog:playerDeath:PVP' &&
               act.attributes.message.includes(`killed by ${player.attributes.name}`)).length;
            const cDeaths = recentActivity.filter(act =>
                act.attributes.messageType === 'rustLog:playerDeath:PVP' &&
               act.attributes.message.startsWith(`${player.attributes.name} was killed`)).length;
            const cKd = cDeaths === 0 ? cKills : (cKills / cDeaths).toFixed(2);
            const kills = activity.filter(act =>
                act.attributes.messageType === 'rustLog:playerDeath:PVP' &&
               act.attributes.message.includes(`killed by ${player.attributes.name}`)).length;
            const deaths = activity.filter(act =>
                act.attributes.messageType === 'rustLog:playerDeath:PVP' &&
               act.attributes.message.startsWith(`${player.attributes.name} was killed`)).length;
            const kd = deaths === 0 ? kills : (kills / deaths).toFixed(2);
            const playerStats = { kills, deaths, kd, cKills, cDeaths, cKd };
            const statusText = detiledInfo.online ? 'Online' : 'Offline';
            const scored = scorePlayer({
                nameMatch: 0,
                banStatus: {
                    sb: bundle.bans.length,
                    sbDaysAgo},
                activityStats: activity});

            const emoji =
                scored.severity === 'Critical' ? '🔴' :
                scored.severity === 'Risky' ? '🟠' :
                scored.severity === 'Watch' ? '🟡' :
                '🟢';
            
            await message.channel.send(
                `${emoji} **${player.attributes.name}** (ID: \`${player.id}\`)\n` +
                `Score: **${scored.score}** (${scored.severity})\n` +
                `K/D: **${playerStats.kd}** | Kills: **${playerStats.kills}** | Deaths:${playerStats.deaths}\n` +
                `K/D in past 24Hours: **${playerStats.cKd}** | Kills in past 24Hours: **${playerStats.cKills}** | Deaths in past 24Hours:${playerStats.cDeaths}\n` +
                `Bans: ${bundle.bans.length}` + (sbDaysAgo !== null ? ` | Last: ${sbDaysAgo}d ago` : '') + `\n` + statusText
            );
        });

        await loadingMsg.edit(`✅ Done. Streamed **${count} players**.`);
    } catch (err) {
        console.error(err);
        await loadingMsg.edit('❌ Error while streaming players.');
    }
});


client.login(token);

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { rateLimitedFetch, recordRateLimitHeaders }  from'./battlemetrics.js';
import { scorePlayer } from './modules/scoring.js';
import { calculateDaysSinceMostRecentBan, summarizeBattleMetricsBans } from './modules/bmUtils.js';
import { getActivity } from './modules/GetActivity.js';

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

async function fetchLeaderboard(serverId,playerId) {
    const response = await bmFetch(
        `https://api.battlemetrics.com/players/${playerId}/servers/${serverId}`
    );
    const entry = response.data;
    console.log(entry)
    if (!entry) {
        return { kd: null, kills: null, deaths: null, reason: 'Not tracked' };
    }
    const meta = entry.attributes?.metadata;
    if (!meta || meta.kills == null || meta.deaths == null) {
        return { kd: null, kills: null, deaths: null, reason: 'No K/D metadata' };
    }

    const kills = meta.kills;
    const deaths = meta.deaths;

    const kd = deaths > 0
        ? (kills / deaths).toFixed(2)
        : kills.toFixed(2);

    return { kills, deaths, kd };
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
            
            const bundle = await fetchPlayerBundle(player.id);
            const stats = await fetchLeaderboard(serverId, player.id);
            const sbDaysAgo = calculateDaysSinceMostRecentBan(bundle.bans);
            const bmSummary = summarizeBattleMetricsBans(bundle.bans);

            const scored = scorePlayer({
                nameMatch: 0,
                associates: 0,
                profilePicMatch: false,
                lastSeenDaysAgo: null,
                banStatus: {
                    sb: bundle.bans.length,
                    sbDaysAgo
                },
                kills: stats.kills,
                deaths: stats.deaths,
                kd: stats.kd
            });

            const emoji =
                scored.severity === 'Critical' ? '🔴' :
                scored.severity === 'Risky' ? '🟠' :
                scored.severity === 'Watch' ? '🟡' :
                '🟢';

            await message.channel.send(
                `${emoji} **${player.attributes.name}** (ID: \`${player.id}\`)\n` +
                `Score: **${scored.score}** (${scored.severity})\n` + `K/D: **${stats.kd}** | Kills: **${stats.kills}** | Deaths: **${stats.deaths}**\n` +
                `Bans: ${bundle.bans.length}` +
                (sbDaysAgo !== null ? ` | Last ban: ${sbDaysAgo}d ago` : '')
            );
        });

        await loadingMsg.edit(`✅ Done. Streamed **${count} players**.`);
    } catch (err) {
        console.error(err);
        await loadingMsg.edit('❌ Error while streaming players.');
    }
});


client.login(token);

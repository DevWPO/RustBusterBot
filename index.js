import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { bmFetch } from './modules/bmFetch.js';
import { calculateDaysSinceMostRecentBan} from './modules/bmUtils.js';
import dotenv from 'dotenv';
import { EmbedBuilder } from 'discord.js';
import { getActivity } from './modules/GetActivity.js';
import { calculateHackerPercent } from './modules/other/calculateHackerPercent.js';
import { getPlayerInfo } from './modules/getPlayerInfo.js';
import { getOrgServer } from './modules/getOrgServer.js';
dotenv.config();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const organId = process.env.BESTRUSTID;
const BMToken = process.env.BMTOKEN;

if (!token || !clientId || !guildId) {
    console.error('Missing required environment variables. Please set TOKEN, CLIENT_ID, and GUILD_ID.');
    process.exit(1);
}


const rest = new REST({ version: '10' }).setToken(token);


const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});


async function getPlayersStream(serverId, onlineOnly, onPlayer) {
    let url = `https://api.battlemetrics.com/players?filter[servers]=${serverId}&page[size]=100`;
    if (onlineOnly) url += '&filter[online]=true';

    while (url) {
        const data = await bmFetch(url, BMToken);
        for (const player of data.data) {
            await onPlayer(player);
        }

        url = data.links?.next || null;
    }
}

async function fetchPlayerBundle(playerId) {
    const url = `https://api.battlemetrics.com/bans?filter[player]=${playerId}&filter[expired]=false` 
    const bans = await bmFetch(url, BMToken);

    return { bans: bans.data || [] };
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
    const servers = await getOrgServer(organId, BMToken);
    const onlineServers = servers.filter(
    s => s.attributes.status === 'online');

    console.log(servers.length);
    console.log(onlineServers.length);
    onlineServers.forEach(server => {
    console.log(server.attributes.name);
});
    
    
    try {
        await getPlayersStream(serverId, true, async (player) => {
            const bundle = await fetchPlayerBundle(player.id);
            await sleep(100); // To avoid rate limits
            const activityStats = await getActivity(BMToken, false, false, player.id);
            await sleep(100);
            const detailedInfo = await getPlayerInfo(player.id,BMToken);
            if (!detailedInfo || !detailedInfo.online) return;
            const hackerPercent = calculateHackerPercent(activityStats.kd24h, detailedInfo.totalHours);
            
            if (!onlineServers.some(CServer => CServer.attributes.name === detailedInfo.currentServer)) return;
            count++;
            const sbDaysAgo = calculateDaysSinceMostRecentBan(bundle.bans);

            const embed = new EmbedBuilder()
                .setColor(hackerPercent >= 70 ? '#e74c3c' : '#f1c40f') // red if high risk, yellow otherwise
                .setTitle(`${detailedInfo.online ? '🔵' : '⚪'} ${player.attributes.name}`)
                .setURL(`https://www.battlemetrics.com/rcon/players/${player.id}`)
                .setDescription(
                    `**ID:** \`${player.id}\`\n` +
                    `**Hacker Probability:** **${hackerPercent}%**`
                )
                .addFields(
                    {
                        name: '24h Stats (C)',
                        value:
                            `K/D: **${activityStats.kd24h}**\n` +
                            `Kills: **${activityStats.kills24h}**\n` +
                            `Deaths: **${activityStats.deaths24h}**\n` +
                            `Reports: **${activityStats.reports24h}**`,
                        inline: true
                    },
                    {
                        name: 'Total Stats (T)',
                        value:
                            `K/D: **${activityStats.kd}**\n` +
                            `Kills: **${activityStats.kills}**\n` +
                            `Deaths: **${activityStats.deaths}**\n` +
                            `Reports: **${activityStats.reports}**`,
                        inline: true
                    },
                    {
                        name: 'BattleMetrics',
                        value:
                            `Playtime: **${detailedInfo.totalHours}h**\n` +
                            `Bans: **${bundle.bans.length}**` +
                            (sbDaysAgo !== null ? `\nLast Ban: **${sbDaysAgo}d ago**` : ''),
                        inline: false
                    },
                    {
                        name: 'Current Server',
                        value: `**${detailedInfo.currentServer || 'Unknown'}**`,
                        inline: false
                    }
                )
                .setFooter({
                    text: `Today at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                });

            await message.channel.send({
                content: `<@&1451751125538836583>`,
                embeds: [embed]
            });

            await sleep(500);
        });

        await loadingMsg.edit(`✅ Done. Streamed **${count} players**.`);
    } catch (err) {
        console.error(err);
        await loadingMsg.edit('❌ Error while streaming players.');
    }
});


client.login(token);

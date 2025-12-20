import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { bmFetch } from './modules/bmFetch.js';
import { calculateDaysSinceMostRecentBan} from './modules/bmUtils.js';
// import dotenv from 'dotenv';
import { EmbedBuilder } from 'discord.js';
import { getActivity } from './modules/GetActivity.js';
import { calculateHackerPercent } from './modules/other/calculateHackerPercent.js';
import { getPlayerInfo } from './modules/getPlayerInfo.js';
import { getOrgServer } from './modules/getOrgServer.js';
// dotenv.config();

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

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    if (args[0] !== '!start') return;
    const loadingMsg = await message.channel.send('🔄 Streaming players…');

    let count = 0;
    const servers = await getOrgServer(organId, BMToken);
    const onlineServers = servers.filter(
    s => s.attributes.status === 'online');
    try {
    // Loop through every online server
    for (const server of onlineServers) {
        await getPlayersStream(server.id, true, async (player) => {
            const bundle = await fetchPlayerBundle(player.id);
            const activityStats = await getActivity(BMToken, false, false, player.id);
            const detailedInfo = await getPlayerInfo(player.id, BMToken);
            if (!detailedInfo || !detailedInfo.online) return;
            
            const hackerPercent = calculateHackerPercent(activityStats.kd24h, detailedInfo.totalHours);

            // Only show if the current server is online
            if (!onlineServers.some(CServer => CServer.attributes.name === detailedInfo.currentServer)) return;
            count++;

            const sbDaysAgo = calculateDaysSinceMostRecentBan(bundle.bans);

            const embed = new EmbedBuilder()
                .setColor(hackerPercent >= 70 ? '#e74c3c' : '#f1c40f')
                .setTitle(`${detailedInfo.online ? '🔵' : '⚪'} ${player.attributes.name}`)
                .setURL(`https://www.battlemetrics.com/rcon/players/${player.id}`)
                .setDescription(
                    `**ID:** \`${player.id}\`\n**Hacker Probability:** **${hackerPercent}%**`
                )
                .addFields(
                    {
                        name: '24h Stats (C)',
                        value: `K/D: **${activityStats.kd24h}**\nKills: **${activityStats.kills24h}**\nDeaths: **${activityStats.deaths24h}**\nReports: **${activityStats.reports24h}**`,
                        inline: true
                    },
                    {
                        name: 'Total Stats (T)',
                        value: `K/D: **${activityStats.kd}**\nKills: **${activityStats.kills}**\nDeaths: **${activityStats.deaths}**\nReports: **${activityStats.reports}**`,
                        inline: true
                    },
                    {
                        name: 'BattleMetrics',
                        value: `Playtime: **${detailedInfo.totalHours}h**\nBans: **${bundle.bans.length}**` +
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
            if(hackerPercent >= 80) {
                await message.channel.send({
                content: `<@&1451751125538836583>`,
                embeds: [embed]
            });}else{
                await message.channel.send({
                embeds: [embed]});}


            await sleep(350); // slow down to avoid rate limits
        });
    }

    await loadingMsg.edit(`✅ Done. Streamed **${count} players**.`);
} catch (err) {
    console.error(err);
    await loadingMsg.edit('❌ Error while streaming players.');
}


});


client.login(token);

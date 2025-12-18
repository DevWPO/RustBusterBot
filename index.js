const { Client, GatewayIntentBits,REST, Routes } = require('discord.js');
const commands = [{name: 'test', description: 'Test'}]
require('dotenv').config()
const token = process.env.TOKEN
const rest = new REST({version: '10'}).setToken(token);
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

rest.put(Routes.applicationGuildCommands(clientId, guildId), {body:commands})

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction =>{
    if(!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'test'){
        interaction.reply('test')
        const member = await interaction.member.fetch()
        await interaction.channel.send(`<@${member.user.id}>`)
    }
})
client.on('messageCreate', async message => {
    if (message.author.bot) return; 
    if (message.content) {
        message.react("😀")
        message.channel.send("Yaatik 3asba")
        const member =  await message.member.fetch()
        await message.channel.send(`Member : <@${member.user.id}>`)
    }
});

client.login(token);

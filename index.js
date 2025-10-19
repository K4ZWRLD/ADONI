const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  Routes, 
  REST, 
  EmbedBuilder 
} = require('discord.js');

const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// Initialize DisTube v5
const distube = new DisTube(client, {
  emitNewSongOnly: true,
  plugins: [new SpotifyPlugin()],
});

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add to the queue')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('YouTube, Spotify link, or search term')
        .setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Skip current song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop music'),
  new SlashCommandBuilder().setName('queue').setDescription('Show song queue'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause music'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume music')
].map(c => c.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error(err);
  }
})();

// Bot ready
client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// Interaction handling
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const query = interaction.options?.getString('query');

  try {
    if (commandName === 'play') {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply('❌ You must be in a voice channel.');

      await distube.play(voiceChannel, query, { member: interaction.member, textChannel: interaction.channel });
      await interaction.reply(`🎶 Searching for: **${query}**`);
    } 
    else if (commandName === 'skip') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply('📭 Queue is empty.');
      distube.skip(interaction.guildId);
      interaction.reply('⏭️ Skipped the current song.');
    } 
    else if (commandName === 'stop') {
      distube.stop(interaction.guildId);
      interaction.reply('🛑 Stopped music and cleared the queue.');
    } 
    else if (commandName === 'pause') {
      distube.pause(interaction.guildId);
      interaction.reply('⏸️ Paused music.');
    } 
    else if (commandName === 'resume') {
      distube.resume(interaction.guildId);
      interaction.reply('▶️ Resumed music.');
    } 
    else if (commandName === 'queue') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) return interaction.reply('📭 Queue is empty.');
      const q = queue.songs.map((song, i) => `**${i+1}.** [${song.name}](${song.url}) • \`${song.formattedDuration}\``).join('\n');
      interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎶 Current Queue').setDescription(q).setColor(0x2f3136)] });
    }
  } catch (err) {
    console.error(err);
    interaction.reply('❌ Something went wrong.');
  }
});

// Distube events
distube
  .on('playSong', (queue, song) => {
    queue.textChannel.send(`🎶 Now playing: **${song.name}** • \`${song.formattedDuration}\``);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel.send(`✅ Added **${song.name}** • \`${song.formattedDuration}\` to the queue.`);
  })
  .on('error', (channel, err) => {
    console.error(err);
    if (channel) channel.send('❌ An error occurred.');
  });

client.login(TOKEN);

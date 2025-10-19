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
const { YtDlpPlugin } = require('@distube/yt-dlp');
const ffmpeg = require('ffmpeg-static');
const { exec } = require('child_process');

require('dotenv').config();

// Verify ffmpeg installation
console.log('FFmpeg path from ffmpeg-static:', ffmpeg);

// Set ffmpeg path
process.env.FFMPEG_PATH = ffmpeg;

// Test ffmpeg
exec(`"${ffmpeg}" -version`, (error, stdout) => {
  if (error) {
    console.error('❌ FFmpeg test failed:', error.message);
  } else {
    console.log('✅ FFmpeg is working:', stdout.split('\n')[0]);
  }
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Validate environment variables
if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing TOKEN or CLIENT_ID in environment variables');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// Initialize DisTube
const distube = new DisTube(client, {
  ffmpeg: {
    path: ffmpeg
  },
  plugins: [
    new SpotifyPlugin(),
    new YtDlpPlugin()
  ]
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
  new SlashCommandBuilder().setName('resume').setDescription('Resume music'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show current song'),
  new SlashCommandBuilder().setName('volume').setDescription('Set volume')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume level (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
].map(c => c.toJSON());

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();

// Bot ready
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🎵 Music bot is ready in ${client.guilds.cache.size} servers`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Defer reply to avoid Unknown interaction
  await interaction.deferReply();

  try {
    // Check if user is in voice channel (for most commands)
    if (['play', 'skip', 'stop', 'pause', 'resume', 'volume'].includes(commandName)) {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.editReply('❌ You must be in a voice channel to use this command.');
      }

      // Check if bot is in a different voice channel
      const botVoiceChannel = interaction.guild.members.me.voice.channel;
      if (botVoiceChannel && botVoiceChannel.id !== voiceChannel.id) {
        return interaction.editReply('❌ I\'m already playing music in a different voice channel.');
      }
    }

    if (commandName === 'play') {
      const query = interaction.options.getString('query');
      const voiceChannel = interaction.member.voice.channel;

      if (!query || query.trim() === '') {
        return interaction.editReply('❌ You must provide a valid URL or search term.');
      }

      console.log(`[PLAY] User: ${interaction.user.tag}, Query: ${query}`);

      try {
        await distube.play(voiceChannel, query, { 
          member: interaction.member, 
          textChannel: interaction.channel 
        });
        console.log('[PLAY] Successfully called distube.play()');
        return interaction.editReply(`🔍 Searching for: **${query}**`);
      } catch (playError) {
        console.error('[PLAY] Error:', playError);
        return interaction.editReply(`❌ Failed to play: ${playError.message}`);
      }

    } else if (commandName === 'skip') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
      if (queue.songs.length === 1) return interaction.editReply('❌ No more songs in the queue.');

      await distube.skip(interaction.guildId);
      return interaction.editReply('⏭️ Skipped the current song.');

    } else if (commandName === 'stop') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');

      await distube.stop(interaction.guildId);
      return interaction.editReply('🛑 Stopped music and cleared the queue.');

    } else if (commandName === 'pause') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
      if (queue.paused) return interaction.editReply('❌ Music is already paused.');

      distube.pause(interaction.guildId);
      return interaction.editReply('⏸️ Paused the music.');

    } else if (commandName === 'resume') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
      if (!queue.paused) return interaction.editReply('❌ Music is not paused.');

      distube.resume(interaction.guildId);
      return interaction.editReply('▶️ Resumed the music.');

    } else if (commandName === 'volume') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');

      const volume = interaction.options.getInteger('level');
      distube.setVolume(interaction.guildId, volume);
      return interaction.editReply(`🔊 Volume set to **${volume}%**`);

    } else if (commandName === 'nowplaying') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.editReply('❌ Nothing is playing right now.');

      const song = queue.songs[0];
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎵 Now Playing')
            .setDescription(`[${song.name}](${song.url})`)
            .addFields(
              { name: 'Duration', value: song.formattedDuration, inline: true },
              { name: 'Requested by', value: song.user.toString(), inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setColor(0x5865F2)
        ]
      });

    } else if (commandName === 'queue') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) return interaction.editReply('📭 Queue is empty.');

      const currentSong = queue.songs[0];
      const queueList = queue.songs.slice(1, 11).map((song, i) => 
        `**${i + 1}.** [${song.name}](${song.url}) • \`${song.formattedDuration}\` • ${song.user}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🎶 Music Queue')
        .setColor(0x5865F2)
        .addFields({
          name: '▶️ Now Playing',
          value: `[${currentSong.name}](${currentSong.url}) • \`${currentSong.formattedDuration}\` • ${currentSong.user}`
        });

      if (queueList) {
        embed.addFields({
          name: '📃 Up Next',
          value: queueList + (queue.songs.length > 11 ? `\n*...and ${queue.songs.length - 11} more*` : '')
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('Command error:', err);
    const errorMsg = err.message || 'Something went wrong.';

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(`❌ Error: ${errorMsg}`);
    } else {
      return interaction.reply({ content: `❌ Error: ${errorMsg}`, ephemeral: true });
    }
  }
});

// DisTube events
distube.on('playSong', (queue, song) => {
  console.log('[DISTUBE] Playing song:', song.name);
  const embed = new EmbedBuilder()
    .setTitle('🎵 Now Playing')
    .setDescription(`[${song.name}](${song.url})`)
    .addFields(
      { name: 'Duration', value: song.formattedDuration, inline: true },
      { name: 'Requested by', value: song.user.toString(), inline: true }
    )
    .setThumbnail(song.thumbnail)
    .setColor(0x5865F2);

  queue.textChannel.send({ embeds: [embed] });
});

distube.on('addSong', (queue, song) => {
  console.log('[DISTUBE] Added song:', song.name);
  queue.textChannel.send(`✅ Added to queue: **${song.name}** • \`${song.formattedDuration}\` • ${song.user}`);
});

distube.on('addList', (queue, playlist) => {
  console.log('[DISTUBE] Added playlist:', playlist.name);
  queue.textChannel.send(`✅ Added playlist: **${playlist.name}** (${playlist.songs.length} songs)`);
});

distube.on('finish', queue => {
  console.log('[DISTUBE] Queue finished');
  queue.textChannel.send('✅ Queue finished!');
});

distube.on('initQueue', queue => {
  console.log('[DISTUBE] Initializing queue');
  queue.textChannel.send('⏳ Preparing to play... This may take a moment.');
});

distube.on('error', (channel, err) => {
  console.error('[DISTUBE] Error:', err);
  if (channel) {
    channel.send(`❌ An error occurred: ${err.message.slice(0, 100)}`);
  }
});

distube.on('searchNoResult', (message, query) => {
  message.channel.send(`❌ No results found for: **${query}**`);
});

// Handle bot errors
client.on('error', err => console.error('Discord client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.login(TOKEN);
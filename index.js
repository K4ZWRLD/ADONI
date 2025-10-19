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
const ffmpeg = require('ffmpeg-static');
const { exec } = require('child_process');
const { YtDlpWrap } = require('yt-dlp-wrap-extended'); // New

require('dotenv').config();

// Verify ffmpeg installation
console.log('FFmpeg path from ffmpeg-static:', ffmpeg);
process.env.FFMPEG_PATH = ffmpeg;

exec(`"${ffmpeg}" -version`, (error, stdout) => {
  if (error) {
    console.error('❌ FFmpeg test failed:', error.message);
  } else {
    console.log('✅ FFmpeg is working:', stdout.split('\n')[0]);
  }
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing TOKEN or CLIENT_ID in environment variables');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// Initialize DisTube without @distube/yt-dlp plugin
const distube = new DisTube(client, {
  ffmpeg: { path: ffmpeg },
  plugins: [new SpotifyPlugin()]
});

// Initialize yt-dlp-wrap
const ytdlp = new YtDlpWrap();

// Helper function to play with yt-dlp-wrap
async function playWithYtDlp(query, textChannel, voiceChannel, member) {
  try {
    // Detect if it's a URL; if not, use ytsearch
    const searchQuery = /^(https?:\/\/|www\.)/.test(query) ? query : `ytsearch:${query}`;

    // Get direct audio URL
    const info = await ytdlp.execPromise([searchQuery, '-f', 'bestaudio', '--get-url']);
    const url = info.stdout.trim();

    await distube.play(voiceChannel, url, {
      member: member,
      textChannel: textChannel
    });

    textChannel.send(`🔍 Searching for: **${query}**`);
  } catch (err) {
    console.error('[YTDLP] Error:', err);
    textChannel.send(`❌ Failed to play: ${err.message}`);
  }
}

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
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🎵 Music bot is ready in ${client.guilds.cache.size} servers`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  await interaction.deferReply();

  try {
    const voiceChannel = interaction.member.voice.channel;
    if (['play', 'skip', 'stop', 'pause', 'resume', 'volume'].includes(commandName) && !voiceChannel) {
      return interaction.editReply('❌ You must be in a voice channel to use this command.');
    }

    switch (commandName) {
      case 'play':
        const query = interaction.options.getString('query');
        if (!query || query.trim() === '') return interaction.editReply('❌ You must provide a valid URL or search term.');
        await playWithYtDlp(query, interaction.channel, voiceChannel, interaction.member);
        return interaction.editReply(`🔍 Searching for: **${query}**`);

      case 'skip': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
        if (queue.songs.length === 1) return interaction.editReply('❌ No more songs in the queue.');
        await distube.skip(interaction.guildId);
        return interaction.editReply('⏭️ Skipped the current song.');
      }

      case 'stop': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
        await distube.stop(interaction.guildId);
        return interaction.editReply('🛑 Stopped music and cleared the queue.');
      }

      case 'pause': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
        if (queue.paused) return interaction.editReply('❌ Music is already paused.');
        distube.pause(interaction.guildId);
        return interaction.editReply('⏸️ Paused the music.');
      }

      case 'resume': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
        if (!queue.paused) return interaction.editReply('❌ Music is not paused.');
        distube.resume(interaction.guildId);
        return interaction.editReply('▶️ Resumed the music.');
      }

      case 'volume': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue) return interaction.editReply('❌ Nothing is playing right now.');
        const volume = interaction.options.getInteger('level');
        distube.setVolume(interaction.guildId, volume);
        return interaction.editReply(`🔊 Volume set to **${volume}%**`);
      }

      case 'nowplaying': {
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
      }

      case 'queue': {
        const queue = distube.getQueue(interaction.guildId);
        if (!queue || !queue.songs.length) return interaction.editReply('📭 Queue is empty.');
        const currentSong = queue.songs[0];
        const queueList = queue.songs.slice(1, 11).map((song, i) => 
          `**${i + 1}.** [${song.name}](${song.url}) • \`${song.formattedDuration}\` • ${song.user}`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('🎶 Music Queue')
          .setColor(0x5865F2)
          .addFields({ name: '▶️ Now Playing', value: `[${currentSong.name}](${currentSong.url}) • \`${currentSong.formattedDuration}\` • ${currentSong.user}` });

        if (queueList) {
          embed.addFields({ name: '📃 Up Next', value: queueList + (queue.songs.length > 11 ? `\n*...and ${queue.songs.length - 11} more*` : '') });
        }

        return interaction.editReply({ embeds: [embed] });
      }
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

distube.on('addSong', (queue, song) => queue.textChannel.send(`✅ Added to queue: **${song.name}** • \`${song.formattedDuration}\` • ${song.user}`));
distube.on('addList', (queue, playlist) => queue.textChannel.send(`✅ Added playlist: **${playlist.name}** (${playlist.songs.length} songs)`));
distube.on('finish', queue => queue.textChannel.send('✅ Queue finished!'));
distube.on('initQueue', queue => queue.textChannel.send('⏳ Preparing to play... This may take a moment.'));
distube.on('error', (channel, err) => { if (channel) channel.send(`❌ An error occurred: ${err.message.slice(0, 100)}`); });
distube.on('searchNoResult', (message, query) => message.channel.send(`❌ No results found for: **${query}**`));

client.on('error', err => console.error('Discord client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.login(TOKEN);

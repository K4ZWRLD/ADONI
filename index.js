const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  Routes, 
  REST, 
  EmbedBuilder 
} = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  NoSubscriberBehavior 
} = require('@discordjs/voice');
const play = require('play-dl');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Guild-specific queues
const queues = new Map();

// Audio player (shared per guild)
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

// Helper: format seconds to mm:ss
function formatDuration(sec) {
  const min = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${min}:${s < 10 ? '0' : ''}${s}`;
}

// Helper: create a song object
function createSongObject(info, requester) {
  return {
    title: info.title || 'Unknown Title',
    url: info.url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : null),
    duration: info.durationInSec ? formatDuration(info.durationInSec) : 'Unknown',
    durationInSec: info.durationInSec || 0,
    thumbnail: info.thumbnails?.[0]?.url || null,
    requester
  };
}

// Play next song in a guild
async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    if (queue?.connection) queue.connection.destroy();
    queues.delete(guildId);
    return;
  }

  const song = queue.songs.shift();
  queue.currentSong = song;
  queue.startTime = Date.now();

  try {
    if (!song.url) return playNext(guildId);

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    player.play(resource);
    queue.connection.subscribe(player);

    const embed = new EmbedBuilder()
      .setTitle('🎶 Now Playing')
      .setDescription(`[${song.title}](${song.url})`)
      .addFields(
        { name: 'Duration', value: song.duration, inline: true },
        { name: 'Requested by', value: song.requester || 'Unknown', inline: true }
      )
      .setThumbnail(song.thumbnail)
      .setColor(0x2f3136)
      .setTimestamp();

    queue.currentMessage = await queue.interaction.followUp({ embeds: [embed] });
  } catch (err) {
    console.error('Error playing song:', err);
    if (queue?.interaction) await queue.interaction.followUp('❌ Failed to play this track, skipping...');
    playNext(guildId);
  }
}

// Player events
player.on(AudioPlayerStatus.Idle, () => {
  queues.forEach((_, guildId) => {
    playNext(guildId);
  });
});

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add to the queue.')
    .addStringOption(option => option.setName('query').setDescription('YouTube/Spotify link or search term').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Skip current song.'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause music.'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume music.'),
  new SlashCommandBuilder().setName('queue').setDescription('View song queue.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop and clear queue.')
].map(c => c.toJSON());

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

client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guildId } = interaction;

  await interaction.deferReply();

  // Ensure a queue exists
  if (!queues.has(guildId)) queues.set(guildId, { songs: [], connection: null, currentSong: null, currentMessage: null, startTime: null, interaction });
  const queue = queues.get(guildId);
  queue.interaction = interaction;

  if (commandName === 'play') {
    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.followUp('❌ You must be in a voice channel.');

    if (!queue.connection) queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator
    });

    try {
      let results = [];
      if (play.sp_validate(query) === 'track') {
        const spotifyTrack = await play.spotify(query);
        results = await play.search(`${spotifyTrack.name} ${spotifyTrack.artists[0].name}`, { limit: 1 });
      } else if (play.yt_validate(query) === 'video') {
        const video = await play.video_info(query);
        results = [video.video_details];
      } else {
        results = await play.search(query, { limit: 1 });
      }

      if (!results.length) return interaction.followUp('❌ No results found.');

      const song = createSongObject(results[0], interaction.user.username);
      queue.songs.push(song);

      if (!queue.currentSong) playNext(guildId);
      else return interaction.followUp(`✅ Added **${song.title}** to the queue!`);
    } catch (err) {
      console.error(err);
      return interaction.followUp('❌ Error searching for that song.');
    }
  }

  else if (commandName === 'skip') {
    player.stop(true);
    interaction.followUp('⏭️ Skipped current song.');
  }

  else if (commandName === 'pause') {
    player.pause();
    interaction.followUp('⏸️ Music paused.');
  }

  else if (commandName === 'resume') {
    player.unpause();
    interaction.followUp('▶️ Resumed.');
  }

  else if (commandName === 'queue') {
    if (!queue.songs.length) return interaction.followUp('📭 Queue is empty.');
    const q = queue.songs.map((s,i) => `**${i+1}.** [${s.title}](${s.url}) • ${s.duration}`).join('\n');
    interaction.followUp({ embeds: [new EmbedBuilder().setTitle('🎶 Current Queue').setDescription(q).setColor(0x2f3136)] });
  }

  else if (commandName === 'stop') {
    queue.songs = [];
    player.stop(true);
    if (queue.connection) queue.connection.destroy();
    queues.delete(guildId);
    interaction.followUp('🛑 Stopped music and cleared queue.');
  }
});

client.login(TOKEN);

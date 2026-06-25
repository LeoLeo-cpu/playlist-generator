import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { searchTrackSpotify } from './spotify';
import { searchTrackLastFM } from './lastfm';
import { searchTrackYouTube } from './youtube';

// Utilitário para converter milissegundos em M:SS
const formatDuration = (millis) => {
  if (!millis) return '3:00'; // Fallback
  const minutes = Math.floor(millis / 60000);
  const seconds = ((millis % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

// Função para enriquecer a música usando a API gratuita do iTunes
export const fetchTrackMetadata = async (artist, title) => {
  try {
    const query = encodeURIComponent(`${artist} ${title}`);
    const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const track = data.results[0];
      return {
        image: track.artworkUrl100 ? track.artworkUrl100.replace('100x100', '300x300') : '', // Pega imagem maior
        duration: formatDuration(track.trackTimeMillis),
        title: track.trackName || title, // Usa o nome oficial se achar
        artist: track.artistName || artist,
        previewUrl: track.previewUrl // Fallback vital para o audio player
      };
    }
    
    return null; // Não achou no iTunes
  } catch (error) {
    console.error('Erro ao buscar no iTunes:', error);
    return null;
  }
};

// Função para gerar a lista de músicas (Suporta IA e Last.fm)
export const generatePlaylist = async (referenceText, amount, tags, apiKey = null, lastfmKey = null, spotifyToken = null, youtubeToken = null) => {
  let playlistBase = [];
  let generatedDescription = 'Playlist fantástica baseada no seu gosto musical.';
  let generatedName = 'Gerada por IA - Playlist Generator';

  try {
    if (!lastfmKey) throw new Error('Chave da API do Last.fm não configurada no arquivo .env');
    
    console.log("Usando motor clássico do Last.fm para buscar faixas!");
    const lines = referenceText.split(/[\n,]+/).filter(line => line.trim() !== '');
    let allSimilarTracks = [];
    
    // Para as 3 primeiras referências, busca faixas similares
    for (const line of lines.slice(0, 3)) {
      const parts = line.split('-');
      const title = parts[0]?.trim() || line;
      const artist = parts[1]?.trim() || '';
      
      const similar = await searchTrackLastFM(artist, title, lastfmKey);
      allSimilarTracks = [...allSimilarTracks, ...similar];
    }
    
    // Embaralha e pega a quantidade desejada
    allSimilarTracks = allSimilarTracks.sort(() => 0.5 - Math.random());
    
    // Se Last.fm não retornar nada
    if (allSimilarTracks.length === 0) {
       throw new Error('O Last.fm não encontrou músicas suficientes para essas referências.');
    }
    
    // Remove duplicatas
    const uniqueTracks = [];
    const seen = new Set();
    for (const t of allSimilarTracks) {
       const key = `${t.artist}-${t.title}`.toLowerCase();
       if (!seen.has(key)) {
         seen.add(key);
         uniqueTracks.push(t);
       }
    }

    playlistBase = uniqueTracks.slice(0, amount);
    
    // AGORA USA A IA APENAS PARA BATIZAR E DESCREVER A PLAYLIST
    if (apiKey && apiKey !== 'sua_chave_aqui') {
      console.log("Usando Inteligência Artificial para gerar Nome e Descrição!");

      const tagString = tags.length > 0 ? tags.join(', ') : 'Nenhuma em específico';
      const tracklistString = playlistBase.map(t => `${t.artist} - ${t.title}`).join('\n');

      const prompt = `Você é um curador musical experiente. O sistema já selecionou a seguinte tracklist baseada nas referências do usuário:
      
${tracklistString}

Vibes/Estilos solicitados pelo usuário: "${tagString}"

Sua tarefa é batizar essa playlist.
Retorne APENAS um JSON válido. Nenhum outro texto, sem marcação de markdown.
O JSON deve ser um objeto com exatamente duas propriedades:
- "name": O título perfeito e criativo para esta playlist (curto, cativante).
- "description": Uma descrição super cativante (em português) sobre o que esperar dessa seleção musical.`;

      if (apiKey.startsWith('gsk_')) {
        try {
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'meta-llama/llama-4-scout-17b-16e-instruct',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 1000
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            let text = data.choices[0]?.message?.content || "{}";
            const jsonMatch = text.match(/\{.*\}/s);
            if (jsonMatch) text = jsonMatch[0];
            const parsed = JSON.parse(text);
            
            if (parsed.name) generatedName = parsed.name;
            if (parsed.description) generatedDescription = parsed.description;
          }
        } catch (e) {
          console.error("Falha ao gerar metadados via Groq", e);
        }
      } else {
        // Usa Gemini
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          
          const metaSchema = {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING },
              description: { type: SchemaType.STRING }
            },
            required: ["name", "description"]
          };

          const model = genAI.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            generationConfig: { 
              responseMimeType: "application/json",
              responseSchema: metaSchema
            }
          });

          const result = await model.generateContent(prompt);
          let text = result.response.text();
          const jsonMatch = text.match(/\{.*\}/s);
          if (jsonMatch) text = jsonMatch[0];
          
          const parsed = JSON.parse(text);
          if (parsed.name) generatedName = parsed.name;
          if (parsed.description) generatedDescription = parsed.description;
        } catch (e) {
          console.error("Falha ao gerar metadados via Gemini", e);
        }
      }
    }

    // Agora, para cada música gerada, vamos buscar as metadados e capas!
    const enrichedPlaylist = await Promise.all(playlistBase.map(async (track, index) => {
      let meta = null;
      let youtubeVideoId = null;

      if (spotifyToken) {
        meta = await searchTrackSpotify(spotifyToken, track.artist, track.title);
        if (meta && meta.durationMs) {
          meta.duration = formatDuration(meta.durationMs);
        }
      }

      // Se não achou no Spotify, ou achou mas o Spotify não liberou o áudio (preview_url null) ou imagem
      if (!meta || !meta.previewUrl || !meta.image) {
        const itunesMeta = await fetchTrackMetadata(track.artist, track.title);
        if (itunesMeta) {
          if (!meta) meta = {};
          meta.image = meta.image || itunesMeta.image;
          meta.duration = meta.duration || itunesMeta.duration;
          meta.previewUrl = meta.previewUrl || itunesMeta.previewUrl;
          meta.title = meta.title || itunesMeta.title;
          meta.artist = meta.artist || itunesMeta.artist;
        }
      }

      if (youtubeToken) {
         youtubeVideoId = await searchTrackYouTube(youtubeToken, track.artist, track.title);
      }
      
      return {
        id: index + 1,
        title: meta?.title || track.title,
        artist: meta?.artist || track.artist,
        duration: meta?.duration || '3:30',
        image: meta?.image || '',
        spotifyUri: meta?.uri || null,
        spotifyUrl: meta?.externalUrl || null,
        spotifyPreview: meta?.previewUrl || null,
        youtubeVideoId: youtubeVideoId
      };
    }));

    return {
      tracks: enrichedPlaylist,
      name: generatedName,
      description: generatedDescription
    };

  } catch (error) {
    console.error('Erro ao gerar playlist:', error);
    throw error;
  }
};

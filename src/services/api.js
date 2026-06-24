import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { searchTrackSpotify, getSpotifyRecommendations } from './spotify';
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
        artist: track.artistName || artist
      };
    }
    
    return null; // Não achou no iTunes
  } catch (error) {
    console.error('Erro ao buscar no iTunes:', error);
    return null;
  }
};

// Função para falar com o Gemini e gerar a lista de músicas
export const generatePlaylist = async (referenceText, amount, tags, apiKey, spotifyToken = null, youtubeToken = null) => {
  // --- MODO SPOTIFY PREMIUM (SEM IA) ---
  if (spotifyToken) {
    console.log("Usando motor nativo do Spotify!");
    // Extrai as músicas que o usuário digitou (separando por linha)
    const lines = referenceText.split('\n').filter(line => line.trim() !== '');
    const seedTrackIds = [];
    
    // Pesquisa no Spotify para pegar o ID das 5 primeiras referências (limite da API)
    for (const line of lines.slice(0, 5)) {
      // O usuário digita "Musica - Artista", tentamos quebrar pelo traço
      const parts = line.split('-');
      const title = parts[0]?.trim() || line;
      const artist = parts[1]?.trim() || '';
      
      const track = await searchTrackSpotify(spotifyToken, artist, title);
      if (track && track.id) {
        seedTrackIds.push(track.id);
      }
    }
    
    if (seedTrackIds.length > 0) {
      // Busca recomendações nativas
      const spotifyTracks = await getSpotifyRecommendations(spotifyToken, seedTrackIds, amount);
      
      // Mapeia para o formato que a nossa interface espera e busca YouTube
      const enrichedPlaylist = await Promise.all(spotifyTracks.map(async (t) => {
        let youtubeVideoId = null;
        if (youtubeToken) {
          youtubeVideoId = await searchTrackYouTube(youtubeToken, t.artist, t.title);
        }
        
        return {
          ...t,
          duration: formatDuration(t.durationMs), // Aplica formatação
          youtubeVideoId: youtubeVideoId
        };
      }));
      
      return enrichedPlaylist;
    }
  }
  
  // --- MODO IA (GEMINI FALLBACK) ---
  if (!apiKey || apiKey === 'sua_chave_aqui') {
    throw new Error('Chave da API do Gemini não configurada no arquivo .env');
  }

  const tagString = tags.length > 0 ? tags.join(', ') : 'Nenhuma em específico';
  const prompt = `Você é um curador musical especialista. O usuário forneceu algumas músicas de referência e deseja descobrir faixas NOVAS e EXCELENTES no mesmo estilo.

Referências musicais fornecidas pelo usuário: "${referenceText}"
Vibes/Estilos desejados: "${tagString}"

Sua tarefa é criar uma playlist recomendada com EXATAMENTE ${amount} músicas.

REGRAS CRÍTICAS:
1. NÃO INCLUA na sua resposta NENHUMA das músicas que o usuário enviou como referência. O objetivo do app é DESCOBRIR novas músicas similares, e não repetir as que o usuário já conhece.
2. As recomendações devem fazer sentido e ter forte sinergia de ritmo, época ou estilo com as referências.
3. Retorne APENAS um JSON válido. Nenhum outro texto.
4. O JSON deve ser um array de objetos, onde cada objeto tem duas propriedades: "artist" (string) e "title" (string).
5. Não inclua marcações de Markdown (como \`\`\`json). Apenas o JSON puro.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const playlistSchema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          artist: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING }
        },
        required: ["artist", "title"]
      }
    };

    // Vamos usar o gemini-2.0-flash com um SCHEMA rígido para não permitir nenhum texto lixo
    let model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      generationConfig: { 
        responseMimeType: "application/json",
        responseSchema: playlistSchema
      }
    });
    let result;

    try {
      result = await model.generateContent(prompt);
    } catch (e) {
      if (e.message && (e.message.includes('not found') || e.message.includes('503') || e.message.includes('429'))) {
        // Se tudo der errado, usamos o Gemma 4
        model = genAI.getGenerativeModel({ 
          model: 'gemma-4-26b-a4b-it',
          generationConfig: { responseMimeType: "application/json" } // Gemma não suporta schema completo, mas aceita json mode
        }); 
        result = await model.generateContent(prompt);
      } else {
        throw e;
      }
    }

    let text = "";
    try {
      text = result.response.text();
    } catch (e) {
      text = "[]";
    }

    let cleanText = text;
    
    // Tratamento radical com Regex para achar o array ou objeto
    const jsonMatch = cleanText.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    }
    
    let playlistBase = [];
    try {
      playlistBase = JSON.parse(cleanText);
      // Se a IA retornar um objeto único em vez de array, transforma em array
      if (!Array.isArray(playlistBase)) {
        if (playlistBase.artist && playlistBase.title) {
          playlistBase = [playlistBase];
        } else {
          playlistBase = [];
        }
      }
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', parseError, 'Texto bruto:', text);
      // Falha graciosa: retorna músicas padrão se a IA enlouquecer
      playlistBase = [
        { artist: "Artista Desconhecido", title: "Música de Teste 1" },
        { artist: "Artista Desconhecido", title: "Música de Teste 2" }
      ];
    }

    // Agora, para cada música, vamos buscar a capa!
    const enrichedPlaylist = await Promise.all(playlistBase.map(async (track, index) => {
      let meta = null;
      let youtubeVideoId = null;

      // 1. Tenta buscar no Spotify primeiro (se estiver logado, pois tem qualidade melhor)
      if (spotifyToken) {
        meta = await searchTrackSpotify(spotifyToken, track.artist, track.title);
        // Formata a duração do Spotify (que vem em ms) para manter o padrão M:SS
        if (meta && meta.durationMs) {
          meta.duration = formatDuration(meta.durationMs);
        }
      }

      // 2. Fallback para o iTunes se não estiver logado no Spotify ou se o Spotify não achar
      if (!meta) {
        meta = await fetchTrackMetadata(track.artist, track.title);
      }

      // 3. Tenta buscar no YouTube (se estiver logado) para guardar o ID do vídeo para exportação
      if (youtubeToken) {
         youtubeVideoId = await searchTrackYouTube(youtubeToken, track.artist, track.title);
      }
      
      return {
        id: index + 1,
        title: meta?.title || track.title,
        artist: meta?.artist || track.artist,
        duration: meta?.duration || '3:30', // Fallback se não achar
        image: meta?.image || '', // Vazio ativará o fallback cinza que criamos
        spotifyUri: meta?.uri || null,
        spotifyUrl: meta?.externalUrl || null,
        spotifyPreview: meta?.previewUrl || null,
        youtubeVideoId: youtubeVideoId
      };
    }));

    return enrichedPlaylist;

  } catch (error) {
    console.error('Erro ao gerar playlist:', error);
    throw error;
  }
};

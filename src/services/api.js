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
export const generatePlaylist = async (referenceText, amount, tags, engine = 'AI', apiKey = null, lastfmKey = null, spotifyToken = null, youtubeToken = null, yearStart = '', yearEnd = '') => {
  let playlistBase = [];
  let generatedDescription = '';

  try {
    if (engine === 'LASTFM') {
      if (!lastfmKey) throw new Error('Chave da API do Last.fm não configurada no arquivo .env');
      
      console.log("Usando motor clássico do Last.fm!");
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
      
      // Se Last.fm não retornar nada, usamos um fallback genérico
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
      generatedDescription = "Playlist gerada pelo motor clássico do Last.fm.";
      
    } else {
      // MOTOR IA (GEMINI OU GROQ)
      if (!apiKey || apiKey === 'sua_chave_aqui') {
        throw new Error('Chave da API da IA não configurada no arquivo .env');
      }
      console.log("Usando motor Inteligência Artificial!");

      const tagString = tags.length > 0 ? tags.join(', ') : 'Nenhuma em específico';
      
      let yearFilter = '';
      if (yearStart && yearEnd) {
        yearFilter = `\nFiltro de Ano: As músicas devem ter sido lançadas estritamente entre os anos de ${yearStart} e ${yearEnd}.`;
      }

      const prompt = `Você é um curador musical especialista. O usuário forneceu algumas músicas de referência e deseja descobrir faixas NOVAS e EXCELENTES no mesmo estilo.

Referências musicais fornecidas pelo usuário: "${referenceText}"
Vibes/Estilos desejados: "${tagString}"${yearFilter}

101: Sua tarefa é criar uma playlist recomendada com EXATAMENTE ${amount} músicas.
102: 
103: REGRAS CRÍTICAS:
104: 1. NÃO INCLUA na sua resposta NENHUMA das músicas que o usuário enviou como referência. O objetivo do app é DESCOBRIR novas músicas similares, e não repetir as que o usuário já conhece.
105: 2. As recomendações devem fazer sentido e ter forte sinergia de ritmo, época ou estilo com as referências.
106: 3. Retorne APENAS um JSON válido. Nenhum outro texto.
107: 4. O JSON deve ser um objeto com duas propriedades obrigatórias:
    - "playlist": um array de objetos, onde cada objeto tem "artist" (string) e "title" (string).
    - "description": uma string contendo uma descrição super cativante e curta (em português) para a playlist gerada, baseada nas músicas escolhidas e na vibe.
108: 5. Não inclua marcações de Markdown (como \`\`\`json). Apenas o JSON puro.`;

      // Se a chave começar com gsk_, é Groq
      if (apiKey.startsWith('gsk_')) {
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
            max_tokens: 4000
          })
        });
        
        if (!response.ok) {
           if (response.status === 429) throw new Error('Servidores da Groq sobrecarregados (Cota Excedida).');
           throw new Error(`Erro na API Groq: ${response.status}`);
        }
        const data = await response.json();
        let text = data.choices[0]?.message?.content || "[]";
        
        // Extrai JSON com Regex (Groq json_object retorna um objeto, então garantimos array)
        const jsonMatch = text.match(/\[.*\]|\{.*\}/s);
        if (jsonMatch) text = jsonMatch[0];
        
        try {
          const parsed = JSON.parse(text);
          if (parsed.playlist && Array.isArray(parsed.playlist)) {
            playlistBase = parsed.playlist;
            generatedDescription = parsed.description || "Uma playlist incrível para você.";
          } else if (Array.isArray(parsed)) {
            playlistBase = parsed;
            generatedDescription = "Uma playlist incrível para você.";
          } else {
             // Fallback pra tentar achar array
             const possibleArrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
             playlistBase = possibleArrayKey ? parsed[possibleArrayKey] : [];
             generatedDescription = parsed.description || "Uma playlist incrível para você.";
          }
        } catch (e) {
          throw new Error('A Groq retornou um formato inválido.');
        }

      } else {
        // Usa Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        
        const playlistSchema = {
          type: SchemaType.OBJECT,
          properties: {
            playlist: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  artist: { type: SchemaType.STRING },
                  title: { type: SchemaType.STRING }
                },
                required: ["artist", "title"]
              }
            },
            description: { type: SchemaType.STRING, description: "Uma descrição curta e cativante em português." }
          },
          required: ["playlist", "description"]
        };

        const model = genAI.getGenerativeModel({ 
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
          if (e.message && e.message.includes('429')) {
            throw new Error('Servidores do Google sobrecarregados (Cota Excedida). Por favor, aguarde cerca de 1 minuto e tente novamente!');
          } else if (e.message && e.message.includes('503')) {
            throw new Error('O Google Gemini está fora do ar no momento. Tente novamente mais tarde.');
          } else {
            throw new Error('Erro na comunicação com a IA: ' + e.message);
          }
        }

        let text = "";
        try {
          text = result.response.text();
        } catch (e) {
          text = "[]";
        }

        let cleanText = text;
        const jsonMatch = cleanText.match(/\[.*\]|\{.*\}/s);
        if (jsonMatch) {
          cleanText = jsonMatch[0];
        }
        
        try {
          const parsed = JSON.parse(cleanText);
          if (parsed.playlist && Array.isArray(parsed.playlist)) {
            playlistBase = parsed.playlist;
            generatedDescription = parsed.description || "Uma playlist incrível para você.";
          } else if (Array.isArray(parsed)) {
            playlistBase = parsed;
            generatedDescription = "Uma playlist incrível para você.";
          } else {
            playlistBase = [];
            generatedDescription = "Uma playlist incrível para você.";
          }
        } catch (parseError) {
          console.error('Erro ao fazer parse do JSON:', parseError, 'Texto bruto:', text);
          playlistBase = [
            { artist: "Artista Desconhecido", title: "Música de Teste 1" },
            { artist: "Artista Desconhecido", title: "Música de Teste 2" }
          ];
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
      description: generatedDescription
    };

  } catch (error) {
    console.error('Erro ao gerar playlist:', error);
    throw error;
  }
};

const YOUTUBE_CLIENT_ID = import.meta.env.VITE_YOUTUBE_CLIENT_ID;

// O Google OAuth funciona um pouco diferente do Spotify, a biblioteca do GSI lida com o popup
export const initGoogleAuth = (onSuccess) => {
  if (window.google) return; // Já carregou

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  document.body.appendChild(script);
};

export const loginWithYouTube = (onSuccess, onError) => {
  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: YOUTUBE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    callback: (response) => {
      if (response.error !== undefined) {
        if(onError) onError(response);
        throw response;
      }
      onSuccess(response.access_token);
    },
  });
  tokenClient.requestAccessToken();
};

export const searchTrackYouTube = async (token, artist, title) => {
  try {
    const query = encodeURIComponent(`${artist} ${title} audio`);
    const response = await fetch(`https://youtube.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${query}&type=video&key=${YOUTUBE_CLIENT_ID}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.items && data.items.length > 0) {
      return data.items[0].id.videoId;
    }
    return null;
  } catch (error) {
    console.error('Erro na busca do YouTube:', error);
    return null;
  }
};

export const createYouTubePlaylist = async (token, playlistName, videoIds) => {
  // 1. Criar a playlist
  const createRes = await fetch('https://youtube.googleapis.com/youtube/v3/playlists?part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      snippet: {
        title: playlistName,
        description: 'Gerado pelo AI Playlist Generator'
      },
      status: {
        privacyStatus: 'private'
      }
    })
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Falha ao criar playlist no YouTube: ${errorText}`);
  }
  const playlistData = await createRes.json();
  const playlistId = playlistData.id;

  // 2. Inserir os vídeos
  for (const videoId of videoIds) {
    if(!videoId) continue;
    await fetch('https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoId
          }
        }
      })
    });
  }

  return `https://music.youtube.com/playlist?list=${playlistId}`;
};

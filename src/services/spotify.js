const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

export const getSpotifyLoginUrl = () => {
  const REDIRECT_URI = window.location.origin + '/callback';
  const scope = 'playlist-modify-public playlist-modify-private';
  return `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}`;
};

export const extractSpotifyTokenFromUrl = () => {
  if (window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const token = hashParams.get('access_token');
    if (token) {
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
      return token;
    }
  }
  return null;
};

export const searchTrackSpotify = async (token, artist, title) => {
  try {
    const query = encodeURIComponent(`track:${title} artist:${artist}`);
    const response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.tracks && data.tracks.items.length > 0) {
      const track = data.tracks.items[0];
      return {
        id: track.id,
        uri: track.uri,
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        image: track.album.images[0]?.url || '',
        previewUrl: track.preview_url, // Alguns tracks não tem preview no Spotify, mas quando tem, retorna aqui
        externalUrl: track.external_urls.spotify,
        durationMs: track.duration_ms
      };
    }
    return null;
  } catch (error) {
    console.error('Erro na busca do Spotify:', error);
    return null;
  }
};

export const createSpotifyPlaylist = async (token, userId, playlistName, trackUris) => {
  // 1. Criar a playlist
  const createRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: playlistName,
      description: 'Gerado pelo AI Playlist Generator',
      public: false
    })
  });
  
  if (!createRes.ok) throw new Error('Falha ao criar playlist');
  const playlistData = await createRes.json();

  // 2. Adicionar faixas
  if (trackUris.length > 0) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: trackUris })
    });
  }

  return playlistData.external_urls.spotify;
};

export const getSpotifyUserProfile = async (token) => {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Token inválido ou expirado');
  return await response.json();
};

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

// Funções auxiliares para PKCE
const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

export const getSpotifyLoginUrl = async () => {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  // Guarda o verifier para usar depois que voltar do login
  window.localStorage.setItem('spotify_code_verifier', codeVerifier);

  const REDIRECT_URI = window.location.origin + '/callback';
  const scope = 'playlist-modify-public playlist-modify-private';
  
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  const params = {
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: scope,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
  };

  authUrl.search = new URLSearchParams(params).toString();
  return authUrl.toString();
};

export const extractSpotifyTokenFromUrl = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  // Se tem o 'code', significa que o usuário acabou de voltar do login
  if (code) {
    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    const REDIRECT_URI = window.location.origin + '/callback';

    const payload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    };

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', payload);
      const data = await response.json();
      
      if (data.access_token) {
        // Limpa a URL para não ficar feia
        window.history.pushState("", document.title, window.location.pathname);
        return data.access_token;
      }
    } catch (err) {
      console.error('Erro ao trocar o código pelo token:', err);
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
        previewUrl: track.preview_url, 
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


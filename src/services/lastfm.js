export const searchTrackLastFM = async (artist, title, apiKey) => {
  try {
    const queryArtist = encodeURIComponent(artist);
    const queryTitle = encodeURIComponent(title);
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${queryArtist}&track=${queryTitle}&api_key=${apiKey}&format=json&limit=10`);
    
    if (!response.ok) return [];
    
    const data = await response.json();
    if (data.similartracks && data.similartracks.track) {
      return data.similartracks.track.map(t => ({
        artist: t.artist.name,
        title: t.name
      }));
    }
    return [];
  } catch (error) {
    console.error('Erro no Last.fm:', error);
    return [];
  }
};

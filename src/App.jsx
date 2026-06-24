import { useState, useEffect } from 'react';
import { generatePlaylist } from './services/api';
import { getSpotifyLoginUrl, extractSpotifyTokenFromUrl, getSpotifyUserProfile, createSpotifyPlaylist } from './services/spotify';
import { initGoogleAuth, loginWithYouTube, createYouTubePlaylist, searchTrackYouTube } from './services/youtube';
import './App.css';

const VIBE_TAGS = ['Treino', 'Foco', 'Relaxar', 'Festa', 'Anos 90', 'Triste', 'Acústico'];

// SVG de Fallback para imagens quebradas
const FALLBACK_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="background-color:%23111"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';

export function App() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [playlist, setPlaylist] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [engine, setEngine] = useState('AI'); // 'AI' ou 'LASTFM'

  // OAuth states
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyProfile, setSpotifyProfile] = useState(null);
  const [youtubeToken, setYoutubeToken] = useState(null);
  
  const [isExportingSpotify, setIsExportingSpotify] = useState(false);
  const [isExportingYouTube, setIsExportingYouTube] = useState(false);

  useEffect(() => {
    // Verifica login do Spotify na URL (agora é async por causa do PKCE)
    extractSpotifyTokenFromUrl().then(token => {
      if (token) {
        setSpotifyToken(token);
        getSpotifyUserProfile(token).then(setSpotifyProfile).catch(console.error);
      }
    });
    
    // Inicia script do Google
    initGoogleAuth();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setErrorMsg('');
    setPlaylist(null);
    
    const referenceText = e.target.elements.reference.value;
    const amount = e.target.elements.amount.value;
    const aiKey = import.meta.env.VITE_GROQ_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    const lastfmKey = import.meta.env.VITE_LASTFM_API_KEY;

    try {
      const realPlaylist = await generatePlaylist(referenceText, amount, selectedTags, engine, aiKey, lastfmKey, spotifyToken, youtubeToken);
      setPlaylist(realPlaylist);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleImageError = (e) => {
    e.target.onerror = null; // Previne loop infinito
    e.target.src = FALLBACK_IMAGE;
  };

  const handleExportSpotify = async () => {
    if (!spotifyToken || !spotifyProfile || !playlist) return;
    setIsExportingSpotify(true);
    try {
      const uris = playlist.filter(t => t.spotifyUri).map(t => t.spotifyUri);
      const url = await createSpotifyPlaylist(spotifyToken, spotifyProfile.id, 'Gerada por IA - Playlist Generator', uris);
      window.open(url, '_blank');
    } catch (err) {
      console.error(err);
      alert(`Erro ao exportar para Spotify: ${err.message}`);
    } finally {
      setIsExportingSpotify(false);
    }
  };

  const handleExportYouTube = async () => {
    if (!playlist) return;
    
    const executeExport = async (token) => {
      setIsExportingYouTube(true);
      try {
        const videoIds = [];
        for (const track of playlist) {
          if (track.youtubeVideoId) {
            videoIds.push(track.youtubeVideoId);
          } else {
            // Busca agora, já que conectou depois de gerar
            const id = await searchTrackYouTube(token, track.artist, track.title);
            if (id) videoIds.push(id);
          }
        }
        
        const url = await createYouTubePlaylist(token, 'Gerada por IA - Playlist Generator', videoIds);
        window.open(url, '_blank');
      } catch (err) {
        console.error(err);
        alert(`Erro ao exportar para YouTube: ${err.message}`);
      } finally {
        setIsExportingYouTube(false);
      }
    };

    if (youtubeToken) {
      executeExport(youtubeToken);
    } else {
      loginWithYouTube(
        (token) => {
          setYoutubeToken(token);
          executeExport(token);
        },
        () => alert("Login no YouTube cancelado.")
      );
    }
  };

  return (
    <div className="app-container animate-fade-in">
      <header className="header">
        <h1>
          Crie a <span className="text-gradient">Playlist Perfeita</span>
        </h1>
        <p>
          Informe algumas músicas que você gosta e nossa inteligência criará uma lista de recomendações na mesma vibração.
        </p>
      </header>

      <main className="main-content">
        <aside>
          <div className="glass-panel form-container" style={{ marginBottom: '16px' }}>
            <h3 style={{ marginBottom: '12px' }}>Conexões (Opcional)</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!spotifyToken ? (
                <button type="button" onClick={async () => window.location.href = await getSpotifyLoginUrl()} className="btn-primary" style={{ background: '#1DB954', flex: 1, textAlign: 'center' }}>
                  Conectar Spotify
                </button>
              ) : (
                <div style={{ background: 'rgba(29, 185, 84, 0.2)', color: '#1DB954', padding: '12px', borderRadius: '8px', flex: 1, textAlign: 'center', fontWeight: 'bold' }}>
                  Spotify Conectado ✅
                </div>
              )}
              
              {!youtubeToken ? (
                <button type="button" onClick={() => loginWithYouTube(setYoutubeToken)} className="btn-primary" style={{ background: '#FF0000', flex: 1, textAlign: 'center' }}>
                  Conectar YouTube
                </button>
              ) : (
                <div style={{ background: 'rgba(255, 0, 0, 0.2)', color: '#FF0000', padding: '12px', borderRadius: '8px', flex: 1, textAlign: 'center', fontWeight: 'bold' }}>
                  YouTube Conectado ✅
                </div>
              )}
            </div>
          </div>

          <form className="glass-panel form-container" onSubmit={handleGenerate}>
            <div className="form-group">
              <label>Motor de Busca</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button 
                  type="button" 
                  onClick={() => setEngine('AI')}
                  className={`btn-primary ${engine === 'AI' ? '' : 'inactive'}`}
                  style={{ flex: 1, opacity: engine === 'AI' ? 1 : 0.5, transition: '0.3s' }}
                >
                  ✨ Inteligência Artificial
                </button>
                <button 
                  type="button" 
                  onClick={() => setEngine('LASTFM')}
                  className={`btn-primary ${engine === 'LASTFM' ? '' : 'inactive'}`}
                  style={{ flex: 1, background: '#d51007', opacity: engine === 'LASTFM' ? 1 : 0.5, transition: '0.3s' }}
                >
                  🎵 Last.fm Clássico
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reference">Músicas de referência</label>
              <textarea 
                id="reference" 
                name="reference"
                className="form-input" 
                rows="3" 
                placeholder="Ex: Daft Punk - Get Lucky, The Weeknd..."
                required
              ></textarea>
            </div>

            <div className="form-group">
              <label htmlFor="amount">Quantidade de faixas</label>
              <input 
                type="number" 
                id="amount" 
                name="amount"
                className="form-input" 
                min="3" 
                max="20" 
                defaultValue="10" 
              />
            </div>

            {engine === 'AI' && (
              <div className="form-group">
                <label>Vibe / Estilo (Somente para IA)</label>
                <div className="tags-container">
                  {VIBE_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`vibe-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={isGenerating}>
              {isGenerating ? 'Analisando e Gerando...' : 'Gerar Playlist'}
            </button>

            {errorMsg && (
              <div style={{ color: '#ec4899', fontSize: '0.9rem', marginTop: '8px', padding: '12px', background: 'rgba(236,72,153,0.1)', borderRadius: '8px', border: '1px solid #ec4899' }}>
                <strong>Erro:</strong> {errorMsg}
              </div>
            )}
          </form>
        </aside>

        <section className="results-container">
          {!playlist && !isGenerating && (
            <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', opacity: 0.6 }}>
              <p>Preencha os dados ao lado para gerar sua playlist.</p>
            </div>
          )}

          {isGenerating && (
            <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', animation: 'pulse-glow 2s infinite' }}>
              <h2 className="text-gradient">Buscando as melhores faixas...</h2>
              <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>A Inteligência Artificial está pensando, isso pode levar alguns segundos.</p>
            </div>
          )}

          {playlist && !isGenerating && (
            <div className="animate-fade-in">
              <div className="results-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2>Sua nova Playlist</h2>
                  <span style={{ color: 'var(--text-muted)' }}>{playlist.length} faixas</span>
                </div>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                  {spotifyToken && (
                    <button onClick={handleExportSpotify} disabled={isExportingSpotify} className="btn-primary" style={{ background: '#1DB954', padding: '8px 16px', fontSize: '0.9rem' }}>
                      {isExportingSpotify ? 'Salvando...' : 'Salvar no Spotify'}
                    </button>
                  )}
                  <button onClick={handleExportYouTube} disabled={isExportingYouTube} className="btn-primary" style={{ background: '#FF0000', padding: '8px 16px', fontSize: '0.9rem' }}>
                    {isExportingYouTube ? 'Salvando...' : 'Salvar no YT Music'}
                  </button>
                </div>
              </div>
              
              <div className="playlist glass-panel" style={{ padding: '24px' }}>
                {playlist.map((track, index) => (
                  <div key={track.id} className="track-card" style={{ animationDelay: `${index * 0.1}s` }}>
                    <img 
                      src={track.image || FALLBACK_IMAGE} 
                      alt={`Capa do álbum ${track.title}`} 
                      className="track-image"
                      onError={handleImageError}
                    />
                    <div className="track-info" style={{ flex: 1 }}>
                      <span className="track-title">{track.title}</span>
                      <span className="track-artist">{track.artist}</span>
                      
                      {/* Audio Player para preview do Spotify */}
                      {track.spotifyPreview && (
                        <audio controls src={track.spotifyPreview} style={{ height: '30px', marginTop: '8px', maxWidth: '200px' }} />
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                      <div className="track-duration">{track.duration}</div>
                      {track.spotifyUrl && (
                         <a href={track.spotifyUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: '#1DB954', textDecoration: 'none', background: 'rgba(29, 185, 84, 0.1)', padding: '4px 8px', borderRadius: '4px' }}>Abrir Spotify</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;

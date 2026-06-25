import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Trash2, Volume2 } from 'lucide-react';
import { generatePlaylist } from './services/api';
import { getSpotifyLoginUrl, extractSpotifyTokenFromUrl, getSpotifyUserProfile, createSpotifyPlaylist, uploadSpotifyCover } from './services/spotify';
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

  // Novos States
  const [trackCount, setTrackCount] = useState(20);
  const [playlistName, setPlaylistName] = useState('Gerada por IA - Playlist Generator');
  const [playlistDesc, setPlaylistDesc] = useState('Músicas selecionadas pelo seu gosto musical.');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  const [coverBase64, setCoverBase64] = useState(null);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [volume, setVolume] = useState(0.2);
  const audioRef = useRef(new Audio());

  // OAuth states
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyProfile, setSpotifyProfile] = useState(null);
  const [youtubeToken, setYoutubeToken] = useState(null);
  
  const [isExportingSpotify, setIsExportingSpotify] = useState(false);
  const [isExportingYouTube, setIsExportingYouTube] = useState(false);

  useEffect(() => {
    // Escuta evento de fim da música
    audioRef.current.addEventListener('ended', () => setPlayingTrackId(null));
    audioRef.current.volume = 0.2;

    // Verifica login do Spotify na URL
    extractSpotifyTokenFromUrl().then(token => {
      if (token) {
        setSpotifyToken(token);
        getSpotifyUserProfile(token).then(setSpotifyProfile).catch(console.error);
      }
    });
    
    // Inicia script do Google
    initGoogleAuth();
  }, []);

  const generateCoverImage = async (desc) => {
    try {
      setCoverBase64(null);
      const prompt = desc ? encodeURIComponent(desc + ", beautiful aesthetic album cover, hd, premium, no text") : "beautiful abstract music sound waves dark background aesthetic, no text";
      const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true`;
      
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 300, 300);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        setCoverBase64(dataUrl.split(',')[1]); // Remove o prefixo data:image/jpeg;base64,
      };
      img.src = imageUrl;
    } catch (error) {
      console.error('Erro ao gerar capa', error);
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setErrorMsg('');
    setPlaylist(null);
    setPlayingTrackId(null);
    audioRef.current.pause();
    
    const referenceText = e.target.elements.reference.value;
    const aiKey = import.meta.env.VITE_GROQ_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    const lastfmKey = import.meta.env.VITE_LASTFM_API_KEY;

    // Gera a capa em background
    generateCoverImage(playlistDesc);

    try {
      const realPlaylist = await generatePlaylist(referenceText, trackCount, selectedTags, engine, aiKey, lastfmKey, spotifyToken, youtubeToken, yearStart, yearEnd);
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

  const togglePlay = (url, id) => {
    if (!url) return;
    if (playingTrackId === id) {
      audioRef.current.pause();
      setPlayingTrackId(null);
    } else {
      audioRef.current.src = url;
      audioRef.current.play();
      setPlayingTrackId(id);
    }
  };

  const removeTrack = (id) => {
    setPlaylist(playlist.filter(t => t.id !== id));
    if (playingTrackId === id) {
      audioRef.current.pause();
      setPlayingTrackId(null);
    }
  };

  const handleImageError = (e) => {
    e.target.onerror = null;
    e.target.src = FALLBACK_IMAGE;
  };

  const handleExportSpotify = async () => {
    if (!spotifyToken || !spotifyProfile || !playlist) return;
    setIsExportingSpotify(true);
    try {
      const uris = playlist.filter(t => t.spotifyUri).map(t => t.spotifyUri);
      const spotifyExport = await createSpotifyPlaylist(spotifyToken, spotifyProfile.id, playlistName, uris, playlistDesc);
      
      if (coverBase64) {
        await uploadSpotifyCover(spotifyToken, spotifyExport.id, coverBase64);
      }

      window.open(spotifyExport.url, '_blank');
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
            const id = await searchTrackYouTube(token, track.artist, track.title);
            if (id) videoIds.push(id);
          }
        }
        
        const url = await createYouTubePlaylist(token, playlistName, videoIds, playlistDesc);
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
              <label>Nome da Playlist</label>
              <input 
                type="text" 
                className="form-input" 
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label>Descrição (Usada p/ Capa IA)</label>
              <textarea 
                className="form-input" 
                rows="2" 
                value={playlistDesc}
                onChange={(e) => setPlaylistDesc(e.target.value)}
              ></textarea>
            </div>

            <div className="form-group">
              <label>Quantidade de faixas: {trackCount}</label>
              <input 
                type="range" 
                className="form-input" 
                min="10" 
                max="50" 
                value={trackCount}
                onChange={(e) => setTrackCount(Number(e.target.value))}
                style={{ padding: '0', cursor: 'pointer' }}
              />
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

            {engine === 'AI' && (
              <>
                <div className="form-group">
                  <label>Filtro de Época (Opcional)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="number" 
                      className="form-input" 
                      placeholder="Ano Inicial (Ex: 2015)"
                      value={yearStart}
                      onChange={(e) => setYearStart(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input 
                      type="number" 
                      className="form-input" 
                      placeholder="Ano Final (Ex: 2020)"
                      value={yearEnd}
                      onChange={(e) => setYearEnd(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>

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
              </>
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
              <div className="results-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  {coverBase64 ? (
                    <img src={`data:image/jpeg;base64,${coverBase64}`} alt="Capa Gerada" style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '80px', height: '80px', borderRadius: '8px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>🎨</div>
                  )}
                  <div>
                    <h2>{playlistName}</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '300px' }}>{playlistDesc}</p>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{playlist.length} faixas</span>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Volume2 size={20} color="#ec4899" />
                  <input 
                    type="range" 
                    min="0" max="1" step="0.05" 
                    value={volume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setVolume(val);
                      audioRef.current.volume = val;
                    }}
                    style={{ width: '80px', marginRight: '16px', accentColor: '#ec4899' }}
                  />

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
                  <div key={track.id} className="track-card" style={{ animationDelay: `${index * 0.05}s` }}>
                    <img 
                      src={track.image || FALLBACK_IMAGE} 
                      alt={`Capa do álbum ${track.title}`} 
                      className="track-image"
                      onError={handleImageError}
                    />
                    
                    <div className="track-info" style={{ flex: 1 }}>
                      <span className="track-title">{track.title}</span>
                      <span className="track-artist">{track.artist}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {track.spotifyPreview && (
                        <button 
                          onClick={() => togglePlay(track.spotifyPreview, track.id)}
                          style={{ background: 'rgba(255,255,255,0.1)', padding: '8px', borderRadius: '50%', cursor: 'pointer', border: 'none', color: 'white' }}
                          title="Ouvir 30s"
                        >
                          {playingTrackId === track.id ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                      )}
                      
                      <div className="track-duration">{track.duration}</div>
                      
                      <button 
                        onClick={() => removeTrack(track.id)}
                        style={{ background: 'transparent', padding: '8px', border: 'none', color: '#ec4899', cursor: 'pointer' }}
                        title="Remover faixa"
                      >
                        <Trash2 size={18} />
                      </button>
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

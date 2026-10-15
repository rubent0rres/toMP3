'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronDown, CircleAlert, Clipboard, Clock3, Film, Folder, FolderOpen, History, Link2, LoaderCircle, Music2, Plus, RotateCcw, Settings2, ShieldCheck, Disc3, Trash2, X, Info } from 'lucide-react';
import type { AppState, Format, Job, Video } from './types';
import developer from '../shared/developer.json';
const initial: AppState = { destination: '', jobs: [], toolsReady: false, version: '0.1.0', platform: 'darwin' };
const inProgress = (job: Job) => ['queued', 'downloading', 'converting'].includes(job.status);
function duration(seconds: number) { if (!seconds) return 'Duración no disponible'; const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); const s = Math.floor(seconds % 60).toString().padStart(2, '0'); return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`; }
function bytes(value: number) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB/s` : `${Math.round(value / 1024)} KB/s`; }
function statusLabel(job: Job) { return ({ queued: 'En cola', downloading: 'Descargando', converting: job.format === 'mp3' ? 'Convirtiendo a MP3' : 'Preparando video', completed: 'Completado', error: 'No se pudo descargar', cancelled: 'Cancelado' })[job.status]; }
export default function Home() {
  const [state, setState] = useState(initial);
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'download' | 'history' | 'settings' | 'about'>('download');
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState<Video | null>(null);
  const [format, setFormat] = useState<Format>('mp3');
  const [quality, setQuality] = useState('320');
  const [analyzing, setAnalyzing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState<'all' | 'mp3' | 'mp4'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const api = window.tomp3;
    if (!api) { const timer = setTimeout(() => setDesktop(false), 0); return () => clearTimeout(timer); }
    const unsub = api.onState(setState);
    api.getState().then(data => { setState(data); setDesktop(true); }).catch(e => setError(e.message));
    return unsub;
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  const active = state.jobs.filter(inProgress);
  const completed = state.jobs.filter(job => job.status === 'completed');
  const historical = state.jobs.filter(job => !inProgress(job));
  const visible = (tab === 'history' ? historical : [...[...active].reverse(), ...historical.slice(0, Math.max(0, 8 - active.length))]).filter(job => filter === 'all' || job.format === filter);
  const isFacebook = video?.source === 'facebook' || /^https:\/\/(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.watch)(?:\/|$)/i.test(url.trim());
  const selectedQuality = format === 'mp4' && isFacebook ? 'original' : quality;
  async function action(operation: () => Promise<unknown>) { try { await operation(); } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo completar la operación.'); } }
  function selectFormat(next: Format) { setFormat(next); setQuality(next === 'mp3' ? '320' : '1080'); }
  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (!window.tomp3) { setError('Abre la aplicación de escritorio para analizar y descargar videos.'); return; }
    setError(''); setVideo(null); setAnalyzing(true);
    try { setVideo(await window.tomp3.inspect(url)); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo analizar el enlace.'); } finally { setAnalyzing(false); }
  }
  async function addDownload() {
    if (!video || !window.tomp3) return;
    setAdding(true); setError('');
    try { await window.tomp3.download(video.url, { format, quality: selectedQuality }); setToast('Descarga añadida a la cola.'); setVideo(null); setUrl(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar la descarga.'); }
    finally { setAdding(false); }
  }
  async function paste() {
    if (!window.tomp3) { inputRef.current?.focus(); return; }
    try { const text = await window.tomp3.pasteUrl(); setUrl(text.trim()); setVideo(null); setError(''); inputRef.current?.focus(); } catch { setToast('Pega el enlace directamente en el campo.'); }
  }
  function openContact(event: React.MouseEvent<HTMLAnchorElement>, target: 'email' | 'github') {
    if (!window.tomp3) return;
    event.preventDefault();
    void action(() => window.tomp3!.openContact(target));
  }
  const folderName = state.destination.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ');
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="window-space" />
      <a href="#" className="brand" onClick={e => { e.preventDefault(); setTab('download'); }} aria-label="toMP3, inicio"><span className="brand-mark"><AudioLines size={27} strokeWidth={2}/></span><span>to<strong>MP3</strong></span></a>
      <nav aria-label="Navegación principal">
        <button className={tab === 'download' ? 'nav-item selected' : 'nav-item'} onClick={() => { setTab('download'); setFilter('all'); }}><ArrowDownToLine size={23}/><span>Descargar</span></button>
        <button className={tab === 'history' ? 'nav-item selected' : 'nav-item'} onClick={() => { setTab('history'); setFilter('all'); }}><History size={23}/><span>Historial</span>{historical.length > 0 && <span className="count">{historical.length}</span>}</button>
        <button className={tab === 'settings' ? 'nav-item selected' : 'nav-item'} onClick={() => setTab('settings')}><Settings2 size={23}/><span>Ajustes</span></button>
        <button className={tab === 'about' ? 'nav-item selected' : 'nav-item'} onClick={() => setTab('about')}><Info size={23}/><span>Acerca de</span></button>
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-wave"><AudioLines size={24}/></span><span className="version">v{state.version}</span></div>
    </aside>
    <main>
      <header className="topbar"><span><span className="status-dot"/>TU CONTENIDO, CONTIGO</span><div className="local-badge"><ShieldCheck size={17}/>Archivos en tu equipo</div></header>
      <div className={`main-content ${tab === 'about' ? 'about-view' : ''}`}>
        {tab !== 'about' && <div className="page-heading"><div><h1>{tab === 'download' ? <>Tu próximo <span>play.</span></> : tab === 'history' ? <>Tus <span>descargas.</span></> : <>Todo <span>a tu gusto.</span></>}</h1><p>{tab === 'download' ? 'YouTube o Reels de Facebook. Guárdalos en MP3 o MP4.' : tab === 'history' ? 'Tu colección de audio y video, en un solo lugar.' : 'Elige dónde guardar tu música y tus videos.'}</p></div><button className="header-folder icon-button" title="Abrir carpeta de descargas" aria-label="Abrir carpeta de descargas" disabled={!desktop} onClick={() => action(async () => { await window.tomp3?.openFolder(); })}><FolderOpen size={22}/></button></div>}
        {tab !== 'about' && desktop === false && <div className="notice"><CircleAlert size={19}/><span>Estás viendo la interfaz web. Abre toMP3 en el escritorio para descargar.</span></div>}
        {tab !== 'about' && desktop && !state.toolsReady && <div className="notice error"><CircleAlert size={19}/><span>Faltan las herramientas de descarga. Ejecuta <code>npm run tools:setup</code> y vuelve a abrir toMP3.</span></div>}
        {tab === 'download' && <>
          <section className="download-card" aria-labelledby="new-download">
            <div className="section-heading"><h2 id="new-download"><Plus size={20}/>Nueva descarga</h2><span className={`source-badge ${isFacebook ? 'facebook' : 'youtube'}`}><span className="source-symbol">{isFacebook ? 'f' : '▶'}</span>{isFacebook ? 'Facebook Reels' : 'YouTube'}</span></div>
            <form onSubmit={analyze}>
              <label className="field-label" htmlFor="video-url">Enlace del video</label>
              <div className="url-row"><div className={`url-field ${error ? 'invalid' : ''}`}><Link2 size={21}/><input ref={inputRef} id="video-url" type="url" placeholder="Pega un enlace de YouTube o Facebook…" value={url} onChange={e => { setUrl(e.target.value); setVideo(null); setError(''); }} disabled={analyzing || adding} required autoComplete="off" spellCheck={false}/><button type="button" className="paste-button" onClick={paste} disabled={analyzing || adding}><Clipboard size={17}/>Pegar</button></div><button type="submit" className="analyze-button" disabled={!url.trim() || analyzing || adding}>{analyzing ? <><LoaderCircle className="spin" size={18}/>Analizando…</> : <>Analizar enlace<ArrowRight size={18}/></>}</button></div>
            </form>
            {error && <div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
            {video && <div className="video-preview">{video.thumbnail ? <img src={video.thumbnail} alt="Miniatura del video" referrerPolicy="no-referrer"/> : <div className="preview-placeholder"><Film/></div>}<div><span className="preview-eyebrow"><Check size={14}/>VIDEO ENCONTRADO</span><h3>{video.title}</h3><p>{video.author}<span>·</span>{duration(video.duration)}</p></div><button className="icon-button" aria-label="Quitar vista previa" onClick={() => setVideo(null)} disabled={adding}><X size={20}/></button></div>}
            <div className="conversion-row">
              <fieldset className="format-group"><legend className="field-label">Formato</legend><div className="format-grid">
                <button className={`format-option audio ${format === 'mp3' ? 'active' : ''}`} onClick={() => selectFormat('mp3')} disabled={adding} aria-pressed={format === 'mp3'}><Music2 size={23}/><span><strong>Solo audio</strong><small>MP3</small></span><span className="radio-circle">{format === 'mp3' && <Check size={13}/>}</span></button>
                <button className={`format-option video ${format === 'mp4' ? 'active' : ''}`} onClick={() => selectFormat('mp4')} disabled={adding} aria-pressed={format === 'mp4'}><Film size={23}/><span><strong>Video + audio</strong><small>MP4</small></span><span className="radio-circle">{format === 'mp4' && <Check size={13}/>}</span></button>
              </div></fieldset>
              <div className="quality-control"><label className="field-label" htmlFor="quality">Calidad {format === 'mp3' ? 'de audio' : 'de video'}</label><div className="select-wrap"><select id="quality" value={selectedQuality} onChange={e => setQuality(e.target.value)} disabled={adding}>{(format === 'mp3' ? [['320', '320 kbps · Alta calidad'], ['256', '256 kbps'], ['192', '192 kbps · Equilibrada'], ['128', '128 kbps · Ligero']] : isFacebook ? [['original', 'Mejor calidad disponible']] : [['1080', 'Hasta 1080p · Full HD'], ['720', 'Hasta 720p · HD'], ['1440', 'Hasta 1440p · 2K'], ['2160', 'Hasta 2160p · 4K']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={17}/></div></div>
              <button className="download-button" onClick={addDownload} disabled={!video || adding || !state.toolsReady}>{adding ? <LoaderCircle size={20} className="spin"/> : <ArrowDownToLine size={20}/>}Descargar {format.toUpperCase()}</button>
            </div>
            <div className="destination"><Folder size={17}/><span>Guardar en</span><button className="destination-path" title={state.destination || 'Carpeta de descargas'} onClick={() => action(async () => { await window.tomp3?.openFolder(); })} disabled={!desktop}>{folderName || 'Descargas / toMP3'}</button><button className="change-folder" onClick={() => action(async () => { await window.tomp3?.chooseFolder(); })} disabled={!desktop}>Cambiar<ArrowRight size={14}/></button>{format === 'mp4' && <span className="quality-hint">{isFacebook ? 'Calidad original del Reel.' : 'Hasta la resolución disponible.'}</span>}</div>
          </section>
        </>}
        {tab === 'about' ? <section className="about-section" aria-labelledby="about-title">
          <span className="about-mark" aria-hidden="true"><AudioLines size={25}/></span>
          <h1 id="about-title">toMP3</h1>
          <p className="about-version">Versión {state.version}</p>
          <p className="about-description">Audio y video de YouTube y Reels de Facebook, directo a tu equipo.</p>
          <div className="about-links">
            <a href={`mailto:${developer.email}`} onClick={event => openContact(event, 'email')}>{developer.email}</a>
            <a href={developer.github} target="_blank" rel="noopener noreferrer" onClick={event => openContact(event, 'github')}>{developer.github.replace('https://', '')}</a>
          </div>
        </section> : tab === 'settings' ? <section className="settings-card"><div className="settings-icon"><FolderOpen size={28}/></div><h2>Un lugar para tus archivos</h2><p>Las nuevas descargas se guardarán aquí. Las que ya están en cola conservarán su carpeta original.</p><div className="folder-setting"><Folder size={21}/><span>{state.destination || 'Descargas / toMP3'}</span><button onClick={() => action(async () => { await window.tomp3?.chooseFolder(); })} disabled={!desktop}>Cambiar carpeta</button></div><div className="settings-divider"/><div className="settings-row"><span>Motor de descarga</span><strong className={state.toolsReady ? 'text-green' : ''}>{state.toolsReady ? 'Listo para descargar' : 'No disponible en esta vista'}</strong></div><div className="settings-row"><span>Conversión de audio y video</span><strong>FFmpeg · MP3 / MP4</strong></div><div className="settings-row"><span>Versión de toMP3</span><strong>{state.version}</strong></div><p className="settings-footnote">La calidad final depende del archivo original. Convertir a una tasa mayor no mejora la calidad de la fuente.</p></section> : <section className="activity-section" aria-labelledby="activity-title"><div className="activity-heading"><h2 id="activity-title">{tab === 'history' ? 'Historial' : 'Descargas recientes'}<span>{tab === 'history' ? historical.length : state.jobs.length}</span></h2>{tab === 'history' ? <button className="text-button" onClick={() => action(async () => { await window.tomp3?.clearHistory(); setToast('Historial limpiado. Tus archivos siguen en su carpeta.'); })} disabled={!historical.length}><Trash2 size={16}/>Limpiar historial</button> : <button className="text-button" onClick={() => { setTab('history'); setFilter('all'); }}>Ver historial<ArrowRight size={17}/></button>}</div>
          {tab === 'history' && <div className="filters">{(['all', 'mp3', 'mp4'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'Todos' : value.toUpperCase()}</button>)}<span>{completed.length} completadas</span></div>}
          {!visible.length ? <div className="empty-state"><span className="empty-icon"><Disc3 size={33}/></span><div><h3>{tab === 'history' ? 'Tu colección empieza aquí' : 'Dale play a tu primera descarga'}</h3><p>{tab === 'history' ? 'Las descargas terminadas aparecerán en este espacio.' : 'Pega un enlace, elige el formato y guárdalo en tu equipo.'}</p></div><ArrowDownToLine size={27} className="empty-decoration"/></div> : <div className="job-list" aria-live="polite">{visible.map(job => <article className={`job-row ${job.status}`} key={job.id}><div className={`job-icon ${job.format}`}>{job.format === 'mp3' ? <Music2 size={25}/> : <Film size={25}/>}{job.thumbnail && <img src={job.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy"/>}<span>{job.format.toUpperCase()}</span></div><div className="job-details"><h3 title={job.title}>{job.title}</h3><div className="job-meta"><span><AudioLines size={14}/>{job.quality === 'original' ? 'Original' : `${job.quality}${job.format === 'mp3' ? ' kbps' : 'p máx.'}`}</span><span><Clock3 size={14}/>{duration(job.duration)}</span>{job.status === 'downloading' && <span><ArrowDown size={14}/>{job.speed ? bytes(job.speed) : 'Conectando…'}</span>}</div>{inProgress(job) && <div className="progress-track"><div style={{ width: `${job.progress}%` }} className={job.status === 'converting' ? 'processing' : ''}/></div>}{job.error && <p className="job-error" title={job.error}>{job.error}</p>}</div><div className="job-status"><span className={`status-label ${job.status}`}>{job.status === 'completed' ? <Check size={15}/> : job.status === 'error' ? <CircleAlert size={15}/> : inProgress(job) ? <LoaderCircle size={15} className="spin"/> : null}{statusLabel(job)}</span>{job.status === 'downloading' && <small>{Math.round(job.progress)}%{job.eta ? ` · ${Math.ceil(job.eta)} s restantes` : ''}</small>}{job.status === 'completed' && <small>{new Date(job.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</small>}</div><div className="job-action">{inProgress(job) ? <button className="icon-button" aria-label={`Cancelar ${job.title}`} title="Cancelar descarga" onClick={() => action(async () => { await window.tomp3?.cancel(job.id); })}><X size={21}/></button> : job.status === 'completed' ? <button className="icon-button" aria-label={`Mostrar ${job.title} en carpeta`} title="Mostrar en carpeta" onClick={() => action(async () => { await window.tomp3?.reveal(job.id); })}><FolderOpen size={22}/></button> : <button className="icon-button" aria-label={`Reintentar ${job.title}`} title="Reintentar" onClick={() => action(async () => { await window.tomp3?.retry(job.id); })}><RotateCcw size={21}/></button>}</div></article>)}</div>}
          {active.length > 0 && <div className="queue-note"><Clock3 size={15}/>{active.length} {active.length === 1 ? 'descarga pendiente' : 'descargas pendientes'} · Se procesan una a la vez.</div>}
        </section>}
        {tab !== 'about' && <footer><span><ShieldCheck size={15}/>Tus archivos se quedan contigo.</span><span>MP3 + MP4. Así de simple.</span></footer>}
      </div>
    </main>
    {toast && <div className="toast" role="status"><CircleAlert size={19}/><span>{toast}</span><button aria-label="Cerrar aviso" onClick={() => setToast('')}><X size={18}/></button></div>}
  </div>;
}

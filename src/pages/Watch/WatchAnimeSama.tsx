import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import HLSPlayer from '../../components/HLSPlayer';
import { getTmdbApiKey } from '@/config/tmdbKey';
import { getTmdbLanguage } from '../../i18n';
import { getTmdbId, encodeId } from '../../utils/idEncoder';
import { runExtractionPass } from '../../utils/runExtractionPass';
import type { SeekStreamingHlsSource } from '../../utils/seekStreamingCandidates';
import { isMainEntry, locateTmdbEpisode } from '../../utils/animeSamaMapping';
import {
  animeSamaEpisodePlayers,
  animeSamaLanguageLabel,
  animeSamaProgressKey,
  loadAnimeSamaAnime,
  mergeEpisodeProgress,
  nextAnimeSamaPosition,
  type AnimeSamaAnime,
  type TmdbShowForAnime,
} from '../../utils/animeSamaSource';
import { setAnimeSamaMode } from '@/tv/data/animeSamaMode';

/**
 * Lecture d'un épisode dans le découpage Anime-Sama (15/10/2026).
 *
 *   /watch/anime/:tmdbid/:entry/:episode    entrée et épisode en base 1
 *
 * Ouverte depuis l'onglet Anime-Sama de la fiche : saisons, films et OAV tels
 * qu'Anime-Sama les découpe, et ses seules sources. La page de l'amont
 * (`WatchAnime.tsx`, retirée le 15/09/2026 avec le site souris) faisait la
 * même chose avec une interface à la souris ; celle-ci ne garde que le
 * lecteur, piloté à la télécommande comme `WatchTv`.
 *
 * La progression a sa propre clé (`animeSamaProgressKey`) : « saison 2,
 * épisode 3 » n'est pas ici le même épisode que dans la numérotation TMDB.
 */

const TMDB_API_KEY = getTmdbApiKey();
/** Fichier hébergé par Anime-Sama même (mp4 direct), et non un lecteur à extraire. */
const ANIME_SAMA_FILE = /anime-sama\.[a-z]+\/videos\/.+\.mp4(?:\?|$)/i;

interface TmdbShow extends TmdbShowForAnime {
  backdrop_path?: string | null;
  poster_path?: string | null;
}

type Status = 'loading' | 'absent' | 'no-source' | 'ready';

/** L'épisode TMDB correspondant, pour son image et son résumé (mêmes épisodes, autre découpage). */
interface TmdbEpisodeInfo {
  still_path?: string | null;
  overview?: string;
  name?: string;
}

/** Épisode TMDB (saison, épisode en base 1) d'un épisode Anime-Sama, si la correspondance est sûre. */
function tmdbPositionOf(show: TmdbShow, anime: AnimeSamaAnime, entry: number, index: number): { season: number; episode: number } | null {
  const seasons = anime.seasons ?? [];
  const current = seasons[entry];
  if (!current || !isMainEntry({ name: current.name, episodes: 0 })) return null;
  const main = seasons.filter(season => isMainEntry({ name: season.name, episodes: 0 }));
  return locateTmdbEpisode(
    (show.seasons ?? []).filter(season => season.season_number > 0).map(season => [season.season_number, season.episode_count] as [number, number]),
    main.map(season => season.episodes?.length ?? 0),
    main.indexOf(current),
    index,
  );
}

async function tmdbEpisodeOf(
  show: TmdbShow,
  position: { season: number; episode: number } | null,
  signal: AbortSignal,
): Promise<TmdbEpisodeInfo | null> {
  if (!position) return null;
  try {
    const { data } = await axios.get<TmdbEpisodeInfo>(
      `https://api.themoviedb.org/3/tv/${show.id}/season/${position.season}/episode/${position.episode}`,
      { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }, signal },
    );
    return data;
  } catch {
    return null;
  }
}

interface Playback {
  hls: SeekStreamingHlsSource[];
  files: { url: string; label: string }[];
  mp4: { url: string; label: string; language: string }[];
}

const WatchAnimeSama: React.FC = () => {
  const { tmdbid: encodedId, entry: entryParam, episode: episodeParam } = useParams<{
    tmdbid: string;
    entry: string;
    episode: string;
  }>();
  const navigate = useNavigate();
  const id = encodedId ? Number(getTmdbId(encodedId)) : NaN;
  const entry = Number(entryParam) - 1;
  const index = Number(episodeParam) - 1;

  const [status, setStatus] = useState<Status>('loading');
  const [show, setShow] = useState<TmdbShow | null>(null);
  const [anime, setAnime] = useState<AnimeSamaAnime | null>(null);
  const [playback, setPlayback] = useState<Playback>({ hls: [], files: [], mp4: [] });
  const [tmdbEpisode, setTmdbEpisode] = useState<TmdbEpisodeInfo | null>(null);
  /** Même épisode côté TMDB : les bases d'intro et de générique ne connaissent que lui. */
  const [segmentEpisode, setSegmentEpisode] = useState<{ tvShowId: string; seasonNumber: number; episodeNumber: number } | null>(null);
  /** Source en lecture ; vide : la première disponible. */
  const [selectedSrc, setSelectedSrc] = useState('');
  const activeSrcRef = useRef('');

  useEffect(() => {
    if (!Number.isInteger(id) || entry < 0 || index < 0) {
      setStatus('absent');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    (async () => {
      try {
        const { data } = await axios.get<TmdbShow>(`https://api.themoviedb.org/3/tv/${id}`, {
          params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() },
          signal: controller.signal,
        });
        setShow(data);
        const found = await loadAnimeSamaAnime(data, controller.signal);
        if (controller.signal.aborted) return;
        if (!found?.seasons?.[entry]?.episodes?.[index]) {
          setStatus('absent');
          return;
        }
        setAnime(found);
        setAnimeSamaMode(id, true);
        // Image et résumé de l'épisode TMDB, en parallèle de l'extraction : la
        // carte « Reprendre la lecture » montre l'épisode, pas l'affiche de la série.
        setTmdbEpisode(null);
        const tmdbPosition = tmdbPositionOf(data, found, entry, index);
        setSegmentEpisode(
          tmdbPosition
            ? { tvShowId: String(id), seasonNumber: tmdbPosition.season, episodeNumber: tmdbPosition.episode }
            : null,
        );
        // Un épisode, une seule progression : celle du même épisode lu par le
        // chemin TMDB rejoint la clé Anime-Sama avant que le lecteur ne la lise.
        if (tmdbPosition) {
          mergeEpisodeProgress(
            `progress_tv_${id}_s${tmdbPosition.season}_e${tmdbPosition.episode}`,
            animeSamaProgressKey(id, entry + 1, index + 1),
          );
        }
        void tmdbEpisodeOf(data, tmdbPosition, controller.signal).then(info => {
          if (!controller.signal.aborted) setTmdbEpisode(info);
        });

        const players = animeSamaEpisodePlayers(found, entry, index);
        const mp4 = players
          .filter(player => ANIME_SAMA_FILE.test(player.url))
          .map(player => {
            const language = animeSamaLanguageLabel(player.language);
            return { url: player.url, label: `Anime-Sama ${language}`, language };
          });
        const embeds = players.filter(player => !ANIME_SAMA_FILE.test(player.url));
        const pass = embeds.length
          ? await runExtractionPass(
              embeds.map(player => ({ url: player.url, language: animeSamaLanguageLabel(player.language) })),
              import.meta.env.VITE_MAIN_API,
              { origin: 'anime-sama', context: { category: 'anime', topLevel: 'custom' } },
            )
          : { hls: [], file: [] };
        if (controller.signal.aborted) return;
        const result: Playback = {
          hls: pass.hls as SeekStreamingHlsSource[],
          files: pass.file.map(file => ({ url: file.url, label: file.label })),
          mp4,
        };
        setPlayback(result);
        setStatus(result.hls.length + result.files.length + result.mp4.length > 0 ? 'ready' : 'no-source');
      } catch {
        if (!controller.signal.aborted) setStatus('absent');
      }
    })();
    return () => controller.abort();
  }, [id, entry, index]);

  const entryName = anime?.seasons?.[entry]?.name ?? `Saison ${entry + 1}`;
  const episodeLabel = `${entryName} · Épisode ${index + 1}`;
  const next = useMemo(() => (anime ? nextAnimeSamaPosition(anime, entry, index) : null), [anime, entry, index]);
  const src = selectedSrc || playback.hls[0]?.url || playback.files[0]?.url || playback.mp4[0]?.url || '';
  activeSrcRef.current = src;

  // Le lecteur ne change pas de source lui-même : son menu (et son repli
  // automatique quand une source échoue) annonce le choix par l'événement
  // `sourceChange`, que la page applique, comme le fait `WatchTv`. Sans ce
  // relais, choisir « Vidmoly VOSTFR » ne faisait rien (15/10/2026).
  useEffect(() => {
    setSelectedSrc('');
  }, [playback]);
  useEffect(() => {
    const onSourceChange = (event: Event) => {
      const { type, url, origin, fromSrc } = ((event as CustomEvent).detail ?? {}) as {
        type?: string;
        url?: string;
        origin?: string;
        fromSrc?: string;
      };
      if (typeof url !== 'string' || !url) return;
      // Un repli automatique tardif, venu d'une source déjà quittée, ne défait pas un choix.
      const automatic = typeof origin === 'string' && origin.includes('auto-fallback');
      if (automatic && fromSrc && fromSrc !== activeSrcRef.current) return;
      const available =
        type === 'nexus_hls'
          ? playback.hls.map(source => source.url)
          : type === 'nexus_file'
            ? playback.files.map(source => source.url)
            : type === 'mp4'
              ? playback.mp4.map(source => source.url)
              : [];
      if (available.includes(url)) setSelectedSrc(url);
    };
    window.addEventListener('sourceChange', onSourceChange);
    return () => window.removeEventListener('sourceChange', onSourceChange);
  }, [playback]);
  const backdrop = show?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined;

  // HLSPlayer rend les numéros reçus de `onNextEpisode` : ici, entrée et épisode Anime-Sama en base 1.
  const goTo = (nextEntry: number, nextEpisode: number) => {
    navigate(`/watch/anime/${encodeId(String(id))}/${nextEntry}/${nextEpisode}`, { replace: true });
  };

  if (status !== 'ready') {
    const message =
      status === 'loading'
        ? 'Recherche des sources sur Anime-Sama…'
        : status === 'no-source'
          ? 'Aucun lecteur de cet épisode ne fonctionne sur ce téléviseur. Essayez une autre langue ou un autre épisode depuis la fiche.'
          : 'Cet épisode est introuvable sur Anime-Sama.';
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black px-[10%] text-center text-white">
        <div>
          <p className="text-[22px] font-semibold">{show?.name ?? 'Anime-Sama'}</p>
          {anime && <p className="mt-2 text-[15px] text-white/60">{episodeLabel}</p>}
          <p className="mt-6 text-[17px] text-white/80">{message}</p>
          {status !== 'loading' && <p className="mt-3 text-[14px] text-white/45">Retour : revenir à la fiche.</p>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(var(--vh, 1vh) * 100)' }} className="fixed inset-0 w-full overflow-hidden bg-black text-white">
      <HLSPlayer
        // La source fait partie de la clé : le lecteur repart sur le nouveau flux,
        // et reprend à la position enregistrée.
        key={`${id}-${entry}-${index}-${src}`}
        priorityCategory="anime"
        fullscreenTarget="page"
        src={src}
        poster={backdrop}
        backdrop={backdrop}
        className="h-full w-full"
        autoPlay={true}
        controls={true}
        progressKey={animeSamaProgressKey(id, entry + 1, index + 1)}
        segmentEpisode={segmentEpisode}
        nexusHlsSources={playback.hls}
        nexusFileSources={playback.files}
        mp4Sources={playback.mp4}
        showTitle={show?.name}
        tvShow={show?.name ? { name: show.name, backdrop_path: show.backdrop_path ?? undefined } : null}
        currentEpisodeInfo={{
          id: index + 1,
          name: episodeLabel,
          episode_number: index + 1,
          still_path: tmdbEpisode?.still_path ?? null,
          overview: tmdbEpisode?.overview,
        }}
        nextEpisode={
          next && anime
            ? {
                seasonNumber: next.entry + 1,
                episodeNumber: next.index + 1,
                name: `${anime.seasons?.[next.entry]?.name ?? ''} · Épisode ${next.index + 1}`,
              }
            : null
        }
        onNextEpisode={goTo}
      />
    </div>
  );
};

export default WatchAnimeSama;

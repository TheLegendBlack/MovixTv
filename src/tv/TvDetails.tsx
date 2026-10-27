import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { encodeId } from '@/utils/idEncoder';
import { useTvFocusContext } from './nav/focusContext';
import { pushBackHandler } from './nav/tvBackStack';
import { TvRow } from './components/TvRow';
import { TvCard } from './components/TvCard';
import { TvDetailsHero, type HeroAction } from './details/TvDetailsHero';
import { TvDetailsTabs, type TvTab } from './details/TvDetailsTabs';
import { TvSeasonRail } from './details/TvSeasonRail';
import { TvEpisodeList, type EpisodeStatus } from './details/TvEpisodeList';
import { TvDetailsPanel } from './details/TvDetailsPanel';
import { isInWatchlist, toggleWatchlist } from './data/watchlist';
import {
  episodeKey,
  formatRemaining,
  readEpisodeProgress,
  readSeriesResume,
  readWatchedEpisodes,
  resolveMovieAction,
  resolveSeriesAction,
  finishedRatio,
  type MovieAction,
  type SeriesAction,
  type WatchProgress,
} from './data/watchProgress';
import {
  fetchMediaDetails,
  fetchSeasonEpisodes,
  type TvEpisode,
  type TvMediaDetails,
  type TvMediaType,
} from './data/tmdbDetails';
import {
  animeSamaEpisodeLanguages,
  animeSamaProgressKey,
  animeSamaPositionOf,
  isAnimeShow,
  loadAnimeSamaAnime,
  nextAnimeSamaPosition,
  type AnimeSamaAnime,
  type TmdbShowForAnime,
} from '@/utils/animeSamaSource';
import { isAnimeSamaMode, setAnimeSamaMode } from './data/animeSamaMode';
import { isMainEntry, locateTmdbEpisode } from '@/utils/animeSamaMapping';

/**
 * Fiche d'un film ou d'une série.
 *
 * ## Deux états, pas un défilement
 *
 * La page tient dans un écran et ne défile jamais. L'accueil montre le hero
 * avec la barre d'onglets posée en bas ; entrer dans un onglet fait glisser le
 * bloc onglets + contenu vers le haut et efface le hero. C'est ce que font les
 * captures Disney+ : le logo de la série passe en bandeau réduit, il ne remonte
 * pas hors champ.
 *
 * Ce n'est pas qu'une question d'allure. `TvFocusProvider` appelle
 * `scrollIntoView({ block: 'center' })` à chaque déplacement du focus ; si le
 * document défilait, chaque descente recentrerait la cible au milieu de l'écran
 * et le hero remonterait par à-coups. Une page qui ne défile pas rend cet appel
 * inoffensif, et le glissement se fait au `transform`, que le compositeur du
 * téléviseur traite sans recalcul de mise en page.
 *
 * ## L'état vient du focus
 *
 * On ne tient pas de drapeau « je suis dans un onglet » : il se déduit de la
 * portée focalisée. Un drapeau se serait désynchronisé au premier chemin
 * imprévu — retour arrière, clic souris, remontée par Haut.
 *
 * ## Gabarit
 *
 * Toutes les constantes ci-dessous sont en pixels CSS sur le gabarit du
 * téléviseur de référence : 960×540, densité 2. C'est la seule échelle où les
 * mesures de Disney+ se transposent — un bouton de salon occupe environ 5 % de
 * la hauteur d'écran, soit 28 px ici et non 60.
 */

/** Hauteur de référence. Les blocs se placent en proportion, pas en dur. */
const SCREEN_HEIGHT = 540;
/** Ligne des onglets à l'accueil : assez bas pour laisser voir le contenu dessous. */
const TABS_TOP_HERO = 452;
/** Ligne des onglets une fois entré : juste sous le bandeau réduit. */
const TABS_TOP_CONTENT = 96;
const TABS_SHIFT = TABS_TOP_HERO - TABS_TOP_CONTENT;
/** Hauteur de la barre d'onglets, marge comprise. */
const TABS_HEIGHT = 48;
const CONTENT_TOP = TABS_TOP_CONTENT + TABS_HEIGHT;
const CONTENT_HEIGHT = SCREEN_HEIGHT - CONTENT_TOP - 20;
/** Le hero s'ancre juste au-dessus des onglets. */
const HERO_BOTTOM = SCREEN_HEIGHT - TABS_TOP_HERO + 20;

const SCOPE_ACTIONS = 'fiche-actions';
const SCOPE_TABS = 'fiche-onglets';
const SCOPE_SEASONS = 'fiche-saisons';
const SCOPE_SUGGESTIONS = 'fiche-suggestions';
const episodesScope = (season: number | null) => `fiche-episodes-s${season ?? 0}`;
const SCOPE_AS_SEASONS = 'fiche-as-saisons';
const animeSamaEpisodesScope = (entry: number) => `fiche-as-episodes-e${entry}`;

/** Les portées qui replient le hero quand le focus y entre. */
const isContentScope = (scopeId: string): boolean =>
  scopeId === SCOPE_SEASONS ||
  scopeId === SCOPE_AS_SEASONS ||
  scopeId === SCOPE_SUGGESTIONS ||
  scopeId.startsWith('fiche-episodes-') ||
  scopeId.startsWith('fiche-as-episodes-');

/** De quoi reconnaître un animé et le chercher sur Anime-Sama, depuis la fiche. */
const animeShowOf = (details: TvMediaDetails): TmdbShowForAnime => ({
  id: details.id,
  name: details.title,
  original_name: details.originalTitle ?? undefined,
  original_language: details.originalLanguage ?? undefined,
  origin_country: details.originCountry,
  genres: details.genreIds.map(genreId => ({ id: genreId })),
});

/** Progression d'un épisode lu dans le découpage Anime-Sama (entrée et épisode en base 1). */
function readAnimeSamaProgress(tmdbId: string, entry: number, episode: number): number | null {
  try {
    const raw = localStorage.getItem(animeSamaProgressKey(tmdbId, entry, episode));
    if (!raw) return null;
    const { position, duration } = JSON.parse(raw) as { position?: number; duration?: number };
    return position && duration ? Math.min(1, position / duration) : null;
  } catch {
    return null;
  }
}

/** Dernier épisode regardé dans le découpage Anime-Sama (entrée et épisode en base 1), ou `null`. */
function lastAnimeSamaEpisode(tmdbId: string): { entry: number; episode: number; progress: WatchProgress } | null {
  let best: { entry: number; episode: number; progress: WatchProgress } | null = null;
  try {
    const pattern = new RegExp(`^progress_as_${tmdbId}_(\\d+)_(\\d+)$`);
    for (let index = 0; index < localStorage.length; index += 1) {
      const match = pattern.exec(localStorage.key(index) ?? '');
      if (!match) continue;
      const data = JSON.parse(localStorage.getItem(match[0]) ?? '{}') as { position?: number; duration?: number; timestamp?: string };
      const position = Number(data.position) || 0;
      const duration = Number(data.duration) || 0;
      if (position <= 0 || duration <= 0) continue;
      const timestamp = Date.parse(data.timestamp ?? '') || 0;
      if (!best || timestamp > best.progress.timestamp) {
        best = {
          entry: Number(match[1]),
          episode: Number(match[2]),
          progress: { position, duration, timestamp, ratio: Math.min(position / duration, 1) },
        };
      }
    }
  } catch {
    return null;
  }
  return best;
}

/**
 * « Depuis le début » : oublie la position d'un épisode avant de l'ouvrir.
 * Le lecteur reprend toujours à la position enregistrée, et un paramètre
 * d'adresse (`?t=0`, que les films passaient) n'était lu par aucune page :
 * le bouton reprenait la lecture (15/10/2026). Une fois la lecture repartie,
 * la nouvelle position s'enregistre comme d'habitude.
 */
function forgetProgress(...keys: string[]): void {
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* stockage fermé : le lecteur reprendra, rien de pire */
  }
}

/** Dernière entrée Anime-Sama regardée de cette série, ou `null`. */
function lastAnimeSamaEntry(tmdbId: string): number | null {
  let best: { entry: number; time: number } | null = null;
  try {
    const prefix = `progress_as_${tmdbId}_`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const entry = Number(key.slice(prefix.length).split('_')[0]);
      const time = Date.parse((JSON.parse(localStorage.getItem(key) ?? '{}') as { timestamp?: string }).timestamp ?? '') || 0;
      if (Number.isInteger(entry) && (!best || time > best.time)) best = { entry, time };
    }
  } catch {
    return null;
  }
  return best?.entry ?? null;
}

/**
 * Bande-annonce : récupérée, pas encore jouable.
 *
 * TMDB ne stocke que des clés YouTube, et `HLSPlayer` lit du HLS et du MP4.
 * Tant qu'il n'existe pas de route capable de jouer une clé, le bouton reste
 * absent — Disney+ n'affiche jamais une action inerte. Passer cette constante à
 * `true` suffira à le faire apparaître le jour où la route existe.
 */
const TRAILERS_PLAYABLE = false;

const TvDetails: React.FC = () => {
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { focused, focus } = useTvFocusContext();

  const [details, setDetails] = useState<TvMediaDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<TvEpisode[]>([]);
  const [activeTab, setActiveTab] = useState<string>('episodes');
  const [inList, setInList] = useState(false);
  /** L'œuvre sur Anime-Sama, pour l'onglet de son découpage ; `null` tant qu'elle n'est pas trouvée. */
  const [animeSama, setAnimeSama] = useState<AnimeSamaAnime | null>(null);
  const [animeSamaEntry, setAnimeSamaEntry] = useState(1);
  /** Épisodes TMDB par saison, pour illustrer l'onglet Anime-Sama : mêmes épisodes, autre découpage. */
  const [animeSamaTmdb, setAnimeSamaTmdb] = useState<Record<number, TvEpisode[]>>({});
  const initialFocusDone = useRef(false);
  /** Miroir de l'index de l'onglet actif, lu par le gestionnaire de Retour. */
  const activeTabIndex = useRef(0);

  const type: TvMediaType | null =
    mediaType === 'movie' || mediaType === 'tv' ? mediaType : null;

  useEffect(() => {
    if (!type || !id) return;
    const controller = new AbortController();
    let cancelled = false;

    setDetails(null);
    setFailed(false);
    initialFocusDone.current = false;
    fetchMediaDetails(type, id, controller.signal)
      .then(data => {
        if (cancelled) return;
        setDetails(data);
        setInList(isInWatchlist(data.id, type));
        setActiveTab(type === 'tv' && data.seasons.length > 0 ? 'episodes' : 'suggestions');
        // On ouvre sur la saison en cours et non sur la première : c'est celle
        // que l'utilisateur veut voir s'il revient au milieu d'une série.
        const resume = type === 'tv' ? resolveSeriesAction(id, data.seasons) : null;
        setSeason(resume?.season ?? data.seasons[0]?.seasonNumber ?? null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [type, id]);

  useEffect(() => {
    if (!id || type !== 'tv' || season === null) return;
    const controller = new AbortController();
    let cancelled = false;

    setEpisodes([]);
    fetchSeasonEpisodes(id, season, controller.signal)
      .then(list => {
        if (!cancelled) setEpisodes(list);
      })
      .catch(() => {
        if (!cancelled) setEpisodes([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, type, season]);

  // Animé : l'onglet Anime-Sama apparaît dès que l'œuvre est trouvée, sans
  // retarder la fiche. Elle rouvre dessus si c'est le découpage regardé en
  // dernier.
  useEffect(() => {
    setAnimeSama(null);
    if (!details || details.mediaType !== 'tv' || !id) return;
    const show = animeShowOf(details);
    if (!isAnimeShow(show)) return;
    const controller = new AbortController();
    loadAnimeSamaAnime(show, controller.signal)
      .then(anime => {
        if (controller.signal.aborted || !anime?.seasons?.length) return;
        setAnimeSama(anime);
        const last = lastAnimeSamaEntry(id);
        setAnimeSamaEntry(last && last <= anime.seasons.length ? last : 1);
        if (isAnimeSamaMode(details.id)) setActiveTab(current => (current === 'episodes' ? 'animesama' : current));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [details, id]);

  /**
   * Épisode TMDB de chaque épisode de l'entrée Anime-Sama affichée : l'onglet
   * lui emprunte image, titre et résumé. Seulement pour la suite principale
   * et les saisons dont la correspondance est sûre ; un film ou un OAV garde
   * son simple numéro.
   */
  const animeSamaTmdbPositions = useMemo(() => {
    const entries = animeSama?.seasons ?? [];
    const current = entries[animeSamaEntry - 1];
    if (!details || !current || !isMainEntry({ name: current.name, episodes: 0 })) return [];
    const main = entries.filter(entry => isMainEntry({ name: entry.name, episodes: 0 }));
    const mainIndex = main.indexOf(current);
    const tmdbSeasons = details.seasons
      .filter(entry => entry.seasonNumber > 0)
      .map(entry => [entry.seasonNumber, entry.episodeCount] as [number, number]);
    const mainCounts = main.map(entry => entry.episodes?.length ?? 0);
    return (current.episodes ?? []).map((_, index) => locateTmdbEpisode(tmdbSeasons, mainCounts, mainIndex, index));
  }, [animeSama, animeSamaEntry, details]);

  // Les saisons TMDB que couvre l'entrée affichée, chargées une fois chacune.
  useEffect(() => {
    if (!id || activeTab !== 'animesama') return;
    const needed = [...new Set(animeSamaTmdbPositions.flatMap(position => (position ? [position.season] : [])))].filter(
      seasonNumber => !(seasonNumber in animeSamaTmdb),
    );
    if (needed.length === 0) return;
    const controller = new AbortController();
    Promise.all(
      needed.map(seasonNumber =>
        fetchSeasonEpisodes(id, seasonNumber, controller.signal)
          .then(list => [seasonNumber, list] as const)
          .catch(() => [seasonNumber, [] as TvEpisode[]] as const),
      ),
    ).then(loaded => {
      if (!controller.signal.aborted) setAnimeSamaTmdb(current => ({ ...current, ...Object.fromEntries(loaded) }));
    });
    return () => controller.abort();
  }, [id, activeTab, animeSamaTmdbPositions, animeSamaTmdb]);

  /**
   * Progression, lue une fois par montage.
   *
   * La page se remonte au retour du lecteur, donc la valeur ne peut pas être
   * périmée à l'écran. La relire à chaque rendu ferait un balayage complet de
   * `localStorage` à chaque déplacement du focus.
   */
  const action = useMemo<SeriesAction | MovieAction | null>(() => {
    if (!id || !details) return null;
    return details.mediaType === 'tv'
      ? resolveSeriesAction(id, details.seasons)
      : resolveMovieAction(id);
  }, [id, details]);

  /**
   * Reprise par le découpage Anime-Sama quand c'est par là que la série a été
   * regardée en dernier (15/10/2026) : sinon « Reprendre » repartait par le
   * chemin TMDB et créait une seconde progression du même épisode.
   */
  const animeSamaLast = useMemo(() => {
    if (!id || !details || details.mediaType !== 'tv') return null;
    const last = lastAnimeSamaEpisode(id);
    const tmdb = readSeriesResume(id);
    return last && (!tmdb || last.progress.timestamp > tmdb.progress.timestamp) ? last : null;
  }, [id, details]);

  const watchedEpisodes = useMemo(
    () => (id && type === 'tv' ? readWatchedEpisodes(id) : new Set<string>()),
    [id, type],
  );

  const inContent = focused ? isContentScope(focused.scopeId) : false;

  // Retour : on remonte d'abord aux onglets, et seulement ensuite on quitte la
  // fiche. Sans cet étage, un utilisateur descendu à l'épisode 9 sortirait de
  // la série d'un seul appui.
  useEffect(() => {
    return pushBackHandler(() => {
      if (!inContent) return false;
      focus({ scopeId: SCOPE_TABS, index: activeTabIndex.current });
      return true;
    });
  }, [inContent, focus]);

  // Le focus part sur l'action principale, comme à l'ouverture d'une fiche
  // Disney+. `applyFocus` sait attendre que le bouton soit monté.
  useEffect(() => {
    if (!details || initialFocusDone.current) return;
    initialFocusDone.current = true;
    focus({ scopeId: SCOPE_ACTIONS, index: 0 });
  }, [details, focus]);

  if (!type || !id) return <TvMessage>Contenu introuvable.</TvMessage>;
  if (failed) return <TvMessage>Cette fiche n'a pas pu être chargée.</TvMessage>;
  if (!details) return <TvMessage>Chargement…</TvMessage>;

  const playEpisodeAt = (seasonNumber: number, episodeNumber: number) => {
    // La fiche rouvrira sur la numérotation regardée en dernier.
    setAnimeSamaMode(details.id, false);
    navigate(`/watch/tv/${encodeId(id)}/s/${seasonNumber}/e/${episodeNumber}`);
  };
  const playAnimeSamaAt = (entry: number, episode: number) => {
    setAnimeSamaMode(details.id, true);
    navigate(`/watch/anime/${encodeId(id)}/${entry}/${episode}`);
  };
  const playMovie = (fromStart = false) =>
    navigate(`/watch/movie/${encodeId(id)}${fromStart ? '?t=0' : ''}`);

  /**
   * Fiche d'une suggestion.
   *
   * La route de la fiche n'est pas connue de ce composant, et la coder en dur
   * la ferait diverger du routeur au premier changement. On remplace la queue
   * `/<type>/<id>` de l'URL courante, ce qui marche quel que soit le préfixe.
   */
  const openDetails = (nextType: TvMediaType, nextId: number) => {
    const next = location.pathname.replace(
      new RegExp(`/${mediaType}/${id}/?$`),
      `/${nextType}/${nextId}`,
    );
    // Repli aligné sur `TvApp` : la fiche est montée sur `/tvapp/:mediaType/:id`,
    // sans segment intermédiaire.
    navigate(next === location.pathname ? `/tvapp/${nextType}/${nextId}` : next);
  };

  const meta =
    details.mediaType === 'tv'
      ? [
          details.years,
          `${details.seasonCount} saison${details.seasonCount > 1 ? 's' : ''}`,
          details.genres.slice(0, 2).join(', '),
        ]
          .filter(Boolean)
          .join('  ·  ')
      : [details.year, details.runtime, details.genres.slice(0, 2).join(', ')]
          .filter(Boolean)
          .join('  ·  ');

  const animeSamaTarget = (() => {
    if (!animeSamaLast) return null;
    const finished = animeSamaLast.progress.ratio >= finishedRatio();
    if (!finished) return { entry: animeSamaLast.entry, episode: animeSamaLast.episode, progress: animeSamaLast.progress };
    // Épisode terminé : le suivant, qu'il faut l'œuvre chargée pour connaître.
    const next = animeSama ? nextAnimeSamaPosition(animeSama, animeSamaLast.entry - 1, animeSamaLast.episode - 1) : null;
    return next ? { entry: next.entry + 1, episode: next.index + 1, progress: null } : null;
  })();
  /** Épisode TMDB du même épisode Anime-Sama (entrée et épisode en base 1), si la correspondance est sûre. */
  const animeSamaTmdbTwin = (entry: number, episode: number) => {
    const entries = animeSama?.seasons ?? [];
    const current = entries[entry - 1];
    if (!current || !isMainEntry({ name: current.name, episodes: 0 })) return null;
    const main = entries.filter(item => isMainEntry({ name: item.name, episodes: 0 }));
    return locateTmdbEpisode(
      details.seasons
        .filter(item => item.seasonNumber > 0)
        .map(item => [item.seasonNumber, item.episodeCount] as [number, number]),
      main.map(item => item.episodes?.length ?? 0),
      main.indexOf(current),
      episode - 1,
    );
  };

  const hero = buildHero({
    details,
    action,
    episodes,
    season,
    inList,
    animeSama: animeSamaTarget
      ? {
          contextLabel: `Anime-Sama · ${animeSama?.seasons?.[animeSamaTarget.entry - 1]?.name ?? `Saison ${animeSamaTarget.entry}`} · Épisode ${animeSamaTarget.episode}`,
          progress: animeSamaTarget.progress,
        }
      : null,
    onPlay: () => {
      if (animeSamaTarget) {
        playAnimeSamaAt(animeSamaTarget.entry, animeSamaTarget.episode);
        return;
      }
      if (!action) return;
      if (details.mediaType === 'movie') {
        playMovie(action.kind === 'replay');
        return;
      }
      const target = action as SeriesAction;
      playEpisodeAt(target.season, target.episode);
    },
    // « Depuis le début » reprend l'épisode affiché à côté de « Reprendre »
    // depuis zéro, comme Disney+. Sa copie dans l'autre numérotation part
    // aussi : le lecteur l'aurait refondue dans la sienne, et donc reprise.
    onRestart: () => {
      if (details.mediaType === 'movie') {
        forgetProgress(`progress_${id}`);
        playMovie(true);
        return;
      }
      if (animeSamaTarget) {
        const tmdbTwin = animeSamaTmdbTwin(animeSamaTarget.entry, animeSamaTarget.episode);
        forgetProgress(
          animeSamaProgressKey(id, animeSamaTarget.entry, animeSamaTarget.episode),
          ...(tmdbTwin ? [`progress_tv_${id}_s${tmdbTwin.season}_e${tmdbTwin.episode}`] : []),
        );
        playAnimeSamaAt(animeSamaTarget.entry, animeSamaTarget.episode);
        return;
      }
      const series = action as SeriesAction | null;
      const target =
        series && series.kind !== 'start'
          ? { season: series.season, episode: series.episode }
          : details.seasons[0]
            ? { season: details.seasons[0].seasonNumber, episode: 1 }
            : null;
      if (!target) return;
      const asTwin = animeSama
        ? animeSamaPositionOf(
            animeSama,
            {
              ...animeShowOf(details),
              seasons: details.seasons.map(entry => ({ season_number: entry.seasonNumber, episode_count: entry.episodeCount })),
            },
            target.season,
            target.episode,
          )
        : null;
      forgetProgress(
        `progress_tv_${id}_s${target.season}_e${target.episode}`,
        ...(asTwin ? [animeSamaProgressKey(id, asTwin.entry + 1, asTwin.index + 1)] : []),
      );
      playEpisodeAt(target.season, target.episode);
    },
    onToggleList: () =>
      setInList(
        toggleWatchlist({
          id: details.id,
          type: details.mediaType,
          title: details.title,
          posterPath: details.posterPath,
        }),
      ),
  });

  const tabs: TvTab[] = [
    ...(details.mediaType === 'tv' && details.seasons.length > 0
      ? [{ id: 'episodes', label: 'Épisodes' }]
      : []),
    // Le même animé dans le découpage d'Anime-Sama (films, OAV compris), avec ses seules sources.
    ...(animeSama ? [{ id: 'animesama', label: 'Anime-Sama' }] : []),
    ...(details.suggestions.length > 0 ? [{ id: 'suggestions', label: 'Suggestions' }] : []),
    { id: 'details', label: 'Détails' },
  ];

  activeTabIndex.current = Math.max(
    tabs.findIndex(tab => tab.id === activeTab),
    0,
  );

  const statusOf = (episode: TvEpisode): EpisodeStatus => {
    const progress = readEpisodeProgress(id, season ?? 0, episode.episodeNumber);
    const marked = watchedEpisodes.has(episodeKey(season ?? 0, episode.episodeNumber));
    return {
      ratio: progress ? progress.ratio : null,
      watched: marked || (progress !== null && progress.ratio >= finishedRatio()),
    };
  };

  return (
    <div className="relative h-[var(--tv-screen-height,100vh)] overflow-hidden">
      {details.backdropUrl && (
        <div className="pointer-events-none absolute inset-0">
          <img src={details.backdropUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-movix-ink via-movix-ink/85 to-movix-ink/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-movix-ink to-transparent" />
          {/* Une fois dans un onglet, l'illustration s'efface derrière le
              contenu : c'est ce que montre la capture Disney+ de l'onglet
              Épisodes, où le fond est presque noir. */}
          <div
            className={
              'absolute inset-0 bg-movix-ink transition-opacity duration-200 ' +
              (inContent ? 'opacity-80' : 'opacity-0')
            }
          />
        </div>
      )}

      {/* Bandeau réduit : prend le relais du logo quand le hero s'efface. */}
      <div
        className={
          'absolute left-[6%] top-[24px] transition-opacity duration-200 ' +
          (inContent ? 'opacity-100' : 'opacity-0')
        }>
        {details.logoUrl ? (
          <img src={details.logoUrl} alt={details.title} className="max-h-[34px] object-contain" />
        ) : (
          <p className="text-[18px] font-bold">{details.title}</p>
        )}
      </div>

      <TvDetailsHero
        scopeId={SCOPE_ACTIONS}
        bottom={HERO_BOTTOM}
        logoUrl={details.logoUrl}
        title={details.title}
        badges={hero.badges}
        meta={meta}
        contextLabel={hero.contextLabel}
        description={hero.description}
        progressRatio={hero.progressRatio}
        remainingLabel={hero.remainingLabel}
        actions={hero.actions}
        collapsed={inContent}
      />

      <div
        className="absolute inset-x-[6%] transition-transform duration-300 ease-out"
        style={{
          top: TABS_TOP_HERO,
          transform: `translateY(${inContent ? -TABS_SHIFT : 0}px)`,
        }}>
        <TvDetailsTabs
          scopeId={SCOPE_TABS}
          tabs={tabs}
          activeId={activeTab}
          onSelect={setActiveTab}
        />

        <div className="mt-[16px]">
          {activeTab === 'episodes' && (
            <div className="flex gap-[20px]">
              <TvSeasonRail
                scopeId={SCOPE_SEASONS}
                episodesScopeId={episodesScope(season)}
                tabsScopeId={SCOPE_TABS}
                seasons={details.seasons}
                selected={season}
                onSelect={setSeason}
              />
              <TvEpisodeList
                // L'identifiant inclut la saison : chaque saison devient une
                // portée distincte, avec sa propre mémoire de position. Sans ça,
                // passer de la saison 1 à la 2 en étant sur l'épisode 5
                // atterrissait sur l'épisode 5 de la saison 2.
                scopeId={episodesScope(season)}
                seasonScopeId={SCOPE_SEASONS}
                tabsScopeId={SCOPE_TABS}
                episodes={episodes}
                height={CONTENT_HEIGHT}
                statusOf={statusOf}
                onSelect={episode => playEpisodeAt(season ?? 1, episode.episodeNumber)}
              />
            </div>
          )}

          {activeTab === 'animesama' && animeSama && (
            <div className="flex gap-[20px]">
              <TvSeasonRail
                scopeId={SCOPE_AS_SEASONS}
                episodesScopeId={animeSamaEpisodesScope(animeSamaEntry)}
                tabsScopeId={SCOPE_TABS}
                seasons={(animeSama.seasons ?? []).map((entry, index) => ({
                  seasonNumber: index + 1,
                  name: entry.name || `Saison ${index + 1}`,
                  episodeCount: entry.episodes?.length ?? 0,
                }))}
                selected={animeSamaEntry}
                onSelect={setAnimeSamaEntry}
              />
              <TvEpisodeList
                scopeId={animeSamaEpisodesScope(animeSamaEntry)}
                seasonScopeId={SCOPE_AS_SEASONS}
                tabsScopeId={SCOPE_TABS}
                episodes={(animeSama.seasons?.[animeSamaEntry - 1]?.episodes ?? []).map((_, index) => {
                  const position = animeSamaTmdbPositions[index];
                  const tmdb = position
                    ? animeSamaTmdb[position.season]?.find(entry => entry.episodeNumber === position.episode)
                    : undefined;
                  const languages = animeSamaEpisodeLanguages(animeSama, animeSamaEntry - 1, index).join(' · ');
                  return {
                    episodeNumber: index + 1,
                    name: tmdb?.name || `Épisode ${index + 1}`,
                    // Les langues d'abord : c'est ce qui distingue les sources de cet onglet.
                    overview: tmdb?.overview ? `${languages} — ${tmdb.overview}` : languages,
                    stillUrl: tmdb?.stillUrl ?? null,
                    runtime: tmdb?.runtime ?? null,
                    airDate: tmdb?.airDate ?? null,
                  };
                })}
                height={CONTENT_HEIGHT}
                statusOf={episode => {
                  const ratio = readAnimeSamaProgress(id, animeSamaEntry, episode.episodeNumber);
                  return { ratio, watched: ratio !== null && ratio >= finishedRatio() };
                }}
                onSelect={episode => playAnimeSamaAt(animeSamaEntry, episode.episodeNumber)}
              />
            </div>
          )}

          {activeTab === 'suggestions' && (
            <TvRow
              id={SCOPE_SUGGESTIONS}
              title="Vous aimerez aussi"
              items={details.suggestions}
              onSelect={item => openDetails(item.mediaType, item.id)}
              renderItem={(item, state) => (
                <TvCard title={item.title} imageUrl={item.posterUrl} focused={state.focused} />
              )}
            />
          )}

          {activeTab === 'details' && (
            <TvDetailsPanel details={details} height={CONTENT_HEIGHT} />
          )}
        </div>
      </div>
    </div>
  );
};

interface HeroModel {
  badges: string[];
  contextLabel: string | null;
  description: string;
  progressRatio: number | null;
  remainingLabel: string | null;
  actions: HeroAction[];
}

/**
 * Traduit l'état de lecture en contenu de hero.
 *
 * Toute la matrice tient ici : trois états de lecture croisés avec deux types
 * d'œuvre. La garder hors du JSX est ce qui permet de la relire d'un coup
 * d'œil — et de constater qu'aucun bouton n'est jamais rendu inerte, ce qui est
 * la règle qu'applique Disney+.
 */
function buildHero(input: {
  details: TvMediaDetails;
  action: SeriesAction | MovieAction | null;
  episodes: TvEpisode[];
  season: number | null;
  inList: boolean;
  /** Reprise par le découpage Anime-Sama : prime sur l'action TMDB. */
  animeSama: { contextLabel: string; progress: WatchProgress | null } | null;
  onPlay: () => void;
  onRestart: () => void;
  onToggleList: () => void;
}): HeroModel {
  const { details, action, episodes, season, inList, animeSama, onPlay, onRestart, onToggleList } = input;
  const badges = [details.certification].filter((value): value is string => !!value);

  const listAction: HeroAction = {
    id: 'list',
    ariaLabel: inList ? 'Retirer de ma liste' : 'Ajouter à ma liste',
    icon: inList ? 'added' : 'plus',
    onSelect: onToggleList,
  };
  const trailerAction: HeroAction[] =
    TRAILERS_PLAYABLE && details.trailerKey
      ? [{ id: 'trailer', label: 'Bande-annonce', icon: 'trailer', onSelect: () => {} }]
      : [];

  const resuming = action?.kind === 'resume';
  const progress = resuming ? action.progress : null;

  if (details.mediaType === 'movie') {
    return {
      badges,
      contextLabel: null,
      description: details.overview,
      progressRatio: progress ? progress.ratio : null,
      remainingLabel: progress ? formatRemaining(progress) : null,
      actions: [
        {
          id: 'play',
          label: resuming ? 'Reprendre' : action?.kind === 'replay' ? 'Revoir' : 'Lecture',
          icon: 'play',
          onSelect: onPlay,
        },
        ...(resuming
          ? [{ id: 'restart', label: 'Depuis le début', onSelect: onRestart } as HeroAction]
          : trailerAction),
        listAction,
      ],
    };
  }

  if (animeSama) {
    const asProgress = animeSama.progress;
    return {
      badges,
      contextLabel: animeSama.contextLabel,
      description: details.overview,
      progressRatio: asProgress ? asProgress.ratio : null,
      remainingLabel: asProgress ? formatRemaining(asProgress) : null,
      actions: [
        { id: 'play', label: asProgress ? 'Reprendre' : 'Lecture', icon: 'play', onSelect: onPlay },
        { id: 'restart', label: 'Depuis le début', onSelect: onRestart } as HeroAction,
        listAction,
      ],
    };
  }

  const series = action as SeriesAction | null;
  // Le nom de l'épisode n'est connu que si sa saison est celle qui est chargée.
  // Sinon on s'en tient au repère chiffré, qui suffit à situer.
  const named =
    series && season === series.season
      ? episodes.find(episode => episode.episodeNumber === series.episode)
      : undefined;

  const contextLabel = series
    ? `S${series.season}:E${series.episode}${named ? ` · ${named.name}` : ''}`
    : null;

  return {
    badges,
    // Jamais lancée : le synopsis de la série. En cours : celui de l'épisode,
    // avec repli sur la série quand la saison n'est pas encore chargée.
    contextLabel: series && series.kind === 'start' ? null : contextLabel,
    description:
      series && series.kind !== 'start' && named?.overview ? named.overview : details.overview,
    progressRatio: progress ? progress.ratio : null,
    remainingLabel: progress ? formatRemaining(progress) : null,
    actions: [
      {
        id: 'play',
        label: resuming ? 'Reprendre' : 'Lecture',
        icon: 'play',
        onSelect: onPlay,
      },
      ...(resuming
        ? [{ id: 'restart', label: 'Depuis le début', onSelect: onRestart } as HeroAction]
        : trailerAction),
      listAction,
    ],
  };
}

const TvMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-[6%] py-[5%] text-lg text-white/60">{children}</div>
);

export default TvDetails;

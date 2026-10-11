import type React from 'react';
import {
  Server,
  MonitorPlay,
  Volume2,
  MessageSquare,
  Gauge,
  Ratio,
  History,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import type { SettingsRowDescriptor } from './PlayerSettingsRow';
import {
  buildSourceLevel,
  summariseSource,
  type SourceProvider,
  type SourceTreeActions,
} from './playerSourceSection';
import { buildSubtitleLevel, summariseSubtitles } from './playerSubtitleSection';

/**
 * Registre des sections du panneau — piste B.
 *
 * Une section décrit deux choses :
 *  - comment elle apparaît au niveau 1 (icône, libellé, valeur courante),
 *  - comment elle se construit aux niveaux 2+ (`build`).
 *
 * Toutes les sections sont natives : aucun bloc du panneau souris n'est rendu
 * sur téléviseur. `LegacyTabId` ne désigne plus que les onglets du panneau
 * souris lui-même (cf. `useSettingsPanelTabs`), qui l'importe d'ici.
 */

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/** Onglets du panneau souris. */
export type LegacyTabId =
  | 'quality'
  | 'format'
  | 'audio'
  | 'subtitles'
  | 'style'
  | 'speed'
  | 'progression'
  | 'enhancer'
  | 'oled';

/** Les props du panneau, telles qu'elles arrivent aujourd'hui de HLSPlayer. */
export type SettingsContext = Record<string, any>;

export interface SectionLevel {
  title: string;
  rows: SettingsRowDescriptor[];
  /**
   * Appelé quand on quitte ce niveau (retour, descente, fermeture du panneau).
   * Un niveau qui prévisualise au focus s'en sert pour valider ou annuler ce
   * qui est resté en suspens.
   */
  onLeave?: () => void;
}

export interface SettingsSection {
  id: string;
  icon: IconComponent;
  /** Libellé au niveau 1. */
  label: (ctx: SettingsContext) => string;
  /** Valeur affichée à droite au niveau 1. `null` masque la valeur. */
  getValue?: (ctx: SettingsContext) => string | null;
  /** Badge court affiché avant la valeur (VF, Seek…). */
  getBadge?: (ctx: SettingsContext) => string | null;
  isVisible?: (ctx: SettingsContext) => boolean;
  tone?: 'default' | 'danger';
  /** Action immédiate au niveau 1, sans descente (réinitialiser). */
  onSelect?: (ctx: SettingsContext) => void;
  /** Construit le niveau 2 et au-delà. `subPath` est le chemin sous la section. */
  build?: (
    ctx: SettingsContext,
    subPath: readonly string[],
    nav: { push: (segment: string) => void; pop: () => void },
  ) => SectionLevel | null;
}

// ---------------------------------------------------------------------------
// Traduction tolérante
// ---------------------------------------------------------------------------

/**
 * Renvoie la traduction si la clé existe, sinon le libellé français fourni.
 * Permet de livrer la navigation avant d'avoir complété les fichiers i18n.
 */
const tr = (ctx: SettingsContext, key: string, fallback: string): string => {
  const value = ctx.t?.(key);
  return !value || value === key ? fallback : String(value);
};

const formatSpeed = (speed: number) => `${String(speed).replace('.', ',')}×`;

const ASPECT_LABELS: Record<string, [string, string]> = {
  cover: ['watch.formatFill', 'Remplir'],
  contain: ['watch.formatFit', 'Ajuster'],
  '16:9': ['', '16:9'],
  '4:3': ['', '4:3'],
  original: ['watch.originalFormat', 'Original'],
};

const OLED_MODES = ['off', 'natural', 'cinema', 'vivid'] as const;
const OLED_LABELS: Record<string, string> = {
  off: 'Désactivé',
  natural: 'Naturel',
  cinema: 'Cinéma',
  vivid: 'Éclatant',
  custom: 'Personnalisé',
};

const ENHANCER_MODES = ['off', 'cinema', 'music', 'dialogue'] as const;
const ENHANCER_LABELS: Record<string, string> = {
  off: 'Désactivé',
  cinema: 'Cinéma',
  music: 'Musique',
  dialogue: 'Dialogues',
  custom: 'Personnalisé',
};

/**
 * L'arbre des sources est produit par l'adaptateur du panneau (cf.
 * INTEGRATION.md §8). Absent → la section reste vide plutôt que de planter.
 */
const sourceProviders = (ctx: SettingsContext): SourceProvider[] =>
  Array.isArray(ctx.sourceTree) ? (ctx.sourceTree as SourceProvider[]) : [];

const sourceActions = (ctx: SettingsContext): SourceTreeActions => ({
  onRefresh: ctx.onRefreshSources,
  onProbeQuality: ctx.runHlsQualityScan,
  probing: ctx.hlsQualityScan?.status === 'running',
  onCopyActiveLink: ctx.onCopyActiveLink,
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'source',
    icon: Server,
    label: ctx => tr(ctx, 'watch.sourceTab', 'Source'),
    getValue: ctx => summariseSource(sourceProviders(ctx)).label,
    getBadge: ctx => summariseSource(sourceProviders(ctx)).badge,
    // Reprend la condition que portait l'ancienne barre d'onglets : en mode
    // animé sur un flux HLS, l'arbre des sources était masqué. Sans elle, la
    // section réapparaîtrait là où elle n'a rien à faire.
    isVisible: ctx => !(ctx.isAnime && ctx.tvShowId && String(ctx.src ?? '').includes('.m3u8')),
    build: (ctx, subPath, nav) => {
      const providers = sourceProviders(ctx);
      const actions = sourceActions(ctx);
      // Arbre vide : le catalogue n'a produit aucune source alternative pour
      // ce contenu (lecture directe d'un MP4, flux unique). On le dit plutôt
      // que d'afficher une liste vide, et on garde la relance si elle existe.
      if (providers.length === 0) {
        const rows: SettingsRowDescriptor[] = [
          { kind: 'caption', id: 'source:empty', label: tr(ctx, 'watch.noAlternativeSource', 'Aucune autre source pour ce contenu') },
        ];
        if (actions.onRefresh) {
          rows.push({
            kind: 'action',
            id: 'source:refresh',
            icon: RefreshCw,
            label: tr(ctx, 'watch.refreshSources', 'Relancer la recherche'),
            onSelect: actions.onRefresh,
          });
        }
        return { title: tr(ctx, 'watch.sourceTab', 'Source'), rows };
      }
      return buildSourceLevel(providers, actions, subPath, nav.push);
    },
  },

  {
    id: 'quality',
    icon: MonitorPlay,
    label: ctx => tr(ctx, 'watch.qualityTab', 'Qualité'),
    getValue: ctx => {
      const auto = tr(ctx, 'watch.qualityAuto', 'Auto');
      if (ctx.qualityPreference === 'auto') {
        return ctx.effectiveQualityHeight ? `${auto} · ${ctx.effectiveQualityHeight}p` : auto;
      }
      return ctx.qualityPreference ? `${ctx.qualityPreference}p` : null;
    },
    isVisible: ctx => Array.isArray(ctx.qualities) && ctx.qualities.length > 0,
    build: ctx => {
      const auto = tr(ctx, 'watch.qualityAuto', 'Auto');
      const rows: SettingsRowDescriptor[] = [
        {
          kind: 'choice',
          id: 'quality:auto',
          label: auto,
          badge: ctx.effectiveQualityHeight ? `${ctx.effectiveQualityHeight}p` : undefined,
          selected: ctx.qualityPreference === 'auto',
          onSelect: () => ctx.handleQualityPreferenceChange?.('auto'),
        },
      ];

      const heights: number[] = Array.from(
        new Set<number>(
          (ctx.qualities ?? [])
            .map((option: any) => Number(option?.height))
            .filter((height: number) => Number.isFinite(height) && height > 0),
        ),
      ).sort((a, b) => b - a);

      heights.forEach(height => {
        const option = (ctx.qualities ?? []).find((item: any) => Number(item?.height) === height);
        const bitrate = Number(option?.bitrate);
        rows.push({
          kind: 'choice',
          id: `quality:${height}`,
          label: `${height}p`,
          sublabel:
            Number.isFinite(bitrate) && bitrate > 0
              ? `${(bitrate / 1_000_000).toFixed(1).replace('.', ',')} Mb/s`
              : undefined,
          selected: ctx.qualityPreference === height,
          onSelect: () => ctx.handleQualityPreferenceChange?.(height),
        });
      });

      return { title: tr(ctx, 'watch.streamQuality', 'Qualité'), rows };
    },
  },

  {
    id: 'audio',
    icon: Volume2,
    label: ctx => tr(ctx, 'watch.audioTab', 'Audio'),
    getValue: ctx => {
      const track = (ctx.audioTracks ?? [])[ctx.currentAudioTrack];
      if (track) return ctx.getLanguageName?.(track.lang) ?? track.name ?? null;
      return ctx.audioEnhancerMode && ctx.audioEnhancerMode !== 'off'
        ? ENHANCER_LABELS[ctx.audioEnhancerMode]
        : null;
    },
    build: (ctx, subPath, nav) => {
      if (subPath[0] === 'enhancer') {
        return {
          title: tr(ctx, 'watch.audioPlusTab', 'Amélioration'),
          rows: ENHANCER_MODES.map(mode => ({
            kind: 'choice' as const,
            id: `enhancer:${mode}`,
            label: ENHANCER_LABELS[mode],
            selected: ctx.audioEnhancerMode === mode,
            onSelect: () => {
              ctx.handleAudioEnhancerChange?.(mode);
              ctx.applyAudioEnhancerPreset?.(mode);
            },
          })),
        };
      }

      const rows: SettingsRowDescriptor[] = [];
      const tracks: any[] = ctx.audioTracks ?? [];

      if (tracks.length > 0) {
        rows.push({
          kind: 'caption',
          id: 'audio:tracks',
          label: tr(ctx, 'watch.audioTrack', 'Piste'),
        });
        tracks.forEach((track, index) => {
          rows.push({
            kind: 'choice',
            id: `audio:track:${index}`,
            label: ctx.getLanguageName?.(track.lang) ?? track.name ?? `Piste ${index + 1}`,
            selected: ctx.currentAudioTrack === index,
            onSelect: () => ctx.handleAudioTrackChange?.(index),
          });
        });
        rows.push({ kind: 'separator', id: 'audio:sep' });
      }

      rows.push({
        kind: 'slider',
        id: 'audio:boost',
        label: tr(ctx, 'watch.volumeBooster', 'Amplification'),
        value: Number(ctx.volumeBoost ?? 1),
        min: 1,
        max: 3,
        step: 0.1,
        format: value => `${Math.round(value * 100)} %`,
        onChange: value => ctx.handleVolumeBoostChange?.(value),
      });

      rows.push({
        kind: 'nav',
        id: 'audio:enhancer',
        label: tr(ctx, 'watch.audioPlusTab', 'Amélioration'),
        value: ENHANCER_LABELS[ctx.audioEnhancerMode ?? 'off'],
        onSelect: () => nav.push('enhancer'),
      });

      return { title: tr(ctx, 'watch.audioTab', 'Audio'), rows };
    },
  },

  {
    id: 'subtitles',
    icon: MessageSquare,
    label: ctx => tr(ctx, 'watch.subtitlesTab', 'Sous-titres'),
    getValue: ctx => summariseSubtitles(ctx),
    build: (ctx, subPath, nav) => buildSubtitleLevel(ctx, subPath, nav),
  },

  {
    id: 'speed',
    icon: Gauge,
    label: ctx => tr(ctx, 'watch.speedTab', 'Vitesse'),
    getValue: ctx => formatSpeed(Number(ctx.playbackSpeed ?? 1)),
    build: ctx => ({
      title: tr(ctx, 'watch.speedTab', 'Vitesse'),
      rows: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => ({
        kind: 'choice' as const,
        id: `speed:${speed}`,
        label: speed === 1 ? tr(ctx, 'watch.normalSpeedLabel', 'Normale') : formatSpeed(speed),
        badge: speed === 1 ? formatSpeed(1) : undefined,
        selected: Number(ctx.playbackSpeed) === speed,
        onSelect: () => ctx.handlePlaybackSpeedChange?.(speed),
      })),
    }),
  },

  {
    id: 'image',
    icon: Ratio,
    label: ctx => tr(ctx, 'watch.formatTab', 'Image'),
    getValue: ctx => {
      const entry = ASPECT_LABELS[ctx.videoAspectRatio ?? 'contain'];
      return entry ? (entry[0] ? tr(ctx, entry[0], entry[1]) : entry[1]) : null;
    },
    build: (ctx, subPath, nav) => {
      if (subPath[0] === 'oled') {
        return {
          title: tr(ctx, 'watch.oledTab', 'Rendu OLED'),
          rows: OLED_MODES.map(mode => ({
            kind: 'choice' as const,
            id: `oled:${mode}`,
            label: OLED_LABELS[mode],
            selected: ctx.videoOledMode === mode,
            onSelect: () => ctx.handleVideoOledChange?.(mode),
          })),
        };
      }

      const rows: SettingsRowDescriptor[] = [
        { kind: 'caption', id: 'image:caption', label: tr(ctx, 'watch.formatTab', 'Format') },
      ];

      (Object.keys(ASPECT_LABELS) as Array<keyof typeof ASPECT_LABELS>).forEach(ratio => {
        const [key, fallback] = ASPECT_LABELS[ratio];
        rows.push({
          kind: 'choice',
          id: `image:${ratio}`,
          label: key ? tr(ctx, key, fallback) : fallback,
          selected: ctx.videoAspectRatio === ratio,
          onSelect: () => ctx.setVideoAspectRatio?.(ratio),
        });
      });

      rows.push({ kind: 'separator', id: 'image:sep' });

      rows.push({
        kind: 'nav',
        id: 'image:oled',
        label: tr(ctx, 'watch.oledTab', 'Rendu OLED'),
        value: OLED_LABELS[ctx.videoOledMode ?? 'off'],
        onSelect: () => nav.push('oled'),
      });

      // Noir et blanc à la pause : l'amont l'a rendu désactivable le 10/2026,
      // dans son panneau souris seulement. Il prend ici la place de
      // « Réinitialiser le zoom », que la même mise à jour a retiré du lecteur
      // (plus aucun état de zoom n'arrive dans ce contexte).
      rows.push({
        kind: 'toggle',
        id: 'image:pause-grayscale',
        label: tr(ctx, 'watch.pauseGrayscale', 'Noir et blanc à la pause'),
        checked: Boolean(ctx.pauseGrayscaleEnabled),
        onToggle: next => ctx.handlePauseGrayscaleChange?.(next),
      });

      return { title: tr(ctx, 'watch.formatTab', 'Image'), rows };
    },
  },

  {
    id: 'playback',
    icon: History,
    label: ctx => tr(ctx, 'watch.progressionTab', 'Lecture'),
    getValue: ctx => {
      if (ctx.autoNextEpisodeEnabled) return tr(ctx, 'watch.autoNextEpisode', 'Auto');
      if (ctx.saveProgressEnabled) return tr(ctx, 'watch.autoSave', 'Reprise');
      return tr(ctx, 'watch.disabled', 'Désactivée');
    },
    build: ctx => {
      const isPercentage = ctx.nextContentThresholdMode === 'percentage';
      const rows: SettingsRowDescriptor[] = [
        {
          kind: 'toggle',
          id: 'playback:save',
          label: tr(ctx, 'watch.autoSave', 'Reprendre où je me suis arrêté'),
          checked: Boolean(ctx.saveProgressEnabled),
          onToggle: next => ctx.setSaveProgressEnabled?.(next),
        },
        {
          kind: 'toggle',
          id: 'playback:autonext',
          label: tr(ctx, 'watch.autoNextEpisode', 'Épisode suivant auto'),
          checked: Boolean(ctx.autoNextEpisodeEnabled),
          onToggle: next => ctx.setAutoNextEpisodeEnabled?.(next),
        },
        { kind: 'separator', id: 'playback:sep' },
        {
          kind: 'caption',
          id: 'playback:caption',
          label: tr(ctx, 'watch.nextContentPopup', 'Annonce du contenu suivant'),
        },
        {
          kind: 'segmented',
          id: 'playback:mode',
          label: tr(ctx, 'watch.showPopup', 'Seuil'),
          value: isPercentage ? 'percentage' : 'timeBeforeEnd',
          options: [
            { id: 'percentage', label: tr(ctx, 'watch.percentage', '%') },
            { id: 'timeBeforeEnd', label: tr(ctx, 'watch.timeBeforeEnd', 'Temps') },
          ],
          onChange: mode => ctx.setNextContentThresholdMode?.(mode),
        },
        {
          kind: 'slider',
          id: 'playback:threshold',
          label: isPercentage
            ? tr(ctx, 'watch.percentage', 'Pourcentage')
            : tr(ctx, 'watch.timeBeforeEnd', 'Avant la fin'),
          value: Number(ctx.nextContentThresholdValue ?? (isPercentage ? 90 : 60)),
          min: isPercentage ? 50 : 10,
          max: isPercentage ? 99 : 300,
          step: isPercentage ? 1 : 10,
          format: value => (isPercentage ? `${Math.round(value)} %` : `${Math.round(value)} s`),
          onChange: value => ctx.setNextContentThresholdValue?.(value),
        },
      ];

      return { title: tr(ctx, 'watch.progressionTab', 'Lecture'), rows };
    },
  },

  {
    id: 'reset',
    icon: RotateCcw,
    tone: 'danger',
    label: ctx => tr(ctx, 'watch.resetProgress', 'Réinitialiser la progression'),
    isVisible: ctx => typeof ctx.resetCurrentProgress === 'function',
    onSelect: ctx => ctx.resetCurrentProgress?.(),
  },
];

export const getVisibleSections = (ctx: SettingsContext): SettingsSection[] =>
  SETTINGS_SECTIONS.filter(section => (section.isVisible ? section.isVisible(ctx) : true));

export const findSection = (id: string | null): SettingsSection | undefined =>
  id ? SETTINGS_SECTIONS.find(section => section.id === id) : undefined;

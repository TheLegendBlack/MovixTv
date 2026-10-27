import { useEffect, useState } from 'react';

/**
 * Explique les échecs de lecture propres au téléviseur.
 *
 * Deux cas mesurés sur la TV de référence produisent une panne **muette** —
 * écran noir ou image sans son — que rien n'explique à l'utilisateur :
 *
 *  - Aucun module Widevine : toute source protégée est injouable.
 *  - Pas de décodeur E-AC-3 : une piste Dolby Digital+ donne une vidéo muette.
 *
 * On ne cherche pas à les contourner, seulement à les nommer. Un message clair
 * vaut mieux qu'un écran noir : l'utilisateur sait qu'il doit changer de source.
 */

export interface TvPlaybackIssue {
  code: 'drm' | 'audio-codec' | 'decode' | 'interrupted';
  message: string;
}

interface HlsLevelLike {
  audioCodec?: string;
}

interface HlsLike {
  levels?: HlsLevelLike[];
  currentLevel?: number;
}

interface UseTvPlaybackDiagnosticOptions {
  enabled: boolean;
  videoRef: { current: HTMLVideoElement | null };
  hlsRef: { current: HlsLike | null };
}

function isCodecSupported(codec: string): boolean {
  if (typeof MediaSource === 'undefined') return true;
  try {
    return MediaSource.isTypeSupported(`audio/mp4; codecs="${codec}"`);
  } catch {
    return true;
  }
}

/** Nom lisible pour les familles de codecs que ce téléviseur refuse. */
function describeAudioCodec(codec: string): string {
  const normalized = codec.toLowerCase();
  if (normalized.startsWith('ec-3')) return 'Dolby Digital+ (E-AC-3)';
  if (normalized.startsWith('ac-3')) return 'Dolby Digital (AC-3)';
  if (normalized.startsWith('dts')) return 'DTS';
  return codec;
}

function audioCodecIssue(hls: HlsLike | null): TvPlaybackIssue | null {
  const level = hls?.levels?.[hls.currentLevel ?? -1];
  const codec = level?.audioCodec;
  if (!codec || isCodecSupported(codec)) return null;

  return {
    code: 'audio-codec',
    message:
      `Piste audio ${describeAudioCodec(codec)} non supportée par ce téléviseur. ` +
      `L'image s'affiche, mais sans le son — essaie une autre source.`,
  };
}

export function useTvPlaybackDiagnostic({
  enabled,
  videoRef,
  hlsRef,
}: UseTvPlaybackDiagnosticOptions): TvPlaybackIssue | null {
  const [issue, setIssue] = useState<TvPlaybackIssue | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIssue(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const onError = () => {
      // Erreur après plusieurs secondes de lecture : la source a été lue, ce
      // n'est donc ni un DRM ni un format inconnu, mais une coupure du flux
      // (segment manquant chez l'hébergeur, Lanterns, 17/10/2026). Le lecteur
      // tente de repartir juste après ; le message s'efface s'il y parvient.
      if (video.currentTime > 5) {
        setIssue({
          code: 'interrupted',
          message:
            'La vidéo s’est interrompue : un morceau manque chez l’hébergeur. ' +
            'Reprise juste après… Si ça recommence, change de source.',
        });
        return;
      }
      // MEDIA_ERR_SRC_NOT_SUPPORTED sur une source chiffrée : sans CDM, le
      // navigateur ne distingue pas « format inconnu » de « protégé ».
      const code = video.error?.code;
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setIssue({
          code: 'drm',
          message:
            'Source illisible sur ce téléviseur. Si elle est protégée (DRM), ' +
            'aucun module Widevine n’est disponible ici : il faut changer de source.',
        });
        return;
      }
      if (code === MediaError.MEDIA_ERR_DECODE) {
        setIssue({
          code: 'decode',
          message:
            'Le décodage a échoué : ce format dépasse les capacités du ' +
            'téléviseur. Essaie une qualité inférieure ou une autre source.',
        });
      }
    };

    // Le codec audio n'est connu qu'une fois le palier choisi : on regarde à
    // chaque changement de métadonnées plutôt qu'une seule fois au montage.
    const onMetadata = () => setIssue(current => current ?? audioCodecIssue(hlsRef.current));
    const onPlaying = () => setIssue(current => (current?.code === 'interrupted' ? null : current));

    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('canplay', onMetadata);
    video.addEventListener('playing', onPlaying);

    return () => {
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('canplay', onMetadata);
      video.removeEventListener('playing', onPlaying);
    };
  }, [enabled, videoRef, hlsRef]);

  return issue;
}

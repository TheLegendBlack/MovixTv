import { useEffect, useRef, useCallback } from 'react';
import { getResolvedUserId } from '../utils/accountAuth';

const MAIN_API = import.meta.env.VITE_MAIN_API;

// Interval for sending data (30 seconds — reduced from 10s, 3x fewer network requests)
const SEND_INTERVAL_MS = 30_000;

// Minimum accumulated seconds before worth sending
const MIN_SECONDS_TO_SEND = 5;

interface ViewingData {
    contentType: 'movie' | 'tv' | 'anime' | 'live-tv';
    contentId: string;
    contentTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
}

interface PageData {
    pageName: string;
    contentId?: string; // TMDB ID for detail pages (movie-details, tv-details)
    meta?: Record<string, unknown>;
}

type TrackerMode = 'viewing' | 'page';

interface UseWrappedTrackerOptions {
    mode: TrackerMode;
    viewingData?: ViewingData;
    pageData?: PageData;
    isActive?: boolean; // Control whether tracking is active (e.g., player is open)
}

/**
 * Hook to track viewing time and page visits for Movix Wrapped 2026.
 * Respects privacy_data_collection setting in localStorage.
 * Sends data every 30 seconds to minimize request spam.
 */
export function useWrappedTracker(options: UseWrappedTrackerOptions) {
    const { mode, isActive = true } = options;

    // Use refs for object data to keep sendData callback stable across re-renders.
    // Without this, every parent re-render recreates sendData → restarts all intervals → fires requests.
    const viewingDataRef = useRef(options.viewingData);
    const pageDataRef = useRef(options.pageData);
    const modeRef = useRef(mode);
    viewingDataRef.current = options.viewingData;
    pageDataRef.current = options.pageData;
    modeRef.current = mode;

    // Timestamp-based accumulation — no 1-second setInterval needed
    const accumulatedSecondsRef = useRef(0);
    const sessionStartRef = useRef<number | null>(null);
    const isVisibleRef = useRef(!document.hidden);
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;

    // Check if data collection is enabled
    const isDataCollectionEnabled = useCallback(() => {
        try {
            const setting = localStorage.getItem('privacy_data_collection');
            // Default to true, disable only if explicitly set to 'false'
            return setting !== 'false';
        } catch {
            // Pas de collecte si la préférence de confidentialité est illisible.
            return false;
        }
    }, []);

    // Get user and profile IDs
    // IMPORTANT: Priority must match the JWT token generation order in the server
    // The JWT 'sub' claim is set from OAuth provider IDs (Google/Discord), so we must prioritize those
    const getUserInfo = useCallback(() => {
        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');
            let userId: string | null = getResolvedUserId();

            // Priority 5 (last resort): VIP Guest UUID
            if (!userId) {
                userId = localStorage.getItem('guest_uuid');
            }

            return { authToken, profileId, userId };
        } catch {
            // Firefox peut fermer le stockage avant le dernier tick (NS_ERROR_ABORT).
            return { authToken: null, profileId: null, userId: null };
        }
    }, []);

    /**
     * Harvest elapsed time from current tracking session into accumulated buffer.
     * Uses timestamp diff — no 1-second setInterval needed.
     */
    const harvestTime = useCallback(() => {
        if (sessionStartRef.current && isVisibleRef.current && isActiveRef.current) {
            const elapsed = (Date.now() - sessionStartRef.current) / 1000;
            if (elapsed > 0 && elapsed < 60) {
                accumulatedSecondsRef.current += elapsed;
            }
        }
        sessionStartRef.current = Date.now();
    }, []);

    // Send accumulated data to API (stable deps — no object references)
    const sendData = useCallback(async () => {
        harvestTime();

        if (accumulatedSecondsRef.current < MIN_SECONDS_TO_SEND) return;

        const { authToken, profileId, userId } = getUserInfo();
        if (!authToken || !userId) return;

        const durationSeconds = Math.floor(accumulatedSecondsRef.current);
        accumulatedSecondsRef.current = 0;

        const now = new Date();
        const payload: Record<string, unknown> = {
            userId,
            profileId,
            type: modeRef.current,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            duration: durationSeconds,
        };

        if (modeRef.current === 'viewing' && viewingDataRef.current) {
            payload.contentType = viewingDataRef.current.contentType;
            payload.contentId = viewingDataRef.current.contentId;
            payload.contentTitle = viewingDataRef.current.contentTitle;
            payload.seasonNumber = viewingDataRef.current.seasonNumber;
            payload.episodeNumber = viewingDataRef.current.episodeNumber;
            payload.hourOfDay = now.getHours();
        } else if (modeRef.current === 'page' && pageDataRef.current) {
            payload.pageName = pageDataRef.current.pageName;
            payload.contentId = pageDataRef.current.contentId;
            payload.meta = pageDataRef.current.meta;
        }

        try {
            await fetch(`${MAIN_API}/api/wrapped/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify(payload),
                keepalive: true,
            });
        } catch {
            // Silent fail — wrapped tracking is non-critical
        }
    }, [getUserInfo, harvestTime]);

    // Handle document visibility change
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                harvestTime();
                isVisibleRef.current = false;
                if (accumulatedSecondsRef.current >= MIN_SECONDS_TO_SEND) sendData();
            } else {
                isVisibleRef.current = true;
                sessionStartRef.current = Date.now();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [sendData, harvestTime]);

    // Main tracking effect — no 1-second tick, just a send interval
    useEffect(() => {
        if (!isDataCollectionEnabled()) return;

        sessionStartRef.current = Date.now();

        const sendInterval = setInterval(() => {
            if (isActiveRef.current && isVisibleRef.current) {
                sendData();
            }
        }, SEND_INTERVAL_MS);

        return () => {
            clearInterval(sendInterval);
            harvestTime();
            if (accumulatedSecondsRef.current >= 1) {
                sendData();
            }
        };
    }, [isDataCollectionEnabled, sendData, harvestTime]);

    // Reset session when isActive changes
    useEffect(() => {
        if (isActive) {
            sessionStartRef.current = Date.now();
        } else {
            harvestTime();
        }
    }, [isActive, harvestTime]);

    // Send remaining data when content changes (e.g., episode switch)
    useEffect(() => {
        return () => {
            harvestTime();
            if (accumulatedSecondsRef.current >= 1) {
                sendData();
            }
        };
    }, [options.viewingData?.contentId, options.pageData?.pageName, sendData, harvestTime]);

    return {
        isTracking: isActive && isDataCollectionEnabled(),
    };
}

export default useWrappedTracker;

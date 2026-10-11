package com.movix.app.proxy

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections

internal class MediaProxyTarget(
    val upstreamUrl: String,
    val method: String,
    headers: Map<String, String>,
) {
    val headers: Map<String, String> =
        Collections.unmodifiableMap(LinkedHashMap(headers))

    override fun toString(): String {
        return "MediaProxyTarget(method=$method, headers=${headers.keys}, redacted=true)"
    }
}

internal class MediaProxyPreparedResponse(
    val statusCode: Int,
    val statusMessage: String,
    headers: Map<String, String>,
    body: ByteArray,
    val finalUrl: String,
) {
    val headers: Map<String, String> =
        Collections.unmodifiableMap(LinkedHashMap(headers))
    val body: ByteArray = body.copyOf()

    override fun toString(): String {
        return "MediaProxyPreparedResponse(statusCode=$statusCode, bytes=${body.size}, redacted=true)"
    }
}

internal data class MediaProxySessionRegistration(
    val sessionId: String,
    val resourceId: String,
    val localUrl: String,
)

internal class MediaProxySessionStore(
    private val processSecret: String = randomToken(),
    private val now: () -> Long = System::currentTimeMillis,
    private val tokenFactory: () -> String = ::randomToken,
    private val idleTtlMs: Long = DEFAULT_IDLE_TTL_MS,
    private val maxSessions: Int = DEFAULT_MAX_SESSIONS,
    private val maxResourcesPerSession: Int = DEFAULT_MAX_RESOURCES,
) {
    private data class Resource(
        val target: MediaProxyTarget,
        var preparedResponse: MediaProxyPreparedResponse? = null,
        var persistentPreparedResponse: Boolean = false,
    )

    private data class ResourceKey(
        val upstreamUrl: String,
        val method: String,
        val headers: Map<String, String>,
    )

    private data class Session(
        val access: MediaProxySessionAccess,
        val headers: Map<String, String>,
        val profile: CastMediaProfile?,
        val root: MediaProxyTarget,
        val resources: LinkedHashMap<String, Resource> = linkedMapOf(),
        val resourceIdsByKey: MutableMap<ResourceKey, String> = mutableMapOf(),
        var lastAccessAt: Long,
        var graceExpiresAt: Long? = null,
        var retainedByCast: Boolean = false,
    )

    private val lock = Any()
    private val sessions = linkedMapOf<String, Session>()

    fun create(
        upstreamUrl: String,
        method: String,
        headers: Map<String, String>,
        port: Int,
    ): String = createSession(
        upstreamUrl = upstreamUrl,
        method = method,
        headers = headers,
        port = port,
        access = MediaProxySessionAccess.loopback(),
        profile = null,
        preparedResponse = null,
    ).localUrl

    fun createCast(
        upstreamUrl: String,
        method: String,
        headers: Map<String, String>,
        port: Int,
        access: MediaProxySessionAccess,
        profile: CastMediaProfile,
        preparedResponse: MediaProxyPreparedResponse? = null,
    ): MediaProxySessionRegistration {
        require(access.mode == MediaProxyMode.CAST_LAN) {
            "Cast session access required"
        }
        return createSession(
            upstreamUrl,
            method,
            headers,
            port,
            access,
            profile,
            preparedResponse,
        )
    }

    private fun createSession(
        upstreamUrl: String,
        method: String,
        headers: Map<String, String>,
        port: Int,
        access: MediaProxySessionAccess,
        profile: CastMediaProfile?,
        preparedResponse: MediaProxyPreparedResponse?,
    ): MediaProxySessionRegistration = synchronized(lock) {
        cleanupExpiredLocked()
        while (sessions.size >= maxSessions) {
            val oldestId = sessions.entries.filterNot { it.value.retainedByCast }
                .minByOrNull { it.value.lastAccessAt }?.key
                ?: throw IllegalStateException("All media proxy sessions are retained")
            sessions.remove(oldestId)
        }

        val sessionId = uniqueSessionIdLocked()
        val resourceId = tokenFactory()
        val copiedHeaders = immutableHeaders(headers)
        val root = MediaProxyTarget(upstreamUrl, method.uppercase(), copiedHeaders)
        val session = Session(
            access = access,
            headers = copiedHeaders,
            profile = profile,
            root = root,
            lastAccessAt = now(),
        )
        session.resources[resourceId] = Resource(root, preparedResponse)
        session.resourceIdsByKey[
            ResourceKey(upstreamUrl, root.method, root.headers)
        ] = resourceId
        sessions[sessionId] = session
        MediaProxySessionRegistration(
            sessionId,
            resourceId,
            buildLocalUrl(access, port, sessionId, resourceId),
        )
    }

    fun register(
        sessionId: String,
        upstreamUrl: String,
        port: Int,
    ): String = registerResource(sessionId, upstreamUrl, port).localUrl

    fun registerResource(
        sessionId: String,
        upstreamUrl: String,
        port: Int,
        method: String = "GET",
        preparedResponse: MediaProxyPreparedResponse? = null,
        headers: Map<String, String>? = null,
    ): MediaProxySessionRegistration = synchronized(lock) {
        cleanupExpiredLocked()
        val session = sessions[sessionId]
            ?: throw IllegalArgumentException("Unknown media proxy session")
        session.lastAccessAt = now()
        val normalizedMethod = method.uppercase()
        val resourceHeaders = immutableHeaders(
            headers?.let(MediaProxyPolicy::sanitizeRequestHeaders) ?: session.headers,
        )
        val resourceKey = ResourceKey(
            upstreamUrl,
            normalizedMethod,
            resourceHeaders,
        )
        val existingId = session.resourceIdsByKey[resourceKey]
        if (existingId != null) {
            if (preparedResponse != null) {
                session.resources[existingId]?.let { resource ->
                    resource.preparedResponse = preparedResponse
                    resource.persistentPreparedResponse = false
                }
            }
            return@synchronized MediaProxySessionRegistration(
                sessionId,
                existingId,
                buildLocalUrl(session.access, port, sessionId, existingId),
            )
        }
        require(session.resources.size < maxResourcesPerSession) {
            "Media proxy session resource limit reached"
        }

        val resourceId = uniqueResourceIdLocked(session)
        session.resources[resourceId] = Resource(
            target = MediaProxyTarget(
                upstreamUrl = upstreamUrl,
                method = normalizedMethod,
                headers = resourceHeaders,
            ),
            preparedResponse = preparedResponse,
        )
        session.resourceIdsByKey[resourceKey] = resourceId
        MediaProxySessionRegistration(
            sessionId,
            resourceId,
            buildLocalUrl(session.access, port, sessionId, resourceId),
        )
    }

    fun registerResourceAlias(
        sessionId: String,
        upstreamUrl: String,
        port: Int,
        method: String = "GET",
        preparedResponse: MediaProxyPreparedResponse? = null,
        headers: Map<String, String>? = null,
    ): MediaProxySessionRegistration = synchronized(lock) {
        cleanupExpiredLocked()
        val session = sessions[sessionId]
            ?: throw IllegalArgumentException("Unknown media proxy session")
        session.lastAccessAt = now()
        require(session.resources.size < maxResourcesPerSession) {
            "Media proxy session resource limit reached"
        }
        val normalizedMethod = method.uppercase()
        val resourceHeaders = immutableHeaders(
            headers?.let(MediaProxyPolicy::sanitizeRequestHeaders) ?: session.headers,
        )
        val resourceId = uniqueResourceIdLocked(session)
        session.resources[resourceId] = Resource(
            target = MediaProxyTarget(
                upstreamUrl = upstreamUrl,
                method = normalizedMethod,
                headers = resourceHeaders,
            ),
            preparedResponse = preparedResponse,
        )
        MediaProxySessionRegistration(
            sessionId,
            resourceId,
            buildLocalUrl(session.access, port, sessionId, resourceId),
        )
    }

    fun setPersistentPreparedResponse(
        sessionId: String,
        resourceId: String,
        preparedResponse: MediaProxyPreparedResponse,
    ) = synchronized(lock) {
        cleanupExpiredLocked()
        val session = sessions[sessionId]
            ?.takeIf { it.access.mode == MediaProxyMode.CAST_LAN }
            ?: throw IllegalArgumentException("Unknown Cast media proxy session")
        val resource = session.resources[resourceId]
            ?: throw IllegalArgumentException("Unknown Cast media proxy resource")
        session.lastAccessAt = now()
        resource.preparedResponse = preparedResponse
        resource.persistentPreparedResponse = true
    }

    fun resolve(
        suppliedSecret: String,
        sessionId: String,
        resourceId: String,
    ): MediaProxyTarget? = synchronized(lock) {
        if (!constantTimeEquals(processSecret, suppliedSecret)) return@synchronized null
        resolveLocked(MediaProxyMode.LOOPBACK, sessionId, resourceId)
    }

    fun resolveRootForCast(
        suppliedSecret: String,
        sessionId: String,
        resourceId: String,
    ): MediaProxyTarget? = synchronized(lock) {
        if (!constantTimeEquals(processSecret, suppliedSecret)) return@synchronized null
        cleanupExpiredLocked()
        val session = sessions[sessionId]
            ?.takeIf { it.access.mode == MediaProxyMode.LOOPBACK }
            ?: return@synchronized null
        if (!session.resources.containsKey(resourceId)) return@synchronized null
        session.lastAccessAt = now()
        session.root
    }

    fun resolveCast(sessionId: String, resourceId: String): MediaProxyTarget? =
        synchronized(lock) {
            resolveLocked(MediaProxyMode.CAST_LAN, sessionId, resourceId)
        }

    fun access(sessionId: String): MediaProxySessionAccess? = synchronized(lock) {
        cleanupExpiredLocked()
        sessions[sessionId]?.access
    }

    fun profile(sessionId: String): CastMediaProfile? = synchronized(lock) {
        cleanupExpiredLocked()
        sessions[sessionId]?.profile
    }

    fun consumePreparedResponse(
        sessionId: String,
        resourceId: String,
    ): MediaProxyPreparedResponse? = synchronized(lock) {
        cleanupExpiredLocked()
        val session = sessions[sessionId] ?: return@synchronized null
        val resource = session.resources[resourceId] ?: return@synchronized null
        session.lastAccessAt = now()
        val prepared = resource.preparedResponse
        if (!resource.persistentPreparedResponse) {
            resource.preparedResponse = null
        }
        prepared
    }

    fun peekPreparedResponse(
        sessionId: String,
        resourceId: String,
    ): MediaProxyPreparedResponse? = synchronized(lock) {
        cleanupExpiredLocked()
        val session = sessions[sessionId] ?: return@synchronized null
        val resource = session.resources[resourceId] ?: return@synchronized null
        session.lastAccessAt = now()
        resource.preparedResponse
    }

    fun invalidate(sessionId: String): Boolean = synchronized(lock) {
        sessions.remove(sessionId) != null
    }

    fun invalidateAll(mode: MediaProxyMode) = synchronized(lock) {
        sessions.entries.removeAll { it.value.access.mode == mode }
    }

    fun retainAcceptedCastSession(sessionId: String) = synchronized(lock) {
        sessions[sessionId]?.takeIf { it.access.mode == MediaProxyMode.CAST_LAN }?.let {
            it.retainedByCast = true
            it.graceExpiresAt = null
        }
    }

    fun replaceAfterAcceptedLoad(oldSessionId: String, graceMs: Long) =
        synchronized(lock) {
            require(graceMs >= 0L) { "Invalid replacement grace" }
            sessions[oldSessionId]?.let {
                it.retainedByCast = false
                it.graceExpiresAt = now() + graceMs
            }
        }

    fun cleanupExpired() = synchronized(lock) {
        cleanupExpiredLocked()
    }

    fun describe(sessionId: String): String? = synchronized(lock) {
        cleanupExpiredLocked()
        sessions[sessionId]?.let {
            "MediaProxySession(mode=${it.access.mode}, resources=${it.resources.size}, " +
                "headerNames=${it.headers.keys}, redacted=true)"
        }
    }

    private fun resolveLocked(
        mode: MediaProxyMode,
        sessionId: String,
        resourceId: String,
    ): MediaProxyTarget? {
        cleanupExpiredLocked()
        val session = sessions[sessionId]
            ?.takeIf { it.access.mode == mode }
            ?: return null
        val target = session.resources[resourceId]?.target ?: return null
        session.lastAccessAt = now()
        return target
    }

    private fun cleanupExpiredLocked() {
        val current = now()
        val cutoff = current - idleTtlMs
        val iterator = sessions.iterator()
        while (iterator.hasNext()) {
            val session = iterator.next().value
            val graceExpired = session.graceExpiresAt?.let { current > it } == true
            val idleExpired = !session.retainedByCast &&
                session.graceExpiresAt == null && session.lastAccessAt < cutoff
            if (graceExpired || idleExpired) iterator.remove()
        }
    }

    private fun buildLocalUrl(
        access: MediaProxySessionAccess,
        port: Int,
        sessionId: String,
        resourceId: String,
    ): String = when (access.mode) {
        MediaProxyMode.LOOPBACK -> MediaProxyPolicy.buildLoopbackUrl(
            port,
            processSecret,
            sessionId,
            resourceId,
        )

        MediaProxyMode.CAST_LAN -> MediaProxyPolicy.buildCastUrl(
            access.bindAddress,
            port,
            sessionId,
            resourceId,
        )
    }

    private fun uniqueSessionIdLocked(): String {
        repeat(8) {
            val candidate = tokenFactory()
            if (!sessions.containsKey(candidate)) return candidate
        }
        throw IllegalStateException("Unable to allocate media proxy session")
    }

    private fun uniqueResourceIdLocked(session: Session): String {
        repeat(8) {
            val candidate = tokenFactory()
            if (!session.resources.containsKey(candidate)) return candidate
        }
        throw IllegalStateException("Unable to allocate media proxy resource")
    }

    companion object {
        private const val DEFAULT_IDLE_TTL_MS = 30L * 60L * 1_000L
        private const val DEFAULT_MAX_SESSIONS = 512
        private const val DEFAULT_MAX_RESOURCES = 8_192
        private val secureRandom = SecureRandom()

        private fun randomToken(): String {
            val bytes = ByteArray(18)
            secureRandom.nextBytes(bytes)
            return Base64.encodeToString(
                bytes,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            )
        }

        private fun constantTimeEquals(expected: String, supplied: String): Boolean {
            return MessageDigest.isEqual(
                expected.toByteArray(Charsets.UTF_8),
                supplied.toByteArray(Charsets.UTF_8),
            )
        }

        private fun immutableHeaders(input: Map<String, String>): Map<String, String> {
            return Collections.unmodifiableMap(LinkedHashMap(input))
        }
    }
}

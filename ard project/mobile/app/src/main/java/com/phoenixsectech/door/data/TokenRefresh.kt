package com.phoenixsectech.door.data

/** Pure scheduling helper for the rotating token (unit-tested, no Android deps). */
object TokenRefresh {
    /** Refresh this many seconds before expiry so a tap is never on a dead token. */
    const val SKEW_SEC = 30L
    private const val MIN_DELAY_MS = 5_000L

    /**
     * Milliseconds to wait before minting the next token.
     * @param expSec token expiry (unix seconds); 0 if none yet -> refresh now.
     */
    fun nextDelayMs(expSec: Long, nowMs: Long = System.currentTimeMillis()): Long {
        if (expSec <= 0L) return 0L
        val refreshAtMs = (expSec - SKEW_SEC) * 1000L
        val delay = refreshAtMs - nowMs
        return if (delay < MIN_DELAY_MS) MIN_DELAY_MS else delay
    }
}

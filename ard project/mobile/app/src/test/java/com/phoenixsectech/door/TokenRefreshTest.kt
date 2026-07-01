package com.phoenixsectech.door

import com.phoenixsectech.door.data.TokenRefresh
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenRefreshTest {

    @Test fun noTokenRefreshesImmediately() {
        assertEquals(0L, TokenRefresh.nextDelayMs(0L, nowMs = 1_000_000L))
    }

    @Test fun schedulesBeforeExpiry() {
        val now = 1_000_000_000_000L          // ms
        val nowSec = now / 1000
        val exp = nowSec + 180                 // 3 min token
        val delay = TokenRefresh.nextDelayMs(exp, now)
        // should aim for exp - SKEW (30s) => 150s out
        assertEquals((180 - TokenRefresh.SKEW_SEC) * 1000, delay)
    }

    @Test fun clampsToMinimumWhenNearlyExpired() {
        val now = 1_000_000_000_000L
        val exp = now / 1000 + 5               // expires in 5s, inside the skew window
        val delay = TokenRefresh.nextDelayMs(exp, now)
        assertTrue("delay should be clamped up", delay >= 5_000L)
    }
}

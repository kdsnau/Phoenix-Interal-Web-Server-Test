package com.phoenixsectech.door.hce

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Holds the latest rotating token in encrypted prefs so the HCE service can read
 * it on a tap even when the app UI isn't in the foreground. The app writes a
 * fresh token here (via the API) before the old one expires.
 */
object TokenStore {
    private const val FILE = "phx_door_token"
    private const val KEY_TOKEN = "token"
    private const val KEY_EXP = "exp" // unix seconds

    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx,
        FILE,
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(ctx: Context, token: String, exp: Long) {
        prefs(ctx).edit().putString(KEY_TOKEN, token).putLong(KEY_EXP, exp).apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    fun expiry(ctx: Context): Long = prefs(ctx).getLong(KEY_EXP, 0L)

    /** The token if it hasn't expired yet, else null (reader should be tapped again after refresh). */
    fun currentValidToken(ctx: Context, nowSec: Long = System.currentTimeMillis() / 1000): String? {
        val p = prefs(ctx)
        val token = p.getString(KEY_TOKEN, null) ?: return null
        val exp = p.getLong(KEY_EXP, 0L)
        return if (exp > nowSec) token else null
    }
}

package com.phoenixsectech.door.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.phoenixsectech.door.BuildConfig

/** Encrypted store for the session JWT and the configured backend base URL. */
class Prefs(context: Context) {
    private val sp = EncryptedSharedPreferences.create(
        context,
        "phx_door_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var jwt: String?
        get() = sp.getString("jwt", null)
        set(v) = sp.edit().putString("jwt", v).apply()

    // Baked-in per deployment (BuildConfig.SERVER_URL). A field tech can still
    // override it via the login screen's "Advanced" section; that override is
    // stored here and wins until cleared.
    var baseUrl: String
        get() = sp.getString("base_url", BuildConfig.SERVER_URL) ?: BuildConfig.SERVER_URL
        set(v) = sp.edit().putString("base_url", v).apply()

    val isServerOverridden: Boolean
        get() = sp.getString("base_url", null) != null

    /** Drop any custom server override and fall back to BuildConfig.SERVER_URL. */
    fun resetBaseUrl() = sp.edit().remove("base_url").apply()

    fun clearSession() = sp.edit().remove("jwt").apply()
}

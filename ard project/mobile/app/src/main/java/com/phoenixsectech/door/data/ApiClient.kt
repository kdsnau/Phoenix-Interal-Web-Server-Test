package com.phoenixsectech.door.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.phoenixsectech.door.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit

/**
 * Builds a Retrofit ApiService bound to the configured base URL, injecting the
 * stored JWT as a Bearer token on every request.
 */
object ApiClient {
    private val json = Json { ignoreUnknownKeys = true }

    fun create(prefs: Prefs): ApiService {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val b = chain.request().newBuilder()
                prefs.jwt?.let { b.header("Authorization", "Bearer $it") }
                chain.proceed(b.build())
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(safeBaseUrl(prefs))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
    }

    /**
     * Normalize + validate the configured URL so a bad value (e.g. missing scheme,
     * or a half-typed entry from the Advanced field) can NEVER crash the app. An
     * invalid override is discarded and we fall back to the baked-in default.
     */
    fun safeBaseUrl(prefs: Prefs): String {
        var b = prefs.baseUrl.trim()
        if (b.isNotEmpty() && !b.startsWith("http://") && !b.startsWith("https://")) {
            b = "http://$b"
        }
        if (!b.endsWith("/")) b += "/"
        if (b.toHttpUrlOrNull() == null) {
            // Unparseable — throw the override away and use the deployment default.
            prefs.resetBaseUrl()
            b = BuildConfig.SERVER_URL.let { if (it.endsWith("/")) it else "$it/" }
        }
        return b
    }
}

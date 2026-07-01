package com.phoenixsectech.door.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.phoenixsectech.door.data.ApiClient
import com.phoenixsectech.door.data.CredentialDto
import com.phoenixsectech.door.data.EventDto
import com.phoenixsectech.door.data.LoginRequest
import com.phoenixsectech.door.data.Prefs
import com.phoenixsectech.door.hce.TokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class UiState(
    val loggedIn: Boolean = false,
    val baseUrl: String = "",
    val credential: CredentialDto? = null,
    val tokenExp: Long = 0L,
    val events: List<EventDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

class DoorViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private var api = ApiClient.create(prefs)

    private val _state = MutableStateFlow(UiState(loggedIn = prefs.jwt != null, baseUrl = prefs.baseUrl))
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun setBaseUrl(url: String) {
        prefs.baseUrl = url
        api = ApiClient.create(prefs)
        _state.value = _state.value.copy(baseUrl = url)
    }

    fun login(email: String, password: String) = viewModelScope.launch {
        _state.value = _state.value.copy(loading = true, error = null)
        try {
            val resp = api.login(LoginRequest(email.trim().lowercase(), password))
            prefs.jwt = resp.token
            api = ApiClient.create(prefs)
            _state.value = _state.value.copy(loggedIn = true, loading = false)
            loadCard()
            loadEvents()
        } catch (e: Exception) {
            // A 401 here means the credentials didn't match — not a stale session.
            val msg = if (e.message?.contains("401") == true) "Wrong email or password." else friendly(e)
            _state.value = _state.value.copy(loading = false, error = msg)
        }
    }

    fun logout() {
        prefs.clearSession()
        TokenStore.clear(getApplication())
        _state.value = UiState(loggedIn = false, baseUrl = prefs.baseUrl)
    }

    fun loadCard() = viewModelScope.launch {
        try {
            val cred = api.myCredential()
            _state.value = _state.value.copy(credential = cred, error = null)
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = friendly(e))
        }
    }

    /** Mint a fresh rotating token and hand it to the HCE service via TokenStore.
     *  Returns the new expiry (unix seconds) so the caller can schedule the next refresh. */
    suspend fun refreshTokenNow(): Long {
        val t = api.mintToken()
        TokenStore.save(getApplication(), t.token, t.exp)
        _state.value = _state.value.copy(tokenExp = t.exp, error = null)
        return t.exp
    }

    /** Fire-and-forget refresh for the manual button. */
    fun refreshToken() = viewModelScope.launch {
        try { refreshTokenNow() } catch (e: Exception) {
            _state.value = _state.value.copy(error = friendly(e))
        }
    }

    fun loadEvents() = viewModelScope.launch {
        try {
            _state.value = _state.value.copy(events = api.myEvents(50))
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = friendly(e))
        }
    }

    private fun friendly(e: Exception): String = when {
        e.message?.contains("401") == true -> "Sign-in expired — log in again."
        e.message?.contains("404") == true -> "No phone credential for this account yet — ask an admin to issue one."
        e.message?.contains("Unable to resolve host") == true ||
            e.message?.contains("Failed to connect") == true -> "Can't reach the server. Check the address."
        else -> e.message ?: "Something went wrong."
    }
}

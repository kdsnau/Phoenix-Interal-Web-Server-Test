package com.phoenixsectech.door.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class UserDto(val id: Int, val name: String, val email: String, val role: String)

@Serializable
data class LoginResponse(val token: String, val user: UserDto)

@Serializable
data class CredentialDto(
    val id: Int,
    @SerialName("public_id") val publicId: String,
    val label: String? = null,
    val active: Boolean = true,
    @SerialName("issued_at") val issuedAt: String? = null,
)

@Serializable
data class TokenResponse(val token: String, val exp: Long, val ttl: Long)

@Serializable
data class EventDto(
    val id: Int,
    val decision: String,
    val reason: String? = null,
    @SerialName("was_offline") val wasOffline: Boolean = false,
    @SerialName("scanned_at") val scannedAt: String,
    @SerialName("door_name") val doorName: String? = null,
)

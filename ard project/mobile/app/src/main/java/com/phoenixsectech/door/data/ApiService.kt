package com.phoenixsectech.door.data

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface ApiService {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("api/me/credential")
    suspend fun myCredential(): CredentialDto

    @POST("api/me/token")
    suspend fun mintToken(): TokenResponse

    @GET("api/me/events")
    suspend fun myEvents(@Query("limit") limit: Int = 50): List<EventDto>
}

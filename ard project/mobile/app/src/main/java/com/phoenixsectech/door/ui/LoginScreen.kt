package com.phoenixsectech.door.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(vm: DoorViewModel) {
    val state by vm.state.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showAdvanced by remember { mutableStateOf(false) }
    var baseUrl by remember(state.baseUrl) { mutableStateOf(state.baseUrl) }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Phoenix Door", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
        Text("Your digital access card", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(32.dp))

        // Just log in — the server is configured into the app per deployment.
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                capitalization = KeyboardCapitalization.None,
                autoCorrect = false,
            ),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )

        state.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { vm.login(email, password) },
            enabled = !state.loading && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.loading) "Signing in…" else "Sign in")
        }

        // Field-tech override only — hidden by default so end users never see it.
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = { showAdvanced = !showAdvanced }) {
            Text(if (showAdvanced) "Hide advanced" else "Advanced",
                style = MaterialTheme.typography.bodySmall)
        }
        if (showAdvanced) {
            OutlinedTextField(
                value = baseUrl, onValueChange = { baseUrl = it; vm.setBaseUrl(it) },
                label = { Text("Server address (override)") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

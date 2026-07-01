package com.phoenixsectech.door

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contactless
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.phoenixsectech.door.ui.CardScreen
import com.phoenixsectech.door.ui.DoorViewModel
import com.phoenixsectech.door.ui.HistoryScreen
import com.phoenixsectech.door.ui.LoginScreen
import com.phoenixsectech.door.ui.PhxDoorTheme

class MainActivity : ComponentActivity() {
    private val vm: DoorViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PhxDoorTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val state by vm.state.collectAsState()
                    if (!state.loggedIn) LoginScreen(vm) else Home(vm)
                }
            }
        }
    }
}

private enum class Tab { Card, History }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Home(vm: DoorViewModel) {
    var tab by remember { mutableStateOf(Tab.Card) }

    LaunchedEffect(Unit) { vm.loadCard() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Phoenix Door") },
                actions = { TextButton(onClick = { vm.logout() }) { Text("Log out") } },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == Tab.Card, onClick = { tab = Tab.Card },
                    icon = { Icon(Icons.Filled.Contactless, null) }, label = { Text("Card") },
                )
                NavigationBarItem(
                    selected = tab == Tab.History, onClick = { tab = Tab.History },
                    icon = { Icon(Icons.Filled.History, null) }, label = { Text("History") },
                )
            }
        },
    ) { inner ->
        Surface(Modifier.fillMaxSize().padding(inner), color = MaterialTheme.colorScheme.background) {
            when (tab) {
                Tab.Card -> CardScreen(vm)
                Tab.History -> HistoryScreen(vm)
            }
        }
    }
}

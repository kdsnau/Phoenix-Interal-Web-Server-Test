package com.phoenixsectech.door.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * The "digital card". When the user taps the phone to a door reader, Android
 * routes the reader's APDUs here. We answer a SELECT of our AID with the current
 * rotating token; the reader verifies it (HMAC + expiry) and opens the door.
 *
 * Runs in its own process lifecycle triggered by NFC, so it reads the token from
 * encrypted prefs (TokenStore) rather than app memory.
 */
class DoorHceService : HostApduService() {

    override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
        val apdu = commandApdu ?: return Apdu.SW_INS_NOT_SUPPORTED

        return when {
            Apdu.isSelectAid(apdu) || Apdu.isGetData(apdu) -> {
                val token = TokenStore.currentValidToken(applicationContext)
                if (token != null) {
                    Apdu.dataResponse(token.toByteArray(Charsets.US_ASCII))
                } else {
                    // No fresh token loaded — user should open the app to refresh.
                    Apdu.SW_CONDITIONS_NOT_SATISFIED
                }
            }
            else -> Apdu.SW_INS_NOT_SUPPORTED
        }
    }

    override fun onDeactivated(reason: Int) {
        // Field gone / different AID selected — nothing to clean up.
    }
}

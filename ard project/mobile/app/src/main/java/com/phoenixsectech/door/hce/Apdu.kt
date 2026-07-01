package com.phoenixsectech.door.hce

/**
 * APDU constants + framing for the phone<->reader contract.
 *
 * Protocol (kept tiny so the Arduino reader can implement it easily):
 *   reader -> SELECT AID:  00 A4 04 00 08 F0 50 48 58 44 4F 4F 52 00
 *   phone  -> <token ASCII bytes> 90 00     (if a fresh token is loaded)
 *           -> 69 85 (conditions not satisfied)   (no token / expired -> open the app)
 * Optionally the reader may also issue GET DATA (80 CA 00 00 00) and gets the
 * same token response, but returning the token on SELECT keeps the tap to a
 * single exchange, which is the most reliable over NFC.
 */
object Apdu {
    // F0 + "PHXDOOR"
    val AID = byteArrayOf(0xF0.toByte(), 0x50, 0x48, 0x58, 0x44, 0x4F, 0x4F, 0x52)

    val SW_OK = byteArrayOf(0x90.toByte(), 0x00)
    val SW_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69, 0x85.toByte())
    val SW_INS_NOT_SUPPORTED = byteArrayOf(0x6D, 0x00)
    val SW_FILE_NOT_FOUND = byteArrayOf(0x6A, 0x82.toByte())

    private const val CLA = 0
    private const val INS_SELECT = 0xA4
    private const val P1_BY_NAME = 0x04
    private const val INS_GET_DATA = 0xCA

    /** True if this is a SELECT-by-AID command whose payload equals our AID. */
    fun isSelectAid(apdu: ByteArray, aid: ByteArray = AID): Boolean {
        if (apdu.size < 5) return false
        if ((apdu[0].toInt() and 0xFF) != CLA) return false
        if ((apdu[1].toInt() and 0xFF) != INS_SELECT) return false
        if ((apdu[2].toInt() and 0xFF) != P1_BY_NAME) return false
        val lc = apdu[4].toInt() and 0xFF
        if (apdu.size < 5 + lc) return false
        val payload = apdu.copyOfRange(5, 5 + lc)
        return payload.contentEquals(aid)
    }

    /** True if this is our proprietary GET DATA (80 CA 00 00 ..). */
    fun isGetData(apdu: ByteArray): Boolean {
        if (apdu.size < 4) return false
        return (apdu[0].toInt() and 0xFF) == 0x80 && (apdu[1].toInt() and 0xFF) == INS_GET_DATA
    }

    /** Append the success trailer to a data payload. */
    fun dataResponse(data: ByteArray): ByteArray = data + SW_OK

    fun bytesToHex(b: ByteArray): String =
        b.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
}

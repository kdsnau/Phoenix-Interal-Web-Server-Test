package com.phoenixsectech.door

import com.phoenixsectech.door.hce.Apdu
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApduTest {

    // 00 A4 04 00 08 F0 50 48 58 44 4F 4F 52 00
    private val selectAid = byteArrayOf(
        0x00, 0xA4.toByte(), 0x04, 0x00, 0x08,
        0xF0.toByte(), 0x50, 0x48, 0x58, 0x44, 0x4F, 0x4F, 0x52,
        0x00,
    )

    @Test fun recognisesSelectOfOurAid() {
        assertTrue(Apdu.isSelectAid(selectAid))
    }

    @Test fun rejectsSelectOfAnotherAid() {
        val other = selectAid.copyOf()
        other[5] = 0xA1.toByte() // corrupt the AID
        assertFalse(Apdu.isSelectAid(other))
    }

    @Test fun rejectsNonSelect() {
        assertFalse(Apdu.isSelectAid(byteArrayOf(0x00, 0xB0.toByte(), 0x00, 0x00, 0x00)))
        assertFalse(Apdu.isSelectAid(byteArrayOf(0x00)))
    }

    @Test fun recognisesGetData() {
        assertTrue(Apdu.isGetData(byteArrayOf(0x80.toByte(), 0xCA.toByte(), 0x00, 0x00, 0x00)))
        assertFalse(Apdu.isGetData(byteArrayOf(0x00, 0xCA.toByte(), 0x00, 0x00)))
    }

    @Test fun dataResponseAppendsOkTrailer() {
        val token = "abc123.999.deadbeef".toByteArray(Charsets.US_ASCII)
        val resp = Apdu.dataResponse(token)
        assertArrayEquals(token, resp.copyOfRange(0, token.size))
        assertEquals(0x90, resp[resp.size - 2].toInt() and 0xFF)
        assertEquals(0x00, resp[resp.size - 1].toInt() and 0xFF)
    }
}

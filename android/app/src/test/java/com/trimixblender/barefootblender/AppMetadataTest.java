package com.trimixblender.barefootblender;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppMetadataTest {

    @Test
    public void mainActivityUsesReleasedPackageName() {
        assertEquals("com.trimixblender.barefootblender", MainActivity.class.getPackage().getName());
    }
}

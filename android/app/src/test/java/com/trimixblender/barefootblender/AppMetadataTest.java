package com.trimixblender.barefootblender;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppMetadataTest {

    @Test
    public void buildConfigMatchesReleasedApplicationId() {
        assertEquals("com.trimixblender.barefootblender", BuildConfig.APPLICATION_ID);
    }
}

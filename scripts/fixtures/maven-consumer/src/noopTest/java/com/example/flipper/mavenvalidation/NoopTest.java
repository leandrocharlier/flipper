package com.example.flipper.mavenvalidation;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.facebook.flipper.android.AndroidFlipperClient;
import com.facebook.flipper.core.FlipperClient;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NoopTest {
  @Test public void releaseSdkRunsWithoutNativeLibrariesOrConnection() throws Exception {
    FlipperClient client = AndroidFlipperClient.getInstance(
        InstrumentationRegistry.getInstrumentation().getTargetContext());
    client.start();
    assertEquals("com.facebook.flipper.android.NoOpAndroidFlipperClient", client.getClass().getName());
    assertNull(client.getPlugin("Network"));
    client.stop();
    String apk = InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationInfo().sourceDir;
    try (java.util.zip.ZipFile archive = new java.util.zip.ZipFile(apk)) {
      assertFalse(archive.stream().anyMatch(entry -> entry.getName().endsWith(".so")));
    }
  }
}

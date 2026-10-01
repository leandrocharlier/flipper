package com.example.flipper.mavenvalidation;

import static org.junit.Assert.*;

import android.app.Application;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.system.Os;
import android.system.OsConstants;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import com.facebook.flipper.android.AndroidFlipperClient;
import com.facebook.flipper.core.*;
import com.facebook.flipper.plugins.leakcanary.LeakCanaryFlipperPlugin;
import com.facebook.flipper.plugins.leakcanary2.LeakCanary2FlipperPlugin;
import com.facebook.flipper.plugins.network.*;
import com.facebook.flipper.plugins.retrofit2protobuf.SendProtobufToFlipperFromRetrofit;
import com.facebook.flipper.plugins.sections.SectionsFlipperPlugin;
import com.facebook.flipper.plugins.sharedpreferences.SharedPreferencesFlipperPlugin;
import com.facebook.flipper.plugins.uidebugger.core.UIDContext;
import com.facebook.flipper.plugins.uidebugger.litho.UIDebuggerLithoSupport;
import com.facebook.flipper.plugins.jetpackcompose.UIDebuggerComposeSupport;
import com.facebook.imagepipeline.nativecode.Bitmaps;
import com.facebook.imagepipeline.nativecode.NativeBlurFilter;
import com.facebook.imagepipeline.nativecode.NativeJpegTranscoder;
import com.facebook.soloader.SoLoader;
import com.google.protobuf.StringValue;
import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import okhttp3.tls.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import retrofit2.Call;
import retrofit2.http.*;

/** Exercises downloaded release binaries; every payload and certificate is synthetic. */
@RunWith(AndroidJUnit4.class)
public class PublishedPluginsTest {
  private Context context;
  private static final FlipperObject EMPTY = new FlipperObject.Builder().build();

  @Before public void initializeNativeLoader() throws Exception {
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    SoLoader.init(context, false);
  }

  @Test public void sdkStartsAndRegistersPluginsOn16Kb() {
    assertEquals("Run this suite on the 16 KB emulator", 16384, Os.sysconf(OsConstants._SC_PAGESIZE));
    FlipperClient client = AndroidFlipperClient.getInstance(context);
    NetworkFlipperPlugin plugin = new NetworkFlipperPlugin();
    client.addPlugin(plugin);
    assertSame(plugin, client.getPlugin("Network"));
    client.start();
    assertNotNull(client.getState());
    client.removePlugin(plugin);
    assertNull(client.getPlugin("Network"));
    client.stop();
  }

  @Test public void networkCapturesHttpRequestAndResponse() throws Exception { captureNetwork(false); }
  @Test public void networkCapturesTrustedHttpsRequestAndResponse() throws Exception { captureNetwork(true); }

  private void captureNetwork(boolean tls) throws Exception {
    NetworkFlipperPlugin plugin = new NetworkFlipperPlugin();
    Recording connection = new Recording();
    OkHttpClient.Builder builder = new OkHttpClient.Builder()
        .callTimeout(10, TimeUnit.SECONDS).addNetworkInterceptor(new FlipperOkhttpInterceptor(plugin));
    try (MockWebServer server = new MockWebServer()) {
      if (tls) {
        HeldCertificate certificate = new HeldCertificate.Builder().commonName("localhost")
            .addSubjectAlternativeName("localhost").build();
        HandshakeCertificates serverTls = new HandshakeCertificates.Builder().heldCertificate(certificate).build();
        HandshakeCertificates clientTls = new HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate()).build();
        server.useHttps(serverTls.sslSocketFactory(), false);
        builder.sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager());
      }
      server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
          .setResponseCode(201).setBody("{\"synthetic\":true}"));
      server.start();
      plugin.onConnect(connection);
      OkHttpClient http = builder.build();
      try (Response response = http.newCall(new Request.Builder().url(server.url("/synthetic"))
          .post(RequestBody.create("synthetic-request", MediaType.get("text/plain"))).build()).execute()) {
        assertEquals(201, response.code());
        assertEquals("{\"synthetic\":true}", response.body().string());
        assertEquals(tls, response.handshake() != null);
      } finally { http.connectionPool().evictAll(); http.dispatcher().executorService().shutdown(); }
      JSONObject request = connection.last("newRequest");
      JSONObject response = connection.last("newResponse");
      assertEquals("POST", request.getString("method"));
      assertEquals(server.url("/synthetic").toString(), request.getString("url"));
      assertEquals("synthetic-request", decode(request.getString("data")));
      assertEquals(request.getString("id"), response.getString("id"));
      assertEquals(201, response.getInt("status"));
      assertEquals("{\"synthetic\":true}", decode(response.getString("data")));
      assertEquals("synthetic-request", server.takeRequest(5, TimeUnit.SECONDS).getBody().readUtf8());
      plugin.onDisconnect();
    }
  }

  @Test public void legacyLeakCanaryReportsAndClears() throws Exception {
    LeakCanaryFlipperPlugin plugin = new LeakCanaryFlipperPlugin();
    Recording connection = new Recording();
    plugin.reportLeak("Synthetic leaked view");
    plugin.onConnect(connection);
    assertEquals("Synthetic leaked view", connection.last("reportLeak").getJSONArray("leaks").getString(0));
    connection.call("clear", EMPTY);
    plugin.onDisconnect(); plugin.onConnect(connection);
    assertEquals(0, connection.last("reportLeak").getJSONArray("leaks").length());
    plugin.onDisconnect();
  }

  @Test public void leakCanary2ReportsDeduplicatesAndClears() throws Exception {
    LeakCanary2FlipperPlugin plugin = new LeakCanary2FlipperPlugin();
    Recording connection = new Recording();
    plugin.onConnect(connection);
    // The leak model is Kotlin-internal. Reflection feeds a synthetic analyzed leak,
    // avoiding nondeterministic heap dumps and access to real app heaps.
    Class<?> leakClass = Class.forName("com.facebook.flipper.plugins.leakcanary2.Leak");
    Object leak = leakClass.getConstructors()[0].newInstance("Synthetic leak", "root", Collections.emptyMap(), "16 bytes", "synthetic-signature", "Synthetic details");
    Method report = Arrays.stream(plugin.getClass().getMethods()).filter(m -> m.getName().startsWith("reportLeaks$")).findFirst().get();
    report.invoke(plugin, Arrays.asList(leak, leak));
    JSONArray leaks = connection.last("reportLeak2").getJSONArray("leaks");
    assertEquals(1, leaks.length());
    assertEquals("Synthetic leak", leaks.getJSONObject(0).getString("title"));
    connection.call("clear", EMPTY);
    plugin.onDisconnect(); plugin.onConnect(connection);
    assertEquals(0, connection.last("reportLeak2").getJSONArray("leaks").length());
    plugin.onDisconnect();
  }

  public interface ProtoService {
    @POST("synthetic/proto") Call<StringValue> exchange(@Body StringValue request);
  }

  @Test public void retrofitExportsRealProtobufSchemas() throws Exception {
    FlipperClient client = AndroidFlipperClient.getInstance(context);
    NetworkFlipperPlugin plugin = new NetworkFlipperPlugin();
    Recording connection = new Recording();
    client.addPlugin(plugin); plugin.onConnect(connection);
    try {
      SendProtobufToFlipperFromRetrofit.INSTANCE.invoke("https://synthetic.invalid/", ProtoService.class);
      JSONObject definitions = connection.last("addProtobufDefinitions");
      assertEquals(1, definitions.getJSONArray("https://synthetic.invalid/").length());
      assertTrue(definitions.toString(), definitions.toString().contains("google.protobuf.StringValue"));
      assertEquals("synthetic/proto", definitions.getJSONArray("https://synthetic.invalid/").getJSONObject(0).getString("path"));
    } finally { plugin.onDisconnect(); client.removePlugin(plugin); }
  }

  @Test public void lithoSectionsEmitsChangesetAndHierarchy() throws Exception {
    SectionsFlipperPlugin plugin = new SectionsFlipperPlugin(true);
    Recording connection = new Recording();
    plugin.onConnect(connection);
    plugin.onChangesetApplied("CHANGESET", "SyntheticSection", null, false, "synthetic-surface", "synthetic-id",
        new FlipperArray.Builder().build(), EMPTY, new StackTraceElement[0]);
    assertEquals("synthetic-surface", connection.last("addEvent").getString("surface_key"));
    assertEquals("synthetic-id", connection.last("updateTreeGenerationHierarchyGeneration").getString("id"));
    assertEquals("CHANGESET_APPLIED", connection.last("updateTreeGenerationChangesetApplication").getString("type"));
    plugin.onDisconnect();
  }

  @Test public void composeAndLithoRegisterDescriptorsAndLoadArtTooling() {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
      SoLoader.loadLibrary("art_tooling");
      UIDContext uid = UIDContext.Companion.create((Application) context.getApplicationContext());
      UIDebuggerLithoSupport.INSTANCE.enable(uid);
      UIDebuggerComposeSupport.INSTANCE.enable(uid);
      assertFalse(uid.getCustomActionGroups().isEmpty());
      assertTrue(uid.getDescriptorRegister().descriptorForClass(androidx.compose.ui.platform.ComposeView.class)
          .getClass().getName().contains("AbstractComposeViewDescriptor"));
    });
  }

  @Test public void composeAndLithoInspectRenderedViews() throws Exception {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
      UIDContext uid = UIDContext.Companion.create((Application) context.getApplicationContext());
      UIDebuggerComposeSupport.INSTANCE.enable(uid);
      com.facebook.litho.config.ComponentsConfiguration.Companion.setDebugModeEnabled(true);
    });
    try (ActivityScenario<PluginFixtureActivity> activity = ActivityScenario.launch(PluginFixtureActivity.class)) {
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      activity.onActivity(screen -> {
        assertTrue(screen.getComposeView().getWidth() > 0);
        List<Object> nodes = com.facebook.flipper.plugins.jetpackcompose.descriptors.AbstractComposeViewDescriptor.INSTANCE.onGetChildren(screen.getComposeView());
        assertFalse(nodes.isEmpty());
        assertTrue(nodes.toString(), nodes.get(0) instanceof com.facebook.flipper.plugins.jetpackcompose.model.ComposeNode);
        com.facebook.flipper.plugins.inspector.DescriptorMapping mapping = com.facebook.flipper.plugins.inspector.DescriptorMapping.withDefaults();
        com.facebook.litho.editor.flipper.LithoFlipperDescriptors.add(mapping);
        com.facebook.flipper.plugins.inspector.NodeDescriptor descriptor = mapping.descriptorForClass(screen.getLithoView().getClass());
        try {
          assertTrue(screen.getLithoView().getWidth() > 0);
          assertTrue(descriptor.getChildCount(screen.getLithoView()) > 0);
          assertNotNull(descriptor.getChildAt(screen.getLithoView(), 0));
        } catch (Exception error) { throw new AssertionError(error); }
      });
    }
  }

  @Test public void opensslLibrariesLoadOn16Kb() {
    SoLoader.loadLibrary("crypto");
    SoLoader.loadLibrary("ssl");
    SoLoader.loadLibrary("flipper");
  }

  @Test public void navigationSendsSyntheticScreen() throws Exception {
    com.facebook.flipper.plugins.navigation.NavigationFlipperPlugin plugin = com.facebook.flipper.plugins.navigation.NavigationFlipperPlugin.getInstance();
    Recording connection = new Recording(); plugin.onConnect(connection);
    plugin.sendNavigationEvent("synthetic://screen", "SyntheticScreen", new Date(0));
    assertEquals("synthetic://screen", connection.last("nav_event").getString("uri"));
    assertEquals("Hello", connection.call("greet", EMPTY).getString("greeting"));
    plugin.onDisconnect();
  }

  @Test public void crashReporterSendsSyntheticException() {
    com.facebook.flipper.plugins.crashreporter.CrashReporterPlugin plugin = com.facebook.flipper.plugins.crashreporter.CrashReporterPlugin.getInstance();
    Recording connection = new Recording(); plugin.onConnect(connection);
    try {
      plugin.sendExceptionMessage(Thread.currentThread(), new IllegalStateException("Synthetic exception"));
      assertEquals("Synthetic exception", connection.last("crash-report").optString("reason"));
    } finally { plugin.onDisconnect(); }
  }

  @Test public void sandboxListsAndSelectsSyntheticEnvironment() throws Exception {
    final String[] selected = {null};
    com.facebook.flipper.plugins.sandbox.SandboxFlipperPlugin plugin = new com.facebook.flipper.plugins.sandbox.SandboxFlipperPlugin(
      new com.facebook.flipper.plugins.sandbox.SandboxFlipperPluginStrategy() {
        public Map<String, String> getKnownSandboxes() { return Collections.singletonMap("synthetic", "localhost"); }
        public void setSandbox(String value) { selected[0] = value; }
      });
    Recording connection = new Recording(); plugin.onConnect(connection);
    assertEquals("synthetic", connection.call("getSandbox", EMPTY).getJSONArray("array").getJSONObject(0).getString("name"));
    assertTrue(connection.call("setSandbox", new FlipperObject.Builder().put("sandbox", "synthetic").build()).getBoolean("result"));
    assertEquals("synthetic", selected[0]);
    plugin.onDisconnect();
  }

  @Test public void legacyReactCompatibilityPluginRegisters() throws Exception {
    com.facebook.flipper.plugins.react.ReactFlipperPlugin plugin = new com.facebook.flipper.plugins.react.ReactFlipperPlugin();
    assertEquals("React", plugin.getId());
    plugin.onConnect(new Recording());
    plugin.onDisconnect();
    assertTrue(plugin.runInBackground());
  }

  @Test public void databaseQueriesSyntheticRows() throws Exception {
    String name = "synthetic-maven.db";
    try (android.database.sqlite.SQLiteDatabase db = context.openOrCreateDatabase(name, 0, null)) {
      db.execSQL("CREATE TABLE IF NOT EXISTS records (value TEXT)");
      db.execSQL("DELETE FROM records");
      db.execSQL("INSERT INTO records VALUES ('synthetic-row')");
      com.facebook.flipper.plugins.databases.DatabasesFlipperPlugin plugin = new com.facebook.flipper.plugins.databases.DatabasesFlipperPlugin(context);
      Recording connection = new Recording(); plugin.onConnect(connection);
      try {
        JSONArray databases = connection.call("databaseList", EMPTY).getJSONArray("array");
        int id = -1;
        for (int i = 0; i < databases.length(); i++) {
          JSONObject item = databases.getJSONObject(i);
          if (item.getString("name").equals(name)) id = item.getInt("id");
        }
        assertTrue("Synthetic database not listed", id > 0);
        JSONObject rows = connection.call("execute", new FlipperObject.Builder().put("databaseId", id)
            .put("value", "SELECT value FROM records").build());
        assertTrue(rows.toString(), rows.toString().contains("synthetic-row"));
      } finally { plugin.onDisconnect(); }
    } finally { context.deleteDatabase(name); }
  }

  @Test public void yogaCalculatesNativeLayout() {
    com.facebook.yoga.YogaNode node = com.facebook.yoga.YogaNodeFactory.create();
    node.setWidth(123); node.setHeight(45); node.calculateLayout(123, 45);
    assertEquals(123, node.getLayoutWidth(), 0.01f);
    assertEquals(45, node.getLayoutHeight(), 0.01f);
  }

  @Test public void flexlayoutCalculatesNativeLayout() {
    com.facebook.flexlayout.layoutoutput.LayoutOutput<?> result = com.facebook.flexlayout.FlexLayout.calculateLayout(
        new float[0], new float[0][], 123, 123, 45, 45, 123, 45, new com.facebook.flexlayout.styles.FlexItemCallback[0]);
    assertEquals(123, result.getWidth(), 0.01f);
    assertEquals(45, result.getHeight(), 0.01f);
  }

  @Test public void frescoNativeImagepipelineCopiesPixels() {
    Bitmap source = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888);
    Bitmap target = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888);
    try {
      source.eraseColor(Color.RED); Bitmaps.copyBitmap(target, source);
      assertEquals(Color.RED, target.getPixel(8, 8));
    } finally { source.recycle(); target.recycle(); }
  }

  @Test public void frescoImagesPluginListsCacheWithCommunitySdk() throws Exception {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> com.facebook.drawee.backends.pipeline.Fresco.initialize(context));
    com.facebook.flipper.plugins.fresco.FrescoFlipperPlugin plugin = new com.facebook.flipper.plugins.fresco.FrescoFlipperPlugin();
    Recording connection = new Recording(); plugin.onConnect(connection);
    try {
      assertEquals("Fresco", plugin.getId());
      assertTrue(connection.call("listImages", new FlipperObject.Builder().put("showDiskImages", false).build())
          .getJSONArray("levels").length() > 0);
    } finally { plugin.onDisconnect(); }
  }

  @Test public void frescoNativeFilterChangesPixels() {
    Bitmap bitmap = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888);
    try {
      bitmap.eraseColor(Color.BLACK); bitmap.setPixel(8, 8, Color.WHITE);
      NativeBlurFilter.iterativeBoxBlur(bitmap, 1, 2);
      assertNotEquals(Color.WHITE, bitmap.getPixel(8, 8));
      assertNotEquals(Color.BLACK, bitmap.getPixel(8, 8));
    } finally { bitmap.recycle(); }
  }

  @Test public void frescoNativeJpegTranscoderRotatesImage() throws Exception {
    Bitmap source = Bitmap.createBitmap(32, 16, Bitmap.Config.ARGB_8888);
    try {
      source.eraseColor(Color.RED);
      ByteArrayOutputStream input = new ByteArrayOutputStream();
      assertTrue(source.compress(Bitmap.CompressFormat.JPEG, 90, input));
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      NativeJpegTranscoder.transcodeJpeg(new ByteArrayInputStream(input.toByteArray()), output, 90, 8, 90);
      byte[] bytes = output.toByteArray();
      Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
      assertNotNull(decoded);
      try { assertEquals(16, decoded.getWidth()); assertEquals(32, decoded.getHeight()); }
      finally { decoded.recycle(); }
    } finally { source.recycle(); }
  }

  @Test public void sharedPreferencesReadsAndEditsSyntheticValues() throws Exception {
    context.getSharedPreferences("synthetic-test", 0).edit().putString("value", "before").commit();
    SharedPreferencesFlipperPlugin plugin = new SharedPreferencesFlipperPlugin(context, "synthetic-test");
    Recording connection = new Recording(); plugin.onConnect(connection);
    try {
      JSONObject all = connection.call("getAllSharedPreferences", EMPTY);
      assertEquals("before", all.getJSONObject("synthetic-test").getString("value"));
      connection.call("setSharedPreference", new FlipperObject.Builder().put("sharedPreferencesName", "synthetic-test")
          .put("preferenceName", "value").put("preferenceValue", "after").build());
      assertEquals("after", context.getSharedPreferences("synthetic-test", 0).getString("value", ""));
    } finally { plugin.onDisconnect(); context.getSharedPreferences("synthetic-test", 0).edit().clear().commit(); }
  }

  private static String decode(String value) {
    return new String(Base64.decode(value, Base64.DEFAULT), StandardCharsets.UTF_8);
  }

  static final class Recording implements FlipperConnection {
    final Map<String, FlipperReceiver> receivers = new HashMap<>();
    final Map<String, JSONObject> events = new HashMap<>();
    public synchronized void send(String method, FlipperObject object) {
      try { events.put(method, new JSONObject(object.toString())); }
      catch (JSONException error) { throw new AssertionError(error); }
    }
    public void send(String method, FlipperArray array) { throw new AssertionError("Unexpected array: " + method); }
    public void send(String method, String value) { throw new AssertionError("Unexpected string: " + method); }
    public void receive(String method, FlipperReceiver receiver) { receivers.put(method, receiver); }
    public void reportErrorWithMetadata(String reason, String stack) { throw new AssertionError(reason + "\n" + stack); }
    public void reportError(Throwable error) { throw new AssertionError(error); }
    synchronized JSONObject last(String method) { assertTrue("Missing event: " + method, events.containsKey(method)); return events.get(method); }
    JSONObject call(String method, FlipperObject params) throws Exception {
      final JSONObject[] result = {new JSONObject()};
      assertTrue("Missing receiver: " + method, receivers.containsKey(method));
      receivers.get(method).onReceive(params, new FlipperResponder() {
        public void success(FlipperObject value) { try { result[0] = new JSONObject(value.toString()); } catch (JSONException e) { throw new AssertionError(e); } }
        public void success(FlipperArray value) { try { result[0] = new JSONObject().put("array", new JSONArray(value.toString())); } catch (JSONException e) { throw new AssertionError(e); } }
        public void success() { }
        public void error(FlipperObject value) { throw new AssertionError(value.toString()); }
      });
      return result[0];
    }
  }
}

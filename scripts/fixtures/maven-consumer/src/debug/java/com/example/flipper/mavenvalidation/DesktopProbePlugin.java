package com.example.flipper.mavenvalidation;

import com.facebook.flipper.core.*;
import com.facebook.flipper.plugins.network.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;

/** Test-only endpoint: permits requests only to the synthetic loopback HTTP server. */
public final class DesktopProbePlugin implements FlipperPlugin {
  private final NetworkFlipperPlugin network;
  public DesktopProbePlugin(NetworkFlipperPlugin network) { this.network = network; }
  public String getId() { return "MavenValidation"; }
  public boolean runInBackground() { return false; }
  public void onDisconnect() { }
  public void onConnect(FlipperConnection connection) {
    connection.receive("execute", (params, responder) -> {
      HttpUrl url = HttpUrl.get(params.getString("url"));
      if (!url.host().equals("127.0.0.1") || !url.scheme().equals("http")) {
        responder.error(new FlipperObject.Builder().put("error", "Only synthetic loopback HTTP is allowed").build());
        return;
      }
      new Thread(() -> {
        OkHttpClient http = new OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS)
            .addNetworkInterceptor(new FlipperOkhttpInterceptor(network)).build();
        try (Response response = http.newCall(new Request.Builder().url(url).build()).execute()) {
          String body = response.body().string();
          android.util.Log.i("MavenPublishedTest", "Synthetic Maven desktop roundtrip");
          responder.success(new FlipperObject.Builder().put("status", response.code()).put("body", body).build());
        } catch (Exception error) {
          responder.error(new FlipperObject.Builder().put("error", error.toString()).build());
        } finally { http.connectionPool().evictAll(); http.dispatcher().executorService().shutdown(); }
      }, "synthetic-desktop-probe").start();
    });
  }
}

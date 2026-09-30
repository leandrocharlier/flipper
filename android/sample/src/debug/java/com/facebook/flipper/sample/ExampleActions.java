/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.flipper.sample;

import android.util.Log;
import android.app.AlertDialog;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.facebook.flipper.android.AndroidFlipperClient;
import com.facebook.flipper.core.FlipperClient;
import com.facebook.flipper.plugins.example.ExampleFlipperPlugin;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class ExampleActions {

  public static void sendMockRequest(Context context, OkHttpClient client, boolean tls) {
    final String url = tls ? "https://localhost:3001/hello" : "http://localhost:3000/hello";
    // Retains the existing Network interceptor. TLS trust is scoped to localhost
    // in the debug manifest; do not disable certificate or hostname verification.
    final Call call = client.newBuilder().callTimeout(10, TimeUnit.SECONDS).build()
        .newCall(new Request.Builder().url(url).build());
    final AlertDialog dialog = new AlertDialog.Builder(context)
        .setTitle(tls ? "Mock API HTTPS" : "Mock API HTTP")
        .setMessage("Requesting " + url + "…")
        .setPositiveButton("Close", (ignored, which) -> call.cancel())
        .create();
    dialog.setOnCancelListener(ignored -> call.cancel());
    dialog.show();
    final Handler main = new Handler(Looper.getMainLooper());
    call.enqueue(new Callback() {
      @Override
      public void onFailure(Call ignored, IOException error) {
        final String message = url + "\n\n" + error.getClass().getSimpleName() + ": " + error.getMessage()
            + "\n\nStart the example server in Mock API and run adb reverse tcp:"
            + (tls ? "3001 tcp:3001" : "3000 tcp:3000") + ".";
        Log.w("MockAPI", message);
        main.post(() -> { if (dialog.isShowing()) dialog.setMessage(message); });
      }

      @Override
      public void onResponse(Call ignored, Response response) throws IOException {
        try (Response closedResponse = response) {
          final String body = closedResponse.peekBody(65536).string();
          final String message = url + "\n\nHTTP " + closedResponse.code() + "\n\n" + body;
          Log.i("MockAPI", message);
          main.post(() -> { if (dialog.isShowing()) dialog.setMessage(message); });
        }
      }
    });
  }

  public static void sendPostRequest(OkHttpClient client) {
    final RequestBody formBody =
        new FormBody.Builder().add("app", "Flipper").add("remarks", "Its awesome").build();

    final Request request =
        new Request.Builder()
            .url("https://httpbin.org/post")
            .post(formBody)
            .build();

    client
        .newCall(request)
        .enqueue(
            new Callback() {
              @Override
              public void onFailure(final Call call, final IOException e) {
                e.printStackTrace();
                Log.d("Flipper", e.getMessage());
              }

              @Override
              public void onResponse(final Call call, final Response response) throws IOException {
                if (response.isSuccessful()) {
                  Log.d("Flipper", response.body().string());
                } else {
                  Log.d("Flipper", "not successful");
                }
              }
            });
  }

  public static void sendGetRequest(OkHttpClient client) {
    final Request request =
        new Request.Builder().url("https://api.github.com/repos/facebook/yoga").get().build();
    client
        .newCall(request)
        .enqueue(
            new Callback() {
              @Override
              public void onFailure(final Call call, final IOException e) {
                e.printStackTrace();
                Log.d("Flipper", e.getMessage());
              }

              @Override
              public void onResponse(final Call call, final Response response) throws IOException {
                if (response.isSuccessful()) {
                  Log.d("Flipper", response.body().string());
                } else {
                  Log.d("Flipper", "not successful");
                }
              }
            });
  }

  public static void sendNotification() {
    final FlipperClient client = AndroidFlipperClient.getInstanceIfInitialized();
    if (client != null) {
      final ExampleFlipperPlugin plugin = client.getPluginByClass(ExampleFlipperPlugin.class);
      plugin.triggerNotification();
    }
  }
}

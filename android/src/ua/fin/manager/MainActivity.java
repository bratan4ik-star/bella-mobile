package ua.fin.manager;

import android.app.Activity;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.Build;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Обгортка: показує застосунок з assets/ за адресою https://app.local/, дані лишаються на пристрої. */
public class MainActivity extends Activity {
    private static final String HOST = "app.local";
    private static final int REQ_FILE = 1;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    private static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private String accessToken;
    private long accessExpiry;
    private String pendingCb, pendingVerifier, pendingState;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int bg = Color.parseColor("#161826");
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        web = new WebView(this);
        web.setBackgroundColor(bg);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.addJavascriptInterface(new AuthBridge(), "AndroidApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, String url) {
                Uri u = Uri.parse(url);
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    return new WebResourceResponse(mime(path), "UTF-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                            null, new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                // Зовнішні посилання відкриваємо в браузері, а не в застосунку.
                if (HOST.equals(Uri.parse(url).getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Оберіть файл"), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        if (b != null) web.restoreState(b); else web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        Uri u = i.getData();
        if (u == null || pendingCb == null || !redirect().startsWith(u.getScheme() + ":")) return;
        final String cb = pendingCb, verifier = pendingVerifier, state = pendingState;
        pendingCb = null;
        final String code = u.getQueryParameter("code"), err = u.getQueryParameter("error");
        if (code == null || !state.equals(u.getQueryParameter("state"))) {
            done(cb, null, err != null ? err : "вхід скасовано");
            return;
        }
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject r = post("grant_type=authorization_code&code=" + enc(code)
                            + "&code_verifier=" + enc(verifier) + "&client_id=" + enc(clientId())
                            + "&redirect_uri=" + enc(redirect()));
                    done(cb, store(r), r.optString("error_description", r.optString("error", "вхід")));
                } catch (Exception e) {
                    done(cb, null, "немає мережі");
                }
            }
        }).start();
    }

    // ---- Вхід через Google: OAuth 2.0 + PKCE у системному браузері (без бібліотек Google) ----

    private String clientId() {
        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            return ai.metaData == null ? "" : ai.metaData.getString("gclient", "");
        } catch (Exception e) {
            return "";
        }
    }

    private String redirect() {
        return "com.googleusercontent.apps." + clientId().replace(".apps.googleusercontent.com", "") + ":/oauth2redirect";
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("auth", MODE_PRIVATE);
    }

    private static String enc(String v) throws Exception {
        return URLEncoder.encode(v, "UTF-8");
    }

    private static String b64url(byte[] b) {
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private JSONObject post(String form) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("https://oauth2.googleapis.com/token").openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        OutputStream o = c.getOutputStream();
        o.write(form.getBytes("UTF-8"));
        o.close();
        InputStream in = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream();
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return new JSONObject(sb.toString());
    }

    /** Запам'ятовує токени з відповіді Google; повертає access token або null. */
    private String store(JSONObject r) {
        String t = r.optString("access_token", null);
        if (t == null) return null;
        accessToken = t;
        accessExpiry = System.currentTimeMillis() + r.optLong("expires_in", 3600) * 1000;
        String rt = r.optString("refresh_token", null);
        if (rt != null) prefs().edit().putString("rt", rt).apply();
        return t;
    }

    private void done(final String cb, final String token, final String error) {
        runOnUiThread(new Runnable() {
            public void run() {
                web.evaluateJavascript("window.__gAuthCb(" + JSONObject.quote(cb) + ","
                        + (token == null ? "null" : JSONObject.quote(token)) + ","
                        + JSONObject.quote(error == null ? "" : error) + ")", null);
            }
        });
    }

    private void bio(final String cb, final boolean ok) {
        runOnUiThread(new Runnable() {
            public void run() {
                web.evaluateJavascript("window.__bioCb&&window.__bioCb(" + JSONObject.quote(cb) + "," + ok + ")", null);
            }
        });
    }

    private void startSignIn(String cb) throws Exception {
        if (pendingCb != null) done(pendingCb, null, "скасовано");
        SecureRandom rnd = new SecureRandom();
        byte[] v = new byte[32], st = new byte[16];
        rnd.nextBytes(v);
        rnd.nextBytes(st);
        pendingCb = cb;
        pendingVerifier = b64url(v);
        pendingState = b64url(st);
        String challenge = b64url(MessageDigest.getInstance("SHA-256").digest(pendingVerifier.getBytes("US-ASCII")));
        final Uri url = Uri.parse("https://accounts.google.com/o/oauth2/v2/auth?response_type=code"
                + "&client_id=" + enc(clientId()) + "&redirect_uri=" + enc(redirect())
                + "&scope=" + enc(SCOPE) + "&state=" + pendingState
                + "&code_challenge=" + challenge + "&code_challenge_method=S256");
        runOnUiThread(new Runnable() {
            public void run() {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILE || fileCb == null) return;
        Uri[] r = null;
        if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{data.getData()};
        fileCb.onReceiveValue(r);
        fileCb = null;
    }

    @Override
    public void onBackPressed() {
        // Застосунок односторінковий: «Назад» згортає його, а не закриває.
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webmanifest") || p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** Вхід через Google для синхронізації (замість сторінки Google у WebView, яку Google блокує). */
    private class AuthBridge extends Bridge {
        @JavascriptInterface
        public void signIn(final boolean interactive, final String cb) {
            new Thread(new Runnable() {
                public void run() {
                    try {
                        if (clientId().isEmpty()) { done(cb, null, "У цій збірці не задано Client ID Android"); return; }
                        if (accessToken != null && System.currentTimeMillis() < accessExpiry - 60000) { done(cb, accessToken, null); return; }
                        String rt = prefs().getString("rt", null);
                        if (rt != null) {
                            JSONObject r = post("grant_type=refresh_token&refresh_token=" + enc(rt) + "&client_id=" + enc(clientId()));
                            String t = store(r);
                            if (t != null) { done(cb, t, null); return; }
                            if ("invalid_grant".equals(r.optString("error"))) prefs().edit().remove("rt").apply();
                        }
                        if (!interactive) { done(cb, null, "потрібен вхід"); return; }
                        startSignIn(cb);
                    } catch (Exception e) {
                        done(cb, null, "немає мережі");
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public boolean biometricAvailable() {
            if (Build.VERSION.SDK_INT < 29) return false;
            BiometricManager m = getSystemService(BiometricManager.class);
            return m != null && m.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
        }

        /** Запит відбитка/обличчя. Результат: window.__bioCb(id, true|false). */
        @JavascriptInterface
        public void authenticate(final String cb) {
            runOnUiThread(new Runnable() {
                public void run() {
                    final boolean[] sent = {false};
                    final Runnable fail = new Runnable() {
                        public void run() { if (!sent[0]) { sent[0] = true; bio(cb, false); } }
                    };
                    try {
                        BiometricPrompt p = new BiometricPrompt.Builder(MainActivity.this)
                                .setTitle("Розблокування")
                                .setSubtitle("Фінанси")
                                .setNegativeButton("Ввести PIN", getMainExecutor(), new DialogInterface.OnClickListener() {
                                    public void onClick(DialogInterface d, int w) { fail.run(); }
                                }).build();
                        p.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                                if (!sent[0]) { sent[0] = true; bio(cb, true); }
                            }
                            @Override
                            public void onAuthenticationError(int code, CharSequence msg) { fail.run(); }
                        });
                    } catch (Exception e) {
                        fail.run();
                    }
                }
            });
        }

        /** Нагадування: JSON-масив {id, at (мс), title, text}. Запитує дозвіл на сповіщення на Android 13+. */
        @JavascriptInterface
        public void setReminders(final String json) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
                    }
                    Reminders.schedule(MainActivity.this, json);
                }
            });
        }

        @JavascriptInterface
        public void signOut() {
            accessToken = null;
            prefs().edit().remove("rt").apply();
        }
    }

    /** Збереження файлів (копія JSON, експорт CSV) у «Завантаження». */
    private class Bridge {
        @JavascriptInterface
        public void save(final String name, final String text, final String type) {
            try { write(name, text.getBytes("UTF-8"), type); } catch (Exception e) { fail(); }
        }

        /** Бінарні файли (xlsx): вміст передається як base64. */
        @JavascriptInterface
        public void saveBase64(final String name, final String b64, final String type) {
            try { write(name, Base64.decode(b64, Base64.DEFAULT), type); } catch (Exception e) { fail(); }
        }

        private void write(final String name, final byte[] data, final String type) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                        v.put(MediaStore.Downloads.MIME_TYPE, type == null || type.isEmpty() ? "application/octet-stream" : type);
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        OutputStream o = getContentResolver().openOutputStream(uri);
                        o.write(data);
                        o.close();
                        Toast.makeText(MainActivity.this, "Збережено в Завантаження: " + name, Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Не вдалося зберегти файл", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        private void fail() {
            runOnUiThread(new Runnable() {
                public void run() { Toast.makeText(MainActivity.this, "Не вдалося зберегти файл", Toast.LENGTH_LONG).show(); }
            });
        }
    }
}

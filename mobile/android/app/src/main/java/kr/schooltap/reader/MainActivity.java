package kr.schooltap.reader;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String INIT = VehicleNfc.ORIGIN + "/schooltap/native-local-initializer";
    private static final int GPS_PERMISSION = 41;
    private VehicleNfc nfc;
    private WebView web;
    private Uri launchUri;
    private boolean bootstrapping, inSetup, failed;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingOrigin;
    private FrameLayout content;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        nfc = new VehicleNfc(this);
        Uri saved = ReaderSetup.saved(this);
        if (VehicleNfc.isReader(saved)) openReader(saved);
        else showSetup();
    }

    // Edge-to-edge layouts on Android 15+ need insets on both web and setup screens.
    @Override public void setContentView(View view) {
        if (Build.VERSION.SDK_INT < 35) { super.setContentView(view); return; }
        FrameLayout wrapper = new FrameLayout(this);
        wrapper.setBackgroundColor(Color.rgb(255, 253, 247));
        wrapper.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout());
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        wrapper.addView(view);
        super.setContentView(wrapper);
        wrapper.requestApplyInsets();
    }

    private void showSetup() {
        releaseReader();
        inSetup = true;
        ReaderSetup.show(this, this::openReader);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void openReader(Uri uri) {
        if (!VehicleNfc.isReader(uri)) { showSetup(); return; }
        releaseReader();
        launchUri = uri;
        inSetup = false;
        failed = false;
        bootstrapping = true;

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setBackgroundColor(Color.rgb(255, 253, 247));
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), 0, dp(4), 0);
        TextView title = new TextView(this);
        title.setText(R.string.reader_title);
        title.setTextColor(Color.rgb(33, 36, 42));
        title.setTextSize(16);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button menuButton = new Button(this, null, android.R.attr.borderlessButtonStyle);
        menuButton.setText("⋮");
        menuButton.setTextSize(22);
        menuButton.setContentDescription(getString(R.string.device_menu));
        menuButton.setOnClickListener(this::showMenu);
        bar.addView(menuButton, dp(48), dp(48));
        container.addView(bar);
        content = new FrameLayout(this);
        container.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(container);
        web = new WebView(this);
        content.addView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new ReaderClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(
                    String origin, GeolocationPermissions.Callback callback) {
                requestLocation(origin, callback);
            }
            @Override public void onGeolocationPermissionsHidePrompt() { clearPendingLocation(); }
        });
        // Run a local, script-free document first. Clear the old school's web storage
        // before the hosted React app can read it when provisioning a different fleet.
        web.loadDataWithBaseURL(INIT, "<!doctype html><meta charset=utf-8>", "text/html", "UTF-8", INIT);
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(R.string.nfc_settings).setOnMenuItemClickListener(item -> {
            Intent intent = new Intent(Settings.ACTION_NFC_SETTINGS);
            if (intent.resolveActivity(getPackageManager()) == null)
                intent = new Intent(Settings.ACTION_WIRELESS_SETTINGS);
            try { startActivity(intent); } catch (android.content.ActivityNotFoundException unavailable) {
                new AlertDialog.Builder(this).setMessage(R.string.enable_nfc)
                        .setPositiveButton(android.R.string.ok, null).show();
            }
            return true;
        });
        menu.getMenu().add(R.string.change_link).setOnMenuItemClickListener(item -> { showSetup(); return true; });
        menu.show();
    }

    private void prepareSchool(WebView page) {
        final Uri target = launchUri;
        String school = JSONObject.quote(target.getQueryParameter("schoolId"));
        String server = JSONObject.quote(target.getQueryParameter("sbUrl"));
        String prepare = "(function(){try{if(location.origin!=='" + VehicleNfc.ORIGIN
                + "')return false;const school=" + school + ",server=" + server
                + ";const old=localStorage.getItem('schooltap_school_id'),"
                + "db=localStorage.getItem('schooltap_sb_url');"
                + "if((old && old.toUpperCase()!==school.toUpperCase()) || (db && db!==server)){"
                + "localStorage.clear();sessionStorage.clear();}return true;}catch(e){return false;}})()";
        page.evaluateJavascript(prepare, ok -> {
            if (page != web || failed || !bootstrapping) return;
            bootstrapping = false;
            if ("true".equals(ok)) page.loadUrl(target.toString());
            else loadFailed(R.string.storage_error);
        });
    }

    private final class ReaderClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView page, WebResourceRequest req) {
            return req.isForMainFrame() && !VehicleNfc.isReader(req.getUrl());
        }
        @Override public void onPageStarted(WebView page, String url, Bitmap favicon) {
            if (page != web || failed) return;
            nfc.reset();
            clearPendingLocation();
            if (bootstrapping && INIT.equals(url)) return;
            if (!VehicleNfc.isReader(Uri.parse(url))) {
                page.stopLoading();
                loadFailed(R.string.wrong_link);
            }
        }
        @Override public void onPageFinished(WebView page, String url) {
            if (page != web || failed) return;
            if (bootstrapping && INIT.equals(url)) { prepareSchool(page); return; }
            if (VehicleNfc.isReader(Uri.parse(url)) && url.equals(page.getUrl())) nfc.install(page);
        }
        @Override public void onReceivedError(WebView page, WebResourceRequest req, WebResourceError error) {
            if (page == web && req.isForMainFrame()) loadFailed(R.string.network_error);
        }
        @Override public void onReceivedHttpError(WebView page, WebResourceRequest req, WebResourceResponse resp) {
            if (page == web && req.isForMainFrame() && resp.getStatusCode() >= 400)
                loadFailed(R.string.http_error);
        }
        @Override public boolean onRenderProcessGone(WebView page, RenderProcessGoneDetail detail) {
            if (page == web) loadFailed(R.string.render_error);
            return true;
        }
    }

    private void loadFailed(int message) {
        if (failed || inSetup) return;
        failed = true;
        releaseReader();
        LinearLayout notice = new LinearLayout(this);
        notice.setOrientation(LinearLayout.VERTICAL);
        notice.setGravity(Gravity.CENTER);
        notice.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView label = new TextView(this);
        label.setText(message);
        label.setGravity(Gravity.CENTER);
        label.setTextSize(17);
        notice.addView(label);
        Button retry = new Button(this);
        retry.setText(R.string.retry_reader);
        retry.setOnClickListener(v -> openReader(launchUri));
        notice.addView(retry);
        content.addView(notice);
    }

    private void requestLocation(String origin, GeolocationPermissions.Callback callback) {
        clearPendingLocation();
        if (!trustedGpsOrigin(origin)) { callback.invoke(origin, false, false); return; }
        if (locationGranted()) { callback.invoke(origin, true, false); return; }
        pendingLocation = callback;
        pendingOrigin = origin;
        requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION}, GPS_PERMISSION);
    }

    private boolean trustedGpsOrigin(String origin) {
        return (VehicleNfc.ORIGIN.equals(origin) || (VehicleNfc.ORIGIN + "/").equals(origin))
                && web != null && web.getUrl() != null
                && VehicleNfc.isReader(Uri.parse(web.getUrl()));
    }

    private boolean locationGranted() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void clearPendingLocation() {
        if (pendingLocation != null) pendingLocation.invoke(pendingOrigin, false, false);
        pendingLocation = null;
        pendingOrigin = null;
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] result) {
        super.onRequestPermissionsResult(request, permissions, result);
        if (request == GPS_PERMISSION && pendingLocation != null) {
            pendingLocation.invoke(pendingOrigin, trustedGpsOrigin(pendingOrigin) && locationGranted(), false);
            pendingLocation = null;
            pendingOrigin = null;
        }
    }

    private void releaseReader() {
        nfc.reset();
        clearPendingLocation();
        if (web == null) return;
        WebView old = web;
        web = null;
        if (old.getParent() instanceof android.view.ViewGroup)
            ((android.view.ViewGroup) old.getParent()).removeView(old);
        old.destroy();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        nfc.resume();
    }
    @Override protected void onPause() {
        nfc.pause();
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onDestroy() { releaseReader(); super.onDestroy(); }
    @Override public void onBackPressed() {
        if (inSetup && launchUri != null) { openReader(launchUri); return; }
        super.onBackPressed();
    }
}

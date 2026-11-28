package kr.schooltap.reader;

import android.app.Activity;
import android.net.Uri;
import android.nfc.NfcAdapter;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** One foreground NFC session tied to one trusted, top-level reader document. */
final class VehicleNfc {
    static final String ORIGIN = "https://ksyunsai.github.io";
    private final Activity activity;
    private final NfcAdapter adapter;
    private final String script;
    private WebView web;
    private WebMessagePort port;
    private String scanId;
    private boolean resumed, enabled;
    private int documentGeneration, scanGeneration;

    VehicleNfc(Activity activity) {
        this.activity = activity;
        adapter = NfcAdapter.getDefaultAdapter(activity);
        StringBuilder source = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                activity.getAssets().open("reader-bridge.js"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) source.append(line).append('\n');
        } catch (IOException error) {
            throw new IllegalStateException("NFC reader asset missing", error);
        }
        script = source.toString();
    }

    static boolean isReader(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) ||
                !"ksyunsai.github.io".equals(uri.getEncodedAuthority())) return false;
        String path = uri.getEncodedPath();
        return ("/schooltap/".equals(path) || "/schooltap/index.html".equals(path))
                && "READER".equals(uri.getQueryParameter("role"));
    }

    private boolean trustedPage() {
        return web != null && web.getUrl() != null && isReader(Uri.parse(web.getUrl()));
    }

    void install(WebView page) {
        if (web == page && port != null && trustedPage()) return;
        reset();
        web = page;
        if (!trustedPage()) return;
        final int document = documentGeneration;
        String nonce = "schooltap-" + UUID.randomUUID();
        page.evaluateJavascript(script + "(" + JSONObject.quote(nonce) + ")", result -> {
            if (document != documentGeneration || !"true".equals(result) || !trustedPage()) return;
            WebMessagePort[] ports = page.createWebMessageChannel();
            final WebMessagePort documentPort = ports[0];
            port = documentPort;
            documentPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                @Override public void onMessage(WebMessagePort sender, WebMessage message) {
                    if (document != documentGeneration || documentPort != port || !trustedPage()) return;
                    String cmd = message.getData();
                    if (cmd == null || !cmd.matches("(scan|stop):[1-9][0-9]{0,9}")) return;
                    String id = cmd.substring(5);
                    if (cmd.startsWith("scan:")) request(id);
                    else if (id.equals(scanId)) { stopPolling(); scanId = null; }
                }
            });
            page.postWebMessage(new WebMessage(nonce, new WebMessagePort[]{ports[1]}), Uri.parse(ORIGIN));
        });
    }

    void reset() {
        documentGeneration++;
        stopPolling();
        scanId = null;
        if (port != null) { port.close(); port = null; }
        web = null;
    }

    void resume() {
        resumed = true;
        if (scanId != null && trustedPage()) request(scanId);
    }

    void pause() {
        resumed = false;
        stopPolling();
    }

    private void request(String id) {
        stopPolling();
        scanId = id;
        String error = null;
        if (!resumed) error = "InvalidStateError";
        else if (adapter == null) error = "NotSupportedError";
        else if (!adapter.isEnabled()) error = "NotReadableError";
        if (error == null) {
            final int generation = ++scanGeneration;
            try {
                int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
                        | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
                adapter.enableReaderMode(activity, tag -> {
                    byte[] uid = tag.getId();
                    if (uid == null || (uid.length != 4 && uid.length != 7 && uid.length != 10)) return;
                    String serial = formatUid(uid);
                    activity.runOnUiThread(() -> {
                        if (generation == scanGeneration && enabled && resumed && trustedPage())
                            send("tag:" + id + ":" + serial);
                    });
                }, flags, null);
                enabled = true;
                web.setKeepScreenOn(true);
                send("ready:" + id);
                return;
            } catch (IllegalStateException | UnsupportedOperationException | SecurityException ex) {
                error = "NotReadableError";
            }
        }
        scanId = null;
        send("error:" + id + ":" + error);
    }

    static String formatUid(byte[] uid) {
        final String hex = "0123456789ABCDEF";
        StringBuilder out = new StringBuilder(uid.length * 3);
        for (byte value : uid) {
            if (out.length() > 0) out.append(':');
            out.append(hex.charAt((value & 255) >>> 4)).append(hex.charAt(value & 15));
        }
        return out.toString();
    }

    private void send(String data) {
        if (port != null) port.postMessage(new WebMessage(data));
    }

    private void stopPolling() {
        scanGeneration++;
        if (web != null) web.setKeepScreenOn(false);
        if (!enabled) return;
        enabled = false;
        // Toggling NFC or leaving the activity can already have torn down reader mode.
        try { adapter.disableReaderMode(activity); }
        catch (IllegalStateException | UnsupportedOperationException | SecurityException ignored) { }
    }
}

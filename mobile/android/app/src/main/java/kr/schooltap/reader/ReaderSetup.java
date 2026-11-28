package kr.schooltap.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

/** First-use provisioning with the same reader link shown on the SchoolTap administrator page. */
final class ReaderSetup {
    private static final String SITE = "ksyunsai.github.io";
    private static final String PROJECT = "vhwdxgpnubmieytjuaaw";
    private static final String BACKEND = "https://" + PROJECT + ".supabase.co";
    private static final String LINK = "reader_link";
    private static final int INK = Color.rgb(26, 32, 45);
    private static final int SECONDARY = Color.rgb(74, 79, 84);
    private static final int AMBER = Color.rgb(251, 191, 36);
    private static final int CREAM = Color.rgb(255, 253, 247);

    private ReaderSetup() {}

    static Uri saved(Context context) {
        return validated(preferences(context).getString(LINK, ""),
                context.getString(R.string.schooltap_vapid_public_key));
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("schooltap_reader_setup", Context.MODE_PRIVATE);
    }

    /** Rebuild the URL rather than sending arbitrary parameters or fragments to the web app. */
    static Uri validated(String input, String projectPushKey) {
        if (input == null || input.length() > 8192) return null;
        String raw = input.trim();
        try {
            URI checked = new URI(raw);
            String path = checked.getRawPath();
            if (!"https".equalsIgnoreCase(checked.getScheme()) || !SITE.equalsIgnoreCase(checked.getHost())
                    || checked.getRawUserInfo() != null || checked.getRawFragment() != null
                    || (checked.getPort() != -1 && checked.getPort() != 443)
                    || !("/schooltap".equals(path) || "/schooltap/".equals(path) || "/schooltap/index.html".equals(path))) {
                return null;
            }
            Uri source = Uri.parse(raw);
            String role = single(source, "role");
            String school = single(source, "schoolId");
            String server = single(source, "sbUrl");
            String key = single(source, "sbKey");
            String lang = single(source, "lang");
            if (!"READER".equals(role) || school.isEmpty() || school.length() > 160
                    || !school.equals(school.trim()) || school.codePoints().anyMatch(Character::isISOControl)) return null;
            if (!(BACKEND.equals(server) || (BACKEND + "/").equals(server)) || !publicClientKey(key)) return null;
            if (!lang.isEmpty() && !lang.equals("ko") && !lang.equals("en")) return null;
            Uri.Builder result = Uri.parse("https://" + SITE + "/schooltap/").buildUpon()
                    .appendQueryParameter("role", "READER").appendQueryParameter("schoolId", school)
                    .appendQueryParameter("sbUrl", BACKEND).appendQueryParameter("sbKey", key);
            if (!lang.isEmpty()) result.appendQueryParameter("lang", lang);
            // Provisioning targets one project. Its current public key also repairs saved links from 0.1.0.
            String vapid = publicPushKey(projectPushKey);
            if (vapid.isEmpty()) vapid = publicPushKey(single(source, "vapid"));
            if (!vapid.isEmpty()) result.appendQueryParameter("vapid", vapid);
            return result.build();
        } catch (URISyntaxException | IllegalArgumentException | JSONException invalid) {
            return null;
        }
    }

    private static String single(Uri uri, String name) {
        List<String> values = uri.getQueryParameters(name);
        if (values.size() > 1) throw new IllegalArgumentException("Repeated parameter");
        return values.isEmpty() ? "" : values.get(0);
    }

    /** Web Push uses an uncompressed P-256 public point in URL-safe base64. */
    private static String publicPushKey(String candidate) {
        if (!candidate.matches("B[A-Za-z0-9_-]{86}=?")) return "";
        byte[] bytes = Base64.decode(candidate, Base64.URL_SAFE | Base64.NO_WRAP);
        if (bytes.length != 65 || bytes[0] != 4) return "";
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static boolean publicClientKey(String key) throws JSONException {
        if (key.matches("sb_publishable_[A-Za-z0-9_-]{16,256}")) return true;
        if (key.length() > 4096 || !key.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) return false;
        String[] parts = key.split("\\.");
        JSONObject claims = new JSONObject(new String(Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8));
        // The backend authenticates requests; this client-side check prevents accepting an admin/secret key.
        return "anon".equals(claims.optString("role")) && PROJECT.equals(claims.optString("ref"));
    }

    static void show(MainActivity activity, Consumer<Uri> launch) {
        boolean ko = Locale.KOREAN.getLanguage().equals(activity.getResources().getConfiguration().getLocales().get(0).getLanguage());
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setFitsSystemWindows(true);
        scroll.setBackgroundColor(CREAM);
        LinearLayout form = new LinearLayout(activity);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setGravity(Gravity.CENTER_VERTICAL);
        form.setPadding(dp(activity, 24), dp(activity, 32), dp(activity, 24), dp(activity, 32));
        form.setFocusableInTouchMode(true);
        scroll.addView(form);

        TextView title = text(activity, ko ? "스쿨탭 차량 연결" : "Connect your SchoolTap reader", 30, INK, true);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        form.addView(title);
        TextView instructions = text(activity, ko
                ? "스쿨탭 관리자 화면에서 ‘단말기 링크 복사’를 누른 뒤 이곳에 붙여넣으세요."
                : "In the SchoolTap admin screen, tap ‘Copy Reader Link’, then paste the link here.", 16, SECONDARY, false);
        instructions.setLineSpacing(dp(activity, 2), 1);
        form.addView(instructions, row(activity, 12));

        TextView label = text(activity, ko ? "차량 단말기 링크" : "Bus reader link", 15, INK, true);
        form.addView(label, row(activity, 30));
        EditText field = new EditText(activity);
        field.setId(View.generateViewId());
        label.setLabelFor(field.getId());
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD);
        field.setTextSize(16);
        field.setTextColor(INK);
        field.setHintTextColor(SECONDARY);
        field.setHint(ko ? "링크 붙여넣기" : "Paste reader link");
        field.setBackground(box(activity, Color.WHITE, Color.rgb(169, 172, 171)));
        field.setPadding(dp(activity, 14), dp(activity, 10), dp(activity, 14), dp(activity, 10));
        field.setMinHeight(dp(activity, 54));
        field.setSaveEnabled(false);
        if (Build.VERSION.SDK_INT >= 26) field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        field.setImeOptions(EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        form.addView(field, row(activity, 8));

        Button connect = new Button(activity);
        connect.setText(ko ? "차량 단말기 연결" : "Connect reader");
        connect.setAllCaps(false);
        connect.setTextSize(17);
        connect.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        connect.setTextColor(INK);
        connect.setMinHeight(dp(activity, 54));
        connect.setBackground(box(activity, AMBER, AMBER));
        connect.setBackgroundTintList(ColorStateList.valueOf(AMBER));
        form.addView(connect, row(activity, 16));
        connect.setOnClickListener(v -> {
            Uri link = validated(field.getText().toString(), activity.getString(R.string.schooltap_vapid_public_key));
            if (link == null) {
                field.setError(ko ? "관리자 화면에서 복사한 스쿨탭 차량 단말기 링크를 붙여넣으세요."
                        : "Paste the SchoolTap bus reader link copied from the admin screen.");
                field.requestFocus();
                return;
            }
            InputMethodManager keyboard = activity.getSystemService(InputMethodManager.class);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(field.getWindowToken(), 0);
            preferences(activity).edit().putString(LINK, link.toString()).apply();
            field.setText("");
            launch.accept(link);
        });
        field.setOnEditorActionListener((v, id, event) -> id == EditorInfo.IME_ACTION_GO && connect.performClick());
        activity.setContentView(scroll);
    }

    private static TextView text(Context c, String value, int size, int color, boolean bold) {
        TextView view = new TextView(c);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private static GradientDrawable box(Context c, int fill, int stroke) {
        GradientDrawable draw = new GradientDrawable();
        draw.setCornerRadius(dp(c, 12));
        draw.setColor(fill);
        draw.setStroke(dp(c, 1), stroke);
        return draw;
    }

    private static LinearLayout.LayoutParams row(Context c, int topMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(c, topMargin);
        return p;
    }

    private static int dp(Context c, int value) {
        return Math.round(value * c.getResources().getDisplayMetrics().density);
    }
}

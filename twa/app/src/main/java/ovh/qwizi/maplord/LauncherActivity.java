package ovh.qwizi.maplord;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsIntent;

public class LauncherActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Uri uri = Uri.parse("https://maplord.qwizi.ovh/dashboard");

        CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder()
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                .build();

        customTabsIntent.launchUrl(this, uri);
        finish();
    }
}

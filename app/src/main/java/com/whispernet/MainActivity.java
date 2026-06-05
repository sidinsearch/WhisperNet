package com.whispernet;

import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.lifecycle.ViewModelProvider;
import androidx.navigation.NavController;
import androidx.navigation.fragment.NavHostFragment;
import com.whispernet.data.prefs.AppPreferences;
import com.whispernet.databinding.ActivityMainBinding;
import com.whispernet.ui.main.MainViewModel;

/**
 * MainActivity — the single Activity that hosts the Navigation Component.
 *
 * Responsibilities:
 *  1. Apply the saved theme (dark / light) before setContentView.
 *  2. Host the NavHostFragment (login → main).
 *  3. Show / hide the global AlertBanner driven by MainViewModel.securityAlert.
 *
 * All business logic lives in MainViewModel and the Fragments; this class is
 * kept as thin as possible (mirrors the top-level <div> wrappers in App.js).
 */
public class MainActivity extends AppCompatActivity {

    private ActivityMainBinding binding;
    private NavController navController;
    private AppPreferences prefs;
    private MainViewModel mainViewModel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Apply theme before super / setContentView so there is no flicker
        prefs = new AppPreferences(this);
        applyTheme(prefs.isDarkTheme());

        super.onCreate(savedInstanceState);
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        // Navigation
        NavHostFragment navHost = (NavHostFragment) getSupportFragmentManager()
                .findFragmentById(R.id.navHostFragment);
        if (navHost != null) {
            navController = navHost.getNavController();
        }

        // MainViewModel is scoped to the Activity so Fragments can share it
        mainViewModel = new ViewModelProvider(this).get(MainViewModel.class);

        observeAlertBanner();
        observeThemeChanges();
    }

    // =========================================================================
    // THEME
    // =========================================================================

    /**
     * Apply the dark / light mode using AppCompatDelegate (no Activity restart).
     * Mirrors the 'data-theme' attribute toggling in App.js.
     */
    private void applyTheme(boolean isDark) {
        AppCompatDelegate.setDefaultNightMode(
                isDark ? AppCompatDelegate.MODE_NIGHT_YES
                        : AppCompatDelegate.MODE_NIGHT_NO);
    }

    private void observeThemeChanges() {
        mainViewModel.isDarkTheme.observe(this, isDark -> {
            prefs.setTheme(isDark ? "dark" : "light");
            applyTheme(isDark);
        });
    }

    // =========================================================================
    // ALERT BANNER  (mirrors the securityAlert overlay div in App.js)
    // =========================================================================

    private void observeAlertBanner() {
        mainViewModel.securityAlert.observe(this, alert -> {
            if (alert == null) {
                binding.alertBanner.getRoot().setVisibility(View.GONE);
                return;
            }

            // Pick colours based on alert type
            int bgColor, textColor;
            switch (alert.type) {
                case "error":
                    bgColor   = getColor(R.color.alert_error);
                    textColor = android.graphics.Color.WHITE;
                    break;
                case "success":
                    bgColor   = getColor(R.color.alert_success);
                    textColor = android.graphics.Color.WHITE;
                    break;
                case "warning":
                    bgColor   = getColor(R.color.alert_warning);
                    textColor = android.graphics.Color.WHITE;
                    break;
                default: // "info"
                    bgColor   = getColor(R.color.alert_info);
                    textColor = android.graphics.Color.WHITE;
                    break;
            }

            LinearLayout bannerLayout = binding.alertBanner.alertBannerLayout;
            TextView tvMessage = binding.alertBanner.tvAlertMessage;
            ImageButton btnDismiss = binding.alertBanner.btnDismissAlert;

            bannerLayout.setBackgroundColor(bgColor);
            tvMessage.setTextColor(textColor);
            tvMessage.setText(alert.message);
            btnDismiss.setColorFilter(textColor);
            btnDismiss.setOnClickListener(v -> mainViewModel.securityAlert.setValue(null));

            binding.alertBanner.getRoot().setVisibility(View.VISIBLE);

            // Auto-dismiss info alerts after 5 seconds (mirrors the auto-hide in App.js)
            if ("info".equals(alert.type)) {
                binding.alertBanner.getRoot().postDelayed(
                        () -> {
                            if (binding != null) {
                                binding.alertBanner.getRoot().setVisibility(View.GONE);
                            }
                        }, 5000);
            }
        });
    }

    // =========================================================================
    // BACK NAVIGATION
    // =========================================================================

    @Override
    public void onBackPressed() {
        // If NavController can go up, do so; otherwise fall back to default
        if (navController == null || !navController.navigateUp()) {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        binding = null;
    }
}
package com.whispernet.ui.dialogs;

import android.app.Dialog;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.DialogFragment;
import androidx.lifecycle.ViewModelProvider;
import com.whispernet.R;
import com.whispernet.domain.model.VerificationInfo;
import com.whispernet.ui.main.MainViewModel;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * VerificationDialog — full Java port of VerificationModal.js.
 *
 * Three visual modes determined by {@link VerificationInfo#status}:
 *
 * 1. "new_contact"                → blue header, "Verify & Trust Key" + "Cancel"
 * 2. "key_mismatch"|"device_changed" → red header + border, "Confirm New Key" + "Ignore Warning"
 * 3. "verified"                   → green header, "Close" only
 *
 * Opened by MainViewModel.showVerificationDialog LiveData.
 * Results are delivered back to MainViewModel.confirmVerification() /
 * MainViewModel.cancelVerification().
 */
public class VerificationDialog extends DialogFragment {

    private static final String ARG_STATUS               = "status";
    private static final String ARG_MESSAGE              = "message";
    private static final String ARG_CONTACT              = "contact";
    private static final String ARG_FINGERPRINT          = "fingerprint";
    private static final String ARG_PREV_FINGERPRINT     = "prev_fingerprint";
    private static final String ARG_VERIFIED_AT          = "verified_at";

    // =========================================================================
    // FACTORY  (called from MainFragment when showVerificationDialog fires)
    // =========================================================================

    public static VerificationDialog newInstance(VerificationInfo info) {
        VerificationDialog d = new VerificationDialog();
        Bundle args = new Bundle();
        args.putString(ARG_STATUS,           info.status);
        args.putString(ARG_MESSAGE,          info.message);
        args.putString(ARG_CONTACT,          info.contactUsername);
        args.putString(ARG_FINGERPRINT,      info.fingerprint);
        args.putString(ARG_PREV_FINGERPRINT, info.previousFingerprint);
        if (info.verifiedAt != null) args.putLong(ARG_VERIFIED_AT, info.verifiedAt);
        d.setArguments(args);
        return d;
    }

    // =========================================================================
    // BUILD DIALOG
    // =========================================================================

    @NonNull
    @Override
    public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
        // Read arguments
        Bundle args          = getArguments() != null ? getArguments() : new Bundle();
        String status        = args.getString(ARG_STATUS, "");
        String message       = args.getString(ARG_MESSAGE, "");
        String contact       = args.getString(ARG_CONTACT, "");
        String fingerprint   = args.getString(ARG_FINGERPRINT, "");
        String prevFP        = args.getString(ARG_PREV_FINGERPRINT, null);
        long   verifiedAt    = args.getLong(ARG_VERIFIED_AT, 0);

        boolean isWarning    = "key_mismatch".equals(status) || "device_changed".equals(status);
        boolean isNewContact = "new_contact".equals(status);

        // Colour constants — match VerificationModal.js exactly
        int warningColor = 0xFFEF4444;
        int infoColor    = 0xFF3B82F6;
        int successColor = 0xFF22C55E;
        int accentColor  = isWarning ? warningColor : (isNewContact ? infoColor : successColor);

        // Inflate custom layout (dialog_verification.xml)
        View view = LayoutInflater.from(requireContext())
                .inflate(R.layout.dialog_verification, null);

        // --- Header title ---
        TextView tvTitle = view.findViewById(R.id.tvVerificationTitle);
        if (isWarning) {
            tvTitle.setText("⚠️ Identity Verification Warning");
        } else if (isNewContact) {
            tvTitle.setText("New Contact Verification");
        } else {
            tvTitle.setText("Identity Verified");
        }
        tvTitle.setTextColor(accentColor);

        // --- Contact name ---
        TextView tvContact = view.findViewById(R.id.tvContactName);
        tvContact.setText(contact);

        // --- Current fingerprint ---
        TextView tvFP = view.findViewById(R.id.tvFingerprint);
        tvFP.setText(fingerprint != null && !fingerprint.isEmpty() ? fingerprint : "N/A");
        tvFP.setTextColor(infoColor);

        // --- Previous fingerprint (only shown on mismatch) ---
        LinearLayout rowPrevFP = view.findViewById(R.id.rowPrevFingerprint);
        TextView tvPrevFP      = view.findViewById(R.id.tvPrevFingerprint);
        if (prevFP != null && !prevFP.isEmpty()) {
            rowPrevFP.setVisibility(View.VISIBLE);
            tvPrevFP.setText(prevFP);
            tvPrevFP.setTextColor(warningColor);
        } else {
            rowPrevFP.setVisibility(View.GONE);
        }

        // --- Info/warning message box ---
        LinearLayout msgBox  = view.findViewById(R.id.verificationMessageBox);
        TextView tvMessage   = view.findViewById(R.id.tvVerificationMessage);
        if (message != null && !message.isEmpty()) {
            msgBox.setVisibility(View.VISIBLE);
            tvMessage.setText(message);
            tvMessage.setTextColor(isWarning ? warningColor : infoColor);
            // Background tint
            msgBox.setBackgroundColor(isWarning ? 0x1AEF4444 : 0x1A3B82F6);
        } else {
            msgBox.setVisibility(View.GONE);
        }

        // --- "Verified at" timestamp ---
        TextView tvVerifiedAt = view.findViewById(R.id.tvVerifiedAt);
        if (verifiedAt > 0) {
            tvVerifiedAt.setVisibility(View.VISIBLE);
            tvVerifiedAt.setText("Verified: " + formatTime(verifiedAt));
        } else {
            tvVerifiedAt.setVisibility(View.GONE);
        }

        // -------------------------------------------------------------------------
        // Build the AlertDialog and then override buttons for correct colour + action
        // -------------------------------------------------------------------------
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext())
                .setView(view);

        if (isNewContact) {
            builder.setPositiveButton("Verify & Trust Key", null)
                    .setNegativeButton("Cancel", (d, w) -> cancelAndDismiss());
        } else if (isWarning) {
            builder.setPositiveButton("Confirm New Key", null)
                    .setNegativeButton("Ignore Warning", (d, w) -> cancelAndDismiss());
        } else {
            builder.setPositiveButton("Close", (d, w) -> cancelAndDismiss());
        }

        AlertDialog dialog = builder.create();

        // Border colour for the warning state
        if (isWarning && dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(R.drawable.bg_dialog_warning);
        }

        dialog.setOnShowListener(d -> {
            Button positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            Button negative = dialog.getButton(AlertDialog.BUTTON_NEGATIVE);

            if (positive != null) {
                positive.setTextColor(isWarning ? warningColor : (isNewContact ? infoColor : accentColor));
                positive.setOnClickListener(v -> confirmAndDismiss(contact));
            }
            if (negative != null) {
                negative.setTextColor(requireContext().getColor(R.color.text_secondary));
            }
        });

        return dialog;
    }

    // =========================================================================
    // ACTIONS → MainViewModel
    // =========================================================================

    private void confirmAndDismiss(String contactUsername) {
        MainViewModel vm = new ViewModelProvider(requireActivity()).get(MainViewModel.class);
        vm.confirmVerification(contactUsername);
        dismiss();
    }

    private void cancelAndDismiss() {
        MainViewModel vm = new ViewModelProvider(requireActivity()).get(MainViewModel.class);
        vm.cancelVerification();
        dismiss();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private String formatTime(long timestamp) {
        return new SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault())
                .format(new Date(timestamp));
    }
}
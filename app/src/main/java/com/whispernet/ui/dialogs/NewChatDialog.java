package com.whispernet.ui.dialogs;

import android.app.Dialog;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.DialogFragment;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.whispernet.R;

/**
 * NewChatDialog — mirrors the "new-chat-dialog" overlay in UserList.js.
 *
 * Shows:
 *  • Title: "New Conversation"
 *  • Body:  "Enter the username you want to message:"
 *  • TextInput for the username
 *  • Cancel + Start buttons
 *
 * Delivers the result via the {@link Listener} interface so the host
 * Fragment (ContactsFragment) can call viewModel.startNewChat().
 */
public class NewChatDialog extends DialogFragment {

    // -------------------------------------------------------------------------
    // Listener interface
    // -------------------------------------------------------------------------

    public interface Listener {
        /** Called when the user confirms with a non-empty, trimmed username */
        void onNewChatStarted(String contactUsername);
    }

    private Listener listener;

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    // -------------------------------------------------------------------------
    // Build the dialog
    // -------------------------------------------------------------------------

    @NonNull
    @Override
    public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
        // Inflate the custom layout (dialog_new_chat.xml)
        View dialogView = LayoutInflater.from(requireContext())
                .inflate(R.layout.dialog_new_chat, null);

        TextInputLayout   tilUsername = dialogView.findViewById(R.id.tilNewChatUsername);
        TextInputEditText etUsername  = dialogView.findViewById(R.id.etNewChatUsername);

        AlertDialog dialog = new AlertDialog.Builder(requireContext())
                .setView(dialogView)
                .setTitle("New Conversation")
                .setPositiveButton("Start", null)
                .setNegativeButton("Cancel", (d, w) -> dismiss())
                .create();

        dialog.setOnShowListener(d -> {
            // Override positive button to validate before dismissing
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String input = etUsername.getText() != null
                        ? etUsername.getText().toString().trim() : "";

                if (input.isEmpty()) {
                    tilUsername.setError("Please enter a username");
                    return;
                }

                tilUsername.setError(null);
                if (listener != null) {
                    listener.onNewChatStarted(input);
                }
                dismiss();
            });

            // Clear error on typing
            if (etUsername.getText() != null) {
                etUsername.addTextChangedListener(new TextWatcher() {
                    @Override public void beforeTextChanged(CharSequence s, int i, int c, int a) {}
                    @Override public void onTextChanged(CharSequence s, int i, int b, int c) {
                        tilUsername.setError(null);
                    }
                    @Override public void afterTextChanged(Editable s) {}
                });
            }

            // Focus and show keyboard automatically
            etUsername.requestFocus();
        });

        return dialog;
    }
}
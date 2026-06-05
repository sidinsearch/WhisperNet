package com.whispernet.ui.main;

import android.content.res.Configuration;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import com.whispernet.R;
import com.whispernet.databinding.FragmentMainBinding;
import com.whispernet.ui.chat.ChatFragment;
import com.whispernet.ui.contacts.ContactsFragment;

/**
 * MainFragment — the shell that hosts:
 *  • The App Header (logo, theme toggle, connection badge, About button)
 *  • On phones  : either ContactsFragment OR ChatFragment (swapped on chat select)
 *  • On tablets : ContactsFragment on the left, ChatFragment on the right
 *
 * Mirrors the outer <div class="app-container"> and the two-column layout in App.js.
 */
public class MainFragment extends Fragment {

    private FragmentMainBinding binding;
    private MainViewModel viewModel;
    private boolean isTablet;

    // Fragment tags for the content container
    private static final String TAG_CONTACTS = "contacts";
    private static final String TAG_CHAT     = "chat";

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {
        binding = FragmentMainBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }


    @Override
    public void onViewCreated(@NonNull View view,
                              @Nullable Bundle savedInstanceState) {

        super.onViewCreated(view, savedInstanceState);

        // Shared ViewModel scoped to the Activity
        viewModel = new ViewModelProvider(requireActivity())
                .get(MainViewModel.class);

        // IMPORTANT:
        // Refresh activeChats switchMap with latest logged-in username
        viewModel.refreshCurrentUser();

        // Detect tablet layout (sw600dp qualifier or landscape phone)
        isTablet = getResources().getConfiguration().smallestScreenWidthDp >= 600;

        setupHeader();
        setupContentArea(savedInstanceState);
        observeViewModel();
    }


    // =========================================================================
    // HEADER SETUP  (mirrors the <header> section in App.js JSX)
    // =========================================================================

    private void setupHeader() {
        // Theme toggle button
        Button btnTheme = binding.btnThemeToggle;
        updateThemeButton(Boolean.TRUE.equals(viewModel.isDarkTheme.getValue()));
        btnTheme.setOnClickListener(v -> viewModel.toggleTheme());

        // About button
        binding.btnAbout.setOnClickListener(v -> showAboutDialog());

        // Connection badge — tapping shows a status toast / info
        binding.connectionBadge.setOnClickListener(v -> showConnectionInfo());
    }

    private void updateThemeButton(boolean isDark) {
        binding.btnThemeToggle.setText(isDark ? "☀ Light" : "🌙 Dark");
    }

    // =========================================================================
    // CONTENT AREA  (ContactsFragment + optional ChatFragment)
    // =========================================================================

    private void setupContentArea(@Nullable Bundle savedState) {
        if (savedState == null) {
            // Always start with Contacts pane
            getChildFragmentManager().beginTransaction()
                    .replace(R.id.mainContentContainer, new ContactsFragment(), TAG_CONTACTS)
                    .commit();
        }
    }

    /**
     * Switch the content area to the ChatFragment for the given recipient.
     * On tablets the ContactsFragment stays on the left; on phones it is replaced.
     */
    private void showChatFragment(String contactUsername) {

        ChatFragment chatFragment =
                ChatFragment.newInstance(contactUsername);

        getChildFragmentManager().beginTransaction()
                .replace(R.id.mainContentContainer, chatFragment, TAG_CHAT)
                .addToBackStack(null)
                .commit();
    }

    /** Restore the contacts list (phone only, mirrors closeChat in App.js) */
    private void showContactsFragment() {
        if (!isTablet) {
            getChildFragmentManager().popBackStack();
        } else {
            // On tablets just clear the chat pane
            Fragment chatFrag = getChildFragmentManager().findFragmentByTag(TAG_CHAT);
            if (chatFrag != null) {
                getChildFragmentManager().beginTransaction().remove(chatFrag).commit();
            }
        }
    }

    // =========================================================================
    // OBSERVE VIEWMODEL
    // =========================================================================

    private void observeViewModel() {

        // Theme changes → update toggle button label + status dot colour
        viewModel.isDarkTheme.observe(getViewLifecycleOwner(), this::updateThemeButton);

        // Relay status → update the header connection badge
        viewModel.relayStatus.observe(getViewLifecycleOwner(), status -> {
            TextView tvStatus = binding.tvConnectionStatus;
            View statusDot    = binding.statusDot;

            switch (status) {
                case "online":
                    tvStatus.setText("Connected");
                    statusDot.setBackgroundResource(R.drawable.shape_circle_online);
                    break;
                case "offline":
                case "error":
                    tvStatus.setText("Offline");
                    statusDot.setBackgroundColor(requireContext().getColor(R.color.status_offline));
                    break;
                default: // "checking"
                    tvStatus.setText("Connecting…");
                    statusDot.setBackgroundColor(requireContext().getColor(R.color.status_away));
                    break;
            }
        });

        // Current chat changes → open / close ChatFragment
        viewModel.currentChat.observe(getViewLifecycleOwner(), chatUsername -> {
            if (chatUsername != null) {
                showChatFragment(chatUsername);
            } else {
                showContactsFragment();
            }
        });

        // Chats cleared → pop any open chat back stack
        viewModel.chatsCleared.observe(getViewLifecycleOwner(), cleared -> {
            if (Boolean.TRUE.equals(cleared)) {
                getChildFragmentManager().popBackStack(null,
                        androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE);
                viewModel.chatsCleared.setValue(false);
            }
        });

        // Verification dialog
        viewModel.showVerificationDialog.observe(getViewLifecycleOwner(), info -> {
            if (info != null) {
                com.whispernet.ui.dialogs.VerificationDialog dialog =
                        com.whispernet.ui.dialogs.VerificationDialog.newInstance(info);
                dialog.show(getChildFragmentManager(), "verification");
            }
        });
    }

    // =========================================================================
    // DIALOGS
    // =========================================================================

    /**
     * "About" dialog — mirrors the showAboutPage state in App.js.
     */
    private void showAboutDialog() {
        new AlertDialog.Builder(requireContext())
                .setTitle("WhisperNet")
                .setMessage(
                        "Secure, Decentralized Messaging\n\n" +
                                "• End-to-End Encrypted (RSA-OAEP 2048-bit)\n" +
                                "• No central message storage\n" +
                                "• No account required\n" +
                                "• Distributed relay network\n" +
                                "• Identity key verification\n\n" +
                                "github.com/sidinsearch/WhisperNet"
                )
                .setPositiveButton("Close", null)
                .show();
    }

    /**
     * Connection info sheet — mirrors showConnectionInfo state in App.js.
     */
    private void showConnectionInfo() {
        String statusVal = viewModel.relayStatus.getValue();
        String info = "Relay Status: " + (statusVal != null ? statusVal : "unknown") + "\n"
                + "Username: " + viewModel.getMyUsername();

        new AlertDialog.Builder(requireContext())
                .setTitle("Connection Info")
                .setMessage(info)
                .setPositiveButton("OK", null)
                .show();
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}
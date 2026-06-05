package com.whispernet.ui.chat;

import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import com.whispernet.R;
import com.whispernet.databinding.FragmentChatBinding;
import com.whispernet.domain.model.VerificationInfo;
import com.whispernet.ui.main.MainViewModel;

/**
 * ChatFragment — the full-screen chat pane.
 *
 * Mirrors the <ChatBox> component (ChatBox.js):
 *  • Chat header: avatar, name, online/offline status, verification badge, close button
 *  • Messages RecyclerView (sent / received bubbles)
 *  • Typing indicator
 *  • Message input bar with Send + Relay buttons
 *
 * Business logic (send, relay, verify) is delegated to MainViewModel.
 * Per-chat state (message list) is in ChatViewModel.
 */
public class ChatFragment extends Fragment {

    // Fragment argument key
    private static final String ARG_RECIPIENT = "recipient";

    private FragmentChatBinding binding;
    private MainViewModel mainViewModel;
    private ChatViewModel chatViewModel;
    private MessageAdapter messageAdapter;
    private String recipientUsername;

    // =========================================================================
    // FACTORY
    // =========================================================================

    public static ChatFragment newInstance(String recipientUsername) {
        ChatFragment fragment = new ChatFragment();
        Bundle args = new Bundle();
        args.putString(ARG_RECIPIENT, recipientUsername);
        fragment.setArguments(args);
        return fragment;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {
        binding = FragmentChatBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        // Read recipient from arguments
        if (getArguments() != null) {
            recipientUsername = getArguments().getString(ARG_RECIPIENT, "");
        }

        // ViewModels
        mainViewModel = new ViewModelProvider(requireActivity()).get(MainViewModel.class);
        chatViewModel = new ViewModelProvider(this).get(ChatViewModel.class);
        chatViewModel.setRecipient(recipientUsername);

        setupHeader();
        setupMessageList();
        setupInputBar();
        observeViewModel();
    }

    // =========================================================================
    // HEADER  (mirrors chat-header div in ChatBox.js)
    // =========================================================================

    private void setupHeader() {
        // Avatar letter
        if (recipientUsername != null && !recipientUsername.isEmpty()) {
            binding.tvChatAvatar.setText(
                    String.valueOf(Character.toUpperCase(recipientUsername.charAt(0))));
        }

        // Recipient name
        binding.tvChatRecipient.setText(recipientUsername);

        // Close button — mirrors btn-close-chat onClick → closeChat()
        binding.btnCloseChat.setOnClickListener(v -> mainViewModel.closeChat());

        // Verification badge — mirrors verificationStatus badge onClick
        binding.tvVerificationBadge.setOnClickListener(v ->
                mainViewModel.requestVerification(recipientUsername));
    }

    // =========================================================================
    // MESSAGE LIST
    // =========================================================================

    private void setupMessageList() {
        String myUsername = chatViewModel.getOwnerUsername();
        messageAdapter = new MessageAdapter(myUsername);

        LinearLayoutManager layoutManager = new LinearLayoutManager(requireContext());
        layoutManager.setStackFromEnd(true); // newest at bottom
        binding.rvMessages.setLayoutManager(layoutManager);
        binding.rvMessages.setAdapter(messageAdapter);
    }

    // =========================================================================
    // INPUT BAR  (mirrors message-input-container in ChatBox.js)
    // =========================================================================

    private void setupInputBar() {

        // Track typing for the Send button and for sending typing indicators
        binding.etMessage.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int i, int c, int a) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                chatViewModel.onInputChanged(s.toString());
                // Send typing indicator to recipient (mirrors onMessageChange in ChatBox.js)
                if (s.length() > 0 && recipientUsername != null) {
                    mainViewModel.sendTypingIndicator(recipientUsername);
                }
            }

            @Override public void afterTextChanged(Editable s) {}
        });

        // Send button — mirrors handleSend() in ChatBox.js
        binding.btnSend.setOnClickListener(v -> {
            String text = getInputText();
            if (text.isEmpty()) return;
            mainViewModel.sendMessage(recipientUsername, text);
            clearInput();
        });

        // Also send on IME "Send" action
        binding.etMessage.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                String text = getInputText();
                if (!text.isEmpty()) {
                    mainViewModel.sendMessage(recipientUsername, text);
                    clearInput();
                }
                return true;
            }
            return false;
        });

        // Relay button — mirrors handleRelay() in ChatBox.js
        // Shows a confirmation dialog before sending (mirrors window.confirm in App.js)
        binding.btnRelay.setOnClickListener(v -> {
            String text = getInputText();
            if (text.isEmpty()) return;
            showRelayConfirmDialog(text);
        });
    }

    // =========================================================================
    // OBSERVE VIEWMODEL
    // =========================================================================

    private void observeViewModel() {

        // --- Message list ---
        if (chatViewModel.getMessages() != null) {
            chatViewModel.getMessages().observe(getViewLifecycleOwner(), messages -> {
                if (messages != null) {
                    messageAdapter.submitList(messages);
                    // Scroll to bottom on new message
                    if (!messages.isEmpty()) {
                        binding.rvMessages.scrollToPosition(messages.size() - 1);
                    }
                }
            });
        }

        // --- Online status → header avatar colour + status dot ---
        mainViewModel.onlineStatusMap.observe(getViewLifecycleOwner(), map -> {
            boolean online = (map != null && Boolean.TRUE.equals(map.get(recipientUsername)));
            updateOnlineStatus(online);
        });

        // --- Typing indicator ---
        mainViewModel.typingUsers.observe(getViewLifecycleOwner(), typingMap -> {
            boolean isTyping = (typingMap != null
                    && Boolean.TRUE.equals(typingMap.get(recipientUsername)));
            if (isTyping) {

                binding.typingIndicator.getRoot().setVisibility(View.VISIBLE);

                binding.typingIndicator.tvTypingText
                        .setText(recipientUsername + " is typing…");

            } else {

                binding.typingIndicator.getRoot().setVisibility(View.GONE);

            }
        });

        // --- Verification status → badge label + colour ---
        mainViewModel.verificationStatuses.observe(getViewLifecycleOwner(), statusMap -> {
            if (statusMap == null) return;
            VerificationInfo info = statusMap.get(recipientUsername);
            updateVerificationBadge(info);
        });

        // --- Can send → enable/disable Send button ---
        chatViewModel.canSend.observe(getViewLifecycleOwner(), canSend -> {
            // Note: Send is always visually enabled; we just grey it when offline
            // (mirrors the disabled={!recipientStatus.online} in ChatBox.js)
        });

        // --- Online status also gates the Send button ---
        mainViewModel.onlineStatusMap.observe(getViewLifecycleOwner(), map -> {
            boolean online = (map != null && Boolean.TRUE.equals(map.get(recipientUsername)));
            binding.btnSend.setAlpha(online ? 1f : 0.5f);
            binding.btnSend.setEnabled(online);
        });
    }

    // =========================================================================
    // ONLINE STATUS UI UPDATE  (mirrors chat-avatar / status-dot in ChatBox.js)
    // =========================================================================

    private void updateOnlineStatus(boolean online) {
        // Avatar background: gradient if online, grey if offline
        if (online) {
            binding.tvChatAvatar.setBackgroundResource(R.drawable.shape_circle_online);
            binding.tvChatAvatar.setTextColor(requireContext().getColor(R.color.text_inverse));
        } else {
            binding.tvChatAvatar.setBackgroundResource(R.drawable.shape_circle);
            binding.tvChatAvatar.setTextColor(requireContext().getColor(R.color.text_secondary));
        }

        // Status dot colour
        int dotColor = online
                ? requireContext().getColor(R.color.status_online)
                : requireContext().getColor(R.color.status_offline);
        GradientDrawable dot = (GradientDrawable) binding.statusDotChat.getBackground().mutate();
        dot.setColor(dotColor);

        // Status text
        binding.tvChatStatus.setText(online ? "Online" : "Offline");
        binding.tvChatStatus.setTextColor(online
                ? requireContext().getColor(R.color.status_online)
                : requireContext().getColor(R.color.text_muted));
    }

    // =========================================================================
    // VERIFICATION BADGE  (mirrors verification-badge in ChatBox.js)
    // =========================================================================

    private void updateVerificationBadge(@Nullable VerificationInfo info) {
        binding.tvVerificationBadge.setVisibility(View.VISIBLE);
        if (info != null && info.isVerified()) {
            binding.tvVerificationBadge.setText("✓ Verified");
            binding.tvVerificationBadge.setTextColor(
                    requireContext().getColor(R.color.verified_color));
        } else {
            binding.tvVerificationBadge.setText("⚠ Unverified");
            binding.tvVerificationBadge.setTextColor(
                    requireContext().getColor(R.color.unverified_color));
        }
    }

    // =========================================================================
    // RELAY CONFIRMATION DIALOG
    // Mirrors window.confirm() in the onRelayMessage handler (App.js)
    // =========================================================================

    private void showRelayConfirmDialog(String messageText) {
        String msg = "RELAY MESSAGE\n\n" +
                "Your message to \"" + recipientUsername + "\" will be securely encrypted " +
                "and will continuously bounce across the relay network\n" +
                "until " + recipientUsername + " comes online or registers with the network.\n\n" +
                "It will not be stored at any single point for long, ensuring privacy " +
                "and delivery reliability.\n\nDo you want to continue?";

        new AlertDialog.Builder(requireContext())
                .setTitle("Relay Message")
                .setMessage(msg)
                .setPositiveButton("Send via Relay", (dialog, which) -> {
                    mainViewModel.sendRelayMessage(recipientUsername, messageText);
                    clearInput();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private String getInputText() {
        Editable e = binding.etMessage.getText();
        return e != null ? e.toString().trim() : "";
    }

    private void clearInput() {
        binding.etMessage.setText("");
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
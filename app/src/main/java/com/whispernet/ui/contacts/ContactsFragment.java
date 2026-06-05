package com.whispernet.ui.contacts;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import com.whispernet.R;
import com.whispernet.databinding.FragmentContactsBinding;
import com.whispernet.domain.model.Chat;
import com.whispernet.ui.dialogs.NewChatDialog;
import com.whispernet.ui.main.MainViewModel;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * ContactsFragment — the sidebar / contacts pane.
 *
 * Mirrors the <UserList> component from UserList.js:
 *  • Displays "Logged in as <username>"
 *  • "CONTACTS" header with "+ New Chat" and "Clear" buttons
 *  • Sectioned list: Online contacts first, then Offline
 *  • Unread badge on each item
 *  • Last-message preview
 */
public class ContactsFragment extends Fragment implements NewChatDialog.Listener {

    private FragmentContactsBinding binding;
    private MainViewModel viewModel;
    private ContactsAdapter adapter;

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {
        binding = FragmentContactsBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        // Shared ViewModel — scoped to the Activity
        viewModel = new ViewModelProvider(requireActivity()).get(MainViewModel.class);

        setupProfileSection();
        setupRecyclerView();
        setupButtons();
        observeViewModel();
    }

    // =========================================================================
    // UI SETUP
    // =========================================================================

    /** Shows "Logged in as <username>" at the top — mirrors user-profile div */
    private void setupProfileSection() {
        binding.tvUsername.setText(viewModel.getMyUsername());
    }

    private void setupRecyclerView() {
        adapter = new ContactsAdapter(contactUsername -> {
            // Tap on a contact → open chat
            viewModel.openChat(contactUsername);
        });
        binding.rvContacts.setLayoutManager(new LinearLayoutManager(requireContext()));
        binding.rvContacts.setAdapter(adapter);
    }

    private void setupButtons() {
        // "+ New Chat" — mirrors the btn-new-chat button
        binding.btnNewChat.setOnClickListener(v -> {
            NewChatDialog dialog = new NewChatDialog();
            dialog.setListener(this);
            dialog.show(getChildFragmentManager(), "newChat");
        });

        // "Clear" — mirrors the btn-clear button + handleClearAllHistory in App.js
        binding.btnClear.setOnClickListener(v -> showClearConfirmDialog());
    }

    // =========================================================================
    // OBSERVE VIEWMODEL
    // =========================================================================

    private void observeViewModel() {


        viewModel.activeChats.observe(getViewLifecycleOwner(), chats -> {

            android.util.Log.d(
                    "SESSION",
                    "Contacts showing for = "
                            + viewModel.getMyUsername()
            );

            if (chats == null || chats.isEmpty()) {
                showEmptyState(true);
                return;
            }

            showEmptyState(false);

            // Apply online status from the socket-driven onlineStatusMap
            Map<String, Boolean> onlineMap = viewModel.onlineStatusMap.getValue();

            List<Chat> enriched = new ArrayList<>();

            for (Chat c : chats) {

                boolean isOnline =
                        (onlineMap != null
                                && Boolean.TRUE.equals(
                                onlineMap.get(c.contactUsername)
                        ));

                enriched.add(
                        new Chat(
                                c.contactUsername,
                                c.lastMessage,
                                c.lastMessageTime,
                                c.unreadCount,
                                isOnline
                        )
                );
            }

            // Sort: online first, then offline
            enriched.sort((a, b) -> {

                if (a.isOnline == b.isOnline) return 0;

                return a.isOnline ? -1 : 1;
            });

            adapter.submitList(enriched);

            // Highlight current chat
            String current = viewModel.currentChat.getValue();

            adapter.setActiveChat(current);
        });


        // Online status changes → re-sort / re-render
        viewModel.onlineStatusMap.observe(getViewLifecycleOwner(), map -> {
            List<Chat> current = viewModel.activeChats.getValue();
            if (current != null) {
                // Trigger re-submission with updated online flags
                List<Chat> enriched = new ArrayList<>();
                for (Chat c : current) {
                    boolean isOnline = (map != null && Boolean.TRUE.equals(map.get(c.contactUsername)));
                    enriched.add(new Chat(c.contactUsername, c.lastMessage,
                            c.lastMessageTime, c.unreadCount, isOnline));
                }
                enriched.sort((a, b) -> {
                    if (a.isOnline == b.isOnline) return 0;
                    return a.isOnline ? -1 : 1;
                });
                adapter.submitList(enriched);
            }
        });

        // Current chat → highlight active item
        viewModel.currentChat.observe(getViewLifecycleOwner(), chatUsername ->
                adapter.setActiveChat(chatUsername));
    }

    // =========================================================================
    // EMPTY STATE
    // =========================================================================

    private void showEmptyState(boolean show) {
        binding.rvContacts.setVisibility(show ? View.GONE : View.VISIBLE);
    }

    // =========================================================================
    // CLEAR CONFIRM DIALOG
    // Mirrors the window.confirm() chain in handleClearAllHistory() (App.js)
    // =========================================================================

    private void showClearConfirmDialog() {
        new AlertDialog.Builder(requireContext())
                .setTitle("Clear Chat History")
                .setMessage("Are you sure you want to clear all chat history? This cannot be undone.")
                .setPositiveButton("Clear", (dialog, which) -> showClearKeysDialog())
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showClearKeysDialog() {
        new AlertDialog.Builder(requireContext())
                .setTitle("Clear Verification Keys?")
                .setMessage(
                        "Do you also want to clear all identity verification keys?\n\n" +
                                "YES → you will need to re-verify all contacts.\n" +
                                "NO  → contacts remain verified but chat history is cleared."
                )
                .setPositiveButton("Yes, clear keys",
                        (d, w) -> viewModel.clearAllHistory(true))
                .setNegativeButton("No, keep keys",
                        (d, w) -> viewModel.clearAllHistory(false))
                .show();
    }

    // =========================================================================
    // NewChatDialog.Listener
    // =========================================================================

    @Override
    public void onNewChatStarted(String contactUsername) {
        viewModel.startNewChat(contactUsername);
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
package com.whispernet.ui.contacts;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.DiffUtil;
import androidx.recyclerview.widget.ListAdapter;
import androidx.recyclerview.widget.RecyclerView;
import com.whispernet.R;
import com.whispernet.domain.model.Chat;

public class ContactsAdapter extends ListAdapter<Chat, ContactsAdapter.ViewHolder> {

    public interface OnContactClickListener {
        void onClick(String username);
    }

    private final OnContactClickListener listener;
    private String activeChat = null;

    public ContactsAdapter(OnContactClickListener listener) {
        super(DIFF_CALLBACK);
        this.listener = listener;
    }

    public void setActiveChat(String username) {
        this.activeChat = username;
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_contact, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Chat chat = getItem(position);
        holder.bind(chat, chat.contactUsername.equals(activeChat));
        holder.itemView.setOnClickListener(v -> listener.onClick(chat.contactUsername));
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvAvatarLetter, tvContactName, tvLastMessage, tvUnreadBadge;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvAvatarLetter  = itemView.findViewById(R.id.tvAvatarLetter);
            tvContactName   = itemView.findViewById(R.id.tvContactName);
            tvLastMessage   = itemView.findViewById(R.id.tvLastMessage);
            tvUnreadBadge   = itemView.findViewById(R.id.tvUnreadBadge);
        }

        void bind(Chat chat, boolean isActive) {
            String letter = String.valueOf(Character.toUpperCase(chat.contactUsername.charAt(0)));
            tvAvatarLetter.setText(letter);
            tvContactName.setText(chat.contactUsername);

            // Avatar background: gradient if online, grey if offline
            if (chat.isOnline) {
                tvAvatarLetter.setBackgroundResource(R.drawable.shape_circle_online);
                tvAvatarLetter.setTextColor(itemView.getContext().getColor(R.color.text_inverse));
            } else {
                tvAvatarLetter.setBackgroundResource(R.drawable.shape_circle);
                tvAvatarLetter.setTextColor(itemView.getContext().getColor(R.color.text_secondary));
            }

            // Last message preview
            if (chat.lastMessage != null && !chat.lastMessage.isEmpty()) {
                tvLastMessage.setVisibility(View.VISIBLE);
                String preview = chat.lastMessage.length() > 30
                        ? chat.lastMessage.substring(0, 30) + "..."
                        : chat.lastMessage;
                tvLastMessage.setText(preview);
            } else {
                tvLastMessage.setVisibility(View.GONE);
            }

            // Unread badge
            if (chat.unreadCount > 0) {
                tvUnreadBadge.setVisibility(View.VISIBLE);
                tvUnreadBadge.setText(String.valueOf(chat.unreadCount));
                int badgeColor = chat.isOnline
                        ? itemView.getContext().getColor(R.color.accent_primary)
                        : itemView.getContext().getColor(R.color.status_away);
                ((GradientDrawable) tvUnreadBadge.getBackground().mutate()).setColor(badgeColor);
            } else {
                tvUnreadBadge.setVisibility(View.GONE);
            }

            // Active state background
            itemView.setBackgroundResource(isActive
                    ? R.drawable.bg_user_item_active
                    : android.R.color.transparent);
        }
    }

    private static final DiffUtil.ItemCallback<Chat> DIFF_CALLBACK =
            new DiffUtil.ItemCallback<Chat>() {
                @Override
                public boolean areItemsTheSame(@NonNull Chat a, @NonNull Chat b) {
                    return a.contactUsername.equals(b.contactUsername);
                }
                @Override
                public boolean areContentsTheSame(@NonNull Chat a, @NonNull Chat b) {
                    return a.isOnline == b.isOnline && a.unreadCount == b.unreadCount
                            && ((a.lastMessage == null && b.lastMessage == null)
                            || (a.lastMessage != null && a.lastMessage.equals(b.lastMessage)));
                }
            };
}
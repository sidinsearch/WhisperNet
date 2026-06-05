package com.whispernet.ui.chat;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.DiffUtil;
import androidx.recyclerview.widget.ListAdapter;
import androidx.recyclerview.widget.RecyclerView;
import com.whispernet.R;
import com.whispernet.data.local.entity.MessageEntity;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MessageAdapter extends ListAdapter<MessageEntity, RecyclerView.ViewHolder> {

    private static final int VIEW_TYPE_SENT     = 1;
    private static final int VIEW_TYPE_RECEIVED = 2;

    private final String currentUser;

    public MessageAdapter(String currentUser) {
        super(DIFF_CALLBACK);
        this.currentUser = currentUser;
    }

    @Override
    public int getItemViewType(int position) {
        MessageEntity msg = getItem(position);
        return msg.from.equals(currentUser) ? VIEW_TYPE_SENT : VIEW_TYPE_RECEIVED;
    }

    @NonNull
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        LayoutInflater inflater = LayoutInflater.from(parent.getContext());
        if (viewType == VIEW_TYPE_SENT) {
            View v = inflater.inflate(R.layout.item_message_sent, parent, false);
            return new SentViewHolder(v);
        } else {
            View v = inflater.inflate(R.layout.item_message_received, parent, false);
            return new ReceivedViewHolder(v);
        }
    }

    @Override
    public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        MessageEntity msg = getItem(position);
        if (holder instanceof SentViewHolder) ((SentViewHolder) holder).bind(msg);
        else ((ReceivedViewHolder) holder).bind(msg);
    }

    static class SentViewHolder extends RecyclerView.ViewHolder {
        TextView tvContent, tvTime, tvStatus;

        SentViewHolder(@NonNull View itemView) {
            super(itemView);
            tvContent = itemView.findViewById(R.id.tvContent);
            tvTime    = itemView.findViewById(R.id.tvTime);
            tvStatus  = itemView.findViewById(R.id.tvStatus);
        }

        void bind(MessageEntity msg) {
            tvContent.setText(msg.content);
            tvTime.setText(formatTime(msg.timestamp));
            if (msg.status != null) {
                tvStatus.setVisibility(View.VISIBLE);
                tvStatus.setText(statusText(msg.status));
            } else {
                tvStatus.setVisibility(View.GONE);
            }
        }
    }

    static class ReceivedViewHolder extends RecyclerView.ViewHolder {
        TextView tvSender, tvContent, tvTime, tvStatus;

        ReceivedViewHolder(@NonNull View itemView) {
            super(itemView);
            tvSender  = itemView.findViewById(R.id.tvSender);
            tvContent = itemView.findViewById(R.id.tvContent);
            tvTime    = itemView.findViewById(R.id.tvTime);
            tvStatus  = itemView.findViewById(R.id.tvStatus);
        }

        void bind(MessageEntity msg) {
            tvSender.setText(msg.from);
            tvContent.setText(msg.content);
            tvTime.setText(formatTime(msg.timestamp));
            if (msg.status != null) {
                tvStatus.setVisibility(View.VISIBLE);
                tvStatus.setText(statusText(msg.status));
            } else {
                tvStatus.setVisibility(View.GONE);
            }
        }
    }

    private static String formatTime(long timestamp) {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(timestamp));
    }

    private static String statusText(String status) {
        switch (status) {
            case "bounced":      return "⏳ Will be delivered when recipient comes online";
            case "delivered":    return "✓ Delivered when recipient came online";
            case "failed_decrypt": return "⚠️ Could not decrypt this message";
            default: return "";
        }
    }

    private static final DiffUtil.ItemCallback<MessageEntity> DIFF_CALLBACK =
            new DiffUtil.ItemCallback<MessageEntity>() {
                @Override
                public boolean areItemsTheSame(@NonNull MessageEntity a, @NonNull MessageEntity b) {
                    return a.id.equals(b.id);
                }
                @Override
                public boolean areContentsTheSame(@NonNull MessageEntity a, @NonNull MessageEntity b) {
                    return a.content.equals(b.content) && a.status != null && a.status.equals(b.status);
                }
            };
}
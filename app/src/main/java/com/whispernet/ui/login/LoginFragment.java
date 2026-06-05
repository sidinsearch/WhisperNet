package com.whispernet.ui.login;

import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.navigation.Navigation;
import com.whispernet.R;
import com.whispernet.databinding.FragmentLoginBinding;

public class LoginFragment extends Fragment {

    private FragmentLoginBinding binding;
    private LoginViewModel viewModel;

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        binding = FragmentLoginBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        viewModel = new ViewModelProvider(this).get(LoginViewModel.class);

        // Username input watcher
        binding.etUsername.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                viewModel.onUsernameChanged(s.toString());
            }
            @Override public void afterTextChanged(Editable s) {}
        });

        // Connect button
        binding.btnConnect.setOnClickListener(v -> viewModel.connect());

        // Observe state
        viewModel.isLoading.observe(getViewLifecycleOwner(), loading -> {
            binding.btnConnect.setVisibility(loading ? View.GONE : View.VISIBLE);
            binding.progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        });

        viewModel.statusMessage.observe(getViewLifecycleOwner(), msg -> {
            if (msg == null || msg.isEmpty()) {
                binding.tvStatus.setVisibility(View.GONE);
            } else {
                binding.tvStatus.setVisibility(View.VISIBLE);
                binding.tvStatus.setText(msg);
            }
        });

        viewModel.isError.observe(getViewLifecycleOwner(), isError -> {
            int color = isError
                    ? getResources().getColor(R.color.status_offline, null)
                    : getResources().getColor(R.color.text_muted, null);
            binding.tvStatus.setTextColor(color);
        });

        viewModel.isCheckingUsername.observe(getViewLifecycleOwner(), checking -> {
            binding.tvUsernameStatus.setVisibility(checking ? View.VISIBLE : View.GONE);
            binding.tvUsernameStatus.setText("Checking...");
            binding.tvUsernameStatus.setTextColor(getResources().getColor(R.color.text_muted, null));
        });

        viewModel.usernameAvailable.observe(getViewLifecycleOwner(), available -> {
            if (!available) {
                binding.tvUsernameStatus.setVisibility(View.VISIBLE);
                binding.tvUsernameStatus.setText("Username already taken");
                binding.tvUsernameStatus.setTextColor(getResources().getColor(R.color.status_offline, null));
                binding.btnConnect.setEnabled(false);
            } else {
                binding.tvUsernameStatus.setVisibility(View.GONE);
                binding.btnConnect.setEnabled(true);
            }
        });

        viewModel.navigateToMain.observe(getViewLifecycleOwner(), navigate -> {
            if (Boolean.TRUE.equals(navigate)) {
                Navigation.findNavController(view).navigate(R.id.action_login_to_main);
            }
        });
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}
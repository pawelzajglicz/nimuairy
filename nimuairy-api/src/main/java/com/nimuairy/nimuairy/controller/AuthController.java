package com.nimuairy.nimuairy.controller;

import com.nimuairy.nimuairy.dto.CurrentUserResponse;
import com.nimuairy.nimuairy.dto.LoginRequest;
import com.nimuairy.nimuairy.dto.RegisterRequest;
import com.nimuairy.nimuairy.security.AuthCookies;
import com.nimuairy.nimuairy.service.AuthResult;
import com.nimuairy.nimuairy.service.AuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final AuthCookies authCookies;

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public CurrentUserResponse register(@Valid @RequestBody RegisterRequest request, HttpServletResponse response) {
        return startSession(authService.register(request), response);
    }

    @PostMapping("/login")
    public CurrentUserResponse login(@Valid @RequestBody LoginRequest request, HttpServletResponse response) {
        return startSession(authService.login(request), response);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, authCookies.clearedTokenCookie().toString());
    }

    @GetMapping("/me")
    public CurrentUserResponse me(@AuthenticationPrincipal UserDetails user) {
        return new CurrentUserResponse(user.getUsername());
    }

    private CurrentUserResponse startSession(AuthResult result, HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, authCookies.tokenCookie(result.token()).toString());
        return new CurrentUserResponse(result.username());
    }
}

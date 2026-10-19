package com.nimuairy.nimuairy.security;

import com.nimuairy.nimuairy.config.JwtProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * The JWT travels in an HttpOnly cookie rather than in a header the SPA attaches, so scripts on
 * the page (including injected ones) can never read it. SameSite=Strict keeps the browser from
 * sending it on cross-site requests; the CSRF token in {@link SecurityConfig} backs that up.
 */
@Component
@RequiredArgsConstructor
public class AuthCookies {

    public static final String TOKEN_COOKIE = "nimuairy_token";

    private final JwtProperties jwtProperties;

    public ResponseCookie tokenCookie(String token) {
        return baseCookie(token)
                .maxAge(Duration.ofMillis(jwtProperties.getExpirationMs()))
                .build();
    }

    public ResponseCookie clearedTokenCookie() {
        return baseCookie("").maxAge(Duration.ZERO).build();
    }

    private ResponseCookie.ResponseCookieBuilder baseCookie(String value) {
        return ResponseCookie.from(TOKEN_COOKIE, value)
                .httpOnly(true)
                .secure(jwtProperties.isCookieSecure())
                .sameSite("Strict")
                .path("/api");
    }
}

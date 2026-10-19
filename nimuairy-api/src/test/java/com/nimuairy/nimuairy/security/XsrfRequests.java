package com.nimuairy.nimuairy.security;

import jakarta.servlet.http.Cookie;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Sends a CSRF token the way the SPA does: the same value in the XSRF-TOKEN cookie and the
 * X-XSRF-TOKEN header. spring-security-test's csrf() targets the default session-based setup
 * and is rejected by csrf().spa().
 */
final class XsrfRequests {

    private XsrfRequests() {
    }

    static RequestPostProcessor xsrf() {
        return request -> {
            String token = UUID.randomUUID().toString();
            List<Cookie> cookies = new ArrayList<>();
            if (request.getCookies() != null) {
                cookies.addAll(Arrays.asList(request.getCookies()));
            }
            cookies.add(new Cookie("XSRF-TOKEN", token));
            request.setCookies(cookies.toArray(Cookie[]::new));
            request.addHeader("X-XSRF-TOKEN", token);
            return request;
        };
    }
}

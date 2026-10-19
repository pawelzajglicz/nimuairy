package com.nimuairy.nimuairy.security;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static com.nimuairy.nimuairy.security.XsrfRequests.xsrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Production traffic reaches the backend through Cloudflare and nginx, so the browser's Origin
 * never matches the backend's own scheme/host/port.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SameOriginBehindProxyTest {

    private static final String LOGIN_BODY = """
            {"username":"nobody","password":"wrong-password"}
            """;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void sameOriginRequestForwardedByProxy_isNotRejectedByCors() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .header("Origin", "https://nimuairy.example")
                        .header("X-Forwarded-Host", "nimuairy.example")
                        .header("X-Forwarded-Proto", "https")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(LOGIN_BODY)
                        .with(xsrf()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void foreignOrigin_isStillRejectedByCors() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .header("Origin", "https://evil.example")
                        .header("X-Forwarded-Host", "nimuairy.example")
                        .header("X-Forwarded-Proto", "https")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(LOGIN_BODY)
                        .with(xsrf()))
                .andExpect(status().isForbidden());
    }
}

package com.nimuairy.nimuairy.security;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static com.nimuairy.nimuairy.security.XsrfRequests.xsrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class AuthEndpointSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void register_setsHttpOnlyStrictTokenCookieAndKeepsTokenOutOfBody() throws Exception {
        String username = uniqueUsername();

        mockMvc.perform(register(username).with(xsrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.token").doesNotExist())
                .andExpect(cookie().httpOnly(AuthCookies.TOKEN_COOKIE, true))
                .andExpect(cookie().secure(AuthCookies.TOKEN_COOKIE, true))
                .andExpect(cookie().sameSite(AuthCookies.TOKEN_COOKIE, "Strict"))
                .andExpect(cookie().path(AuthCookies.TOKEN_COOKIE, "/api"));
    }

    @Test
    void me_withoutTokenCookie_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void me_withTokenCookie_returnsCurrentUser() throws Exception {
        String username = uniqueUsername();
        Cookie tokenCookie = registerAndGetTokenCookie(username);

        mockMvc.perform(get("/api/auth/me").cookie(tokenCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username));
    }

    @Test
    void authorizationHeader_isNoLongerAccepted() throws Exception {
        Cookie tokenCookie = registerAndGetTokenCookie(uniqueUsername());

        mockMvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenCookie.getValue()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void login_withBadCredentials_logsRejectionWithoutCredentials(CapturedOutput output) throws Exception {
        String username = uniqueUsername();
        String password = "secret-" + UUID.randomUUID();

        mockMvc.perform(post("/api/auth/login").with(xsrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, password)))
                .andExpect(status().isUnauthorized());

        assertThat(output.getOut())
                .contains("Login rejected: invalid credentials")
                .doesNotContain(username)
                .doesNotContain(password);
    }

    @Test
    void post_withoutCsrfToken_isForbidden() throws Exception {
        mockMvc.perform(register(uniqueUsername()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Forbidden"));
    }

    @Test
    void firstGet_issuesReadableXsrfCookie() throws Exception {
        // The SPA's first POST (login) needs this cookie, and only the bootstrap GET /me precedes it.
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(cookie().exists("XSRF-TOKEN"))
                .andExpect(cookie().httpOnly("XSRF-TOKEN", false));
    }

    @Test
    void xsrfCookieFromFirstGet_authorizesFollowingPost() throws Exception {
        Cookie xsrfCookie = mockMvc.perform(get("/api/auth/me"))
                .andReturn().getResponse().getCookie("XSRF-TOKEN");
        assertThat(xsrfCookie).isNotNull();

        mockMvc.perform(post("/api/auth/logout")
                        .cookie(xsrfCookie)
                        .header("X-XSRF-TOKEN", xsrfCookie.getValue()))
                .andExpect(status().isNoContent());
    }

    @Test
    void logout_expiresTokenCookie() throws Exception {
        mockMvc.perform(post("/api/auth/logout").with(xsrf()))
                .andExpect(status().isNoContent())
                .andExpect(cookie().maxAge(AuthCookies.TOKEN_COOKIE, 0))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("HttpOnly")));
    }

    private Cookie registerAndGetTokenCookie(String username) throws Exception {
        MvcResult result = mockMvc.perform(register(username).with(xsrf()))
                .andExpect(status().isCreated())
                .andReturn();
        Cookie tokenCookie = result.getResponse().getCookie(AuthCookies.TOKEN_COOKIE);
        assertThat(tokenCookie).isNotNull();
        return tokenCookie;
    }

    private static MockHttpServletRequestBuilder register(String username) {
        return post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"username":"%s","password":"password123"}
                        """.formatted(username));
    }

    private static String uniqueUsername() {
        return "user-" + UUID.randomUUID().toString().substring(0, 8);
    }
}

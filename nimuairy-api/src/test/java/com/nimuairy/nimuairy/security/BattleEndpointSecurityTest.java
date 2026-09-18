package com.nimuairy.nimuairy.security;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BattleEndpointSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void demoBattleEndpoint_isPubliclyAccessibleWithoutAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/battles/demo"))
                .andExpect(status().isOk());
    }

    @Test
    void existingEndpoint_remainsProtectedWithoutAuthentication() throws Exception {
        mockMvc.perform(get("/api/characters"))
                .andExpect(status().isUnauthorized());
    }
}

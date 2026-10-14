package com.nimuairy.nimuairy.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Keeps the committed openapi.json in sync with the API the backend actually serves, so every
 * contract change shows up in the PR diff. CI uses that file to decide whether a backend change
 * also needs the frontend checks.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenApiSnapshotTest {

    private static final Path SNAPSHOT = Path.of("openapi.json");
    private static final String UPDATE_COMMAND = "./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Test
    void servedContractMatchesCommittedSnapshot() throws Exception {
        String body = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        ObjectNode actual = (ObjectNode) jsonMapper.readTree(body);
        // The server URL is derived from the incoming request, so it is not part of the contract.
        actual.remove("servers");

        if (Boolean.getBoolean("openapi.update")) {
            String pretty = jsonMapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual);
            Files.writeString(SNAPSHOT, pretty.replace("\r\n", "\n") + "\n");
            return;
        }

        assertThat(SNAPSHOT)
                .as("%s is missing; generate it with: %s", SNAPSHOT, UPDATE_COMMAND)
                .exists();
        // Tree comparison ignores formatting and key order; only a real contract change fails.
        JsonNode expected = jsonMapper.readTree(Files.readString(SNAPSHOT));
        assertThat(actual)
                .as("The API contract changed. If intended, update the snapshot with: %s "
                        + "and regenerate the frontend client (npm run api:generate)", UPDATE_COMMAND)
                .isEqualTo(expected);
    }
}

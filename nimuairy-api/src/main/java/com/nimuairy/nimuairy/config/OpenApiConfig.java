package com.nimuairy.nimuairy.config;

import io.swagger.v3.core.jackson.ModelResolver;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    // By default swagger-core inlines enums into every property, so Orval generates one
    // TypeScript type per field (UnitDtoOwner, OrbDtoOwner, …) for the same Java enum.
    // Emitting enums as shared $ref components keeps one generated type per enum, without
    // putting OpenAPI annotations on the battle domain enums. This is springdoc's documented
    // global switch; it must be set before the first /v3/api-docs request.
    static {
        ModelResolver.enumsAsRef = true;
    }
}

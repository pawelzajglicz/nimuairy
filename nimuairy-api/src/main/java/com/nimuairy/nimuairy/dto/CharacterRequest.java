package com.nimuairy.nimuairy.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CharacterRequest(

        @NotBlank
        @Size(max = 255)
        String name,

        @Size(max = 2000)
        String description
) {
}

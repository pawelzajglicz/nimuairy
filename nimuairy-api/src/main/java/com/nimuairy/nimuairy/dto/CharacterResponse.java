package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.model.Character;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CharacterResponse {

    private Long id;
    private String name;
    private String description;
    private Instant createdAt;

    public static CharacterResponse from(Character character) {
        return CharacterResponse.builder()
                .id(character.getId())
                .name(character.getName())
                .description(character.getDescription())
                .createdAt(character.getCreatedAt())
                .build();
    }
}

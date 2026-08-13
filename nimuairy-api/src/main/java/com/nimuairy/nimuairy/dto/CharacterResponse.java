package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.model.Character;

import java.time.Instant;

public record CharacterResponse(

        Long id,
        String name,
        String description,
        Instant createdAt
) {

    public static CharacterResponse from(Character character) {
        return new CharacterResponse(
                character.getId(),
                character.getName(),
                character.getDescription(),
                character.getCreatedAt()
        );
    }
}

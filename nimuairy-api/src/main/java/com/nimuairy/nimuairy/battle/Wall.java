package com.nimuairy.nimuairy.battle;

public record Wall(
        String id,
        PlayerSide owner,
        Position position,
        Footprint footprint,
        int health,
        int maxHealth,
        int defense
) {

    public Wall {
        Health.validate(health, maxHealth);
    }
}

package com.nimuairy.nimuairy.battle;

public record Unit(
        String id,
        PlayerSide owner,
        UnitType unitType,
        Position position,
        Footprint footprint,
        int health,
        int attack,
        int defense,
        int moveRange
) {
}

package com.nimuairy.nimuairy.battle;

public record Orb(String id, PlayerSide owner, Position position, Footprint footprint, int health) {
}

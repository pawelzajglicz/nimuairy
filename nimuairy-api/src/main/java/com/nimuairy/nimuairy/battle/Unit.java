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
        int actionPointBudget,
        int movementCostFactor
) {

    /**
     * Battle state originates here, so invalid statistics are rejected at the source.
     * A factor of 0 would make steps free and break the pathfinding's positive-cost assumption.
     */
    public Unit {
        if (actionPointBudget <= 0) {
            throw new IllegalArgumentException("actionPointBudget must be positive: " + actionPointBudget);
        }
        if (movementCostFactor <= 0) {
            throw new IllegalArgumentException("movementCostFactor must be positive: " + movementCostFactor);
        }
    }
}

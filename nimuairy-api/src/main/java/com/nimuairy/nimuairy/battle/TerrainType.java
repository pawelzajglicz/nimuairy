package com.nimuairy.nimuairy.battle;

public enum TerrainType {
    PLAIN(true),
    ROCK(false);

    private final boolean traversable;

    TerrainType(boolean traversable) {
        this.traversable = traversable;
    }

    public boolean isTraversable() {
        return traversable;
    }
}

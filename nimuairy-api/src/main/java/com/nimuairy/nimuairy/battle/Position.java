package com.nimuairy.nimuairy.battle;

public record Position(int x, int y) {

    public Position plus(Position offset) {
        return new Position(x + offset.x(), y + offset.y());
    }
}

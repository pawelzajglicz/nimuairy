package com.nimuairy.nimuairy.battle;

import java.util.List;

public record Footprint(List<Position> offsets) {

    public List<Position> occupiedCells(Position anchor) {
        return offsets.stream()
                .map(anchor::plus)
                .toList();
    }
}

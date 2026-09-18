package com.nimuairy.nimuairy.battle;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FootprintTest {

    @Test
    void occupiedCells_forOneByOneFootprint_returnsAnchorOnly() {
        Footprint footprint = new Footprint(List.of(new Position(0, 0)));

        List<Position> occupied = footprint.occupiedCells(new Position(3, 2));

        assertThat(occupied).containsExactly(new Position(3, 2));
    }

    @Test
    void occupiedCells_forWallFootprint_returnsFullTwoByElevenRectangle() {
        List<Position> offsets = new java.util.ArrayList<>();
        for (int dx = 0; dx < 2; dx++) {
            for (int dy = 0; dy < 11; dy++) {
                offsets.add(new Position(dx, dy));
            }
        }
        Footprint footprint = new Footprint(offsets);

        List<Position> occupied = footprint.occupiedCells(new Position(1, 0));

        assertThat(occupied).hasSize(22);
        assertThat(occupied).doesNotHaveDuplicates();
        for (int x = 1; x <= 2; x++) {
            for (int y = 0; y <= 10; y++) {
                assertThat(occupied).contains(new Position(x, y));
            }
        }
    }
}

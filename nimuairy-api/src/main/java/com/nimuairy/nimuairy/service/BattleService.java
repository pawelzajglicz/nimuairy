package com.nimuairy.nimuairy.service;

import com.nimuairy.nimuairy.battle.Board;
import com.nimuairy.nimuairy.battle.BattleState;
import com.nimuairy.nimuairy.battle.Footprint;
import com.nimuairy.nimuairy.battle.Orb;
import com.nimuairy.nimuairy.battle.PlayerSide;
import com.nimuairy.nimuairy.battle.Position;
import com.nimuairy.nimuairy.battle.Terrain;
import com.nimuairy.nimuairy.battle.TerrainType;
import com.nimuairy.nimuairy.battle.Unit;
import com.nimuairy.nimuairy.battle.UnitType;
import com.nimuairy.nimuairy.battle.Wall;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class BattleService {

    private static final int BOARD_WIDTH = 21;
    private static final int BOARD_HEIGHT = 11;

    private static final Footprint FOOTPRINT_1X1 = new Footprint(List.of(new Position(0, 0)));
    private static final Footprint FOOTPRINT_2X1 = new Footprint(List.of(
            new Position(0, 0), new Position(1, 0)));
    private static final Footprint FOOTPRINT_2X2 = new Footprint(List.of(
            new Position(0, 0), new Position(1, 0), new Position(0, 1), new Position(1, 1)));
    private static final Footprint FOOTPRINT_1X3 = new Footprint(List.of(
            new Position(0, 0), new Position(0, 1), new Position(0, 2)));
    private static final Footprint WALL_FOOTPRINT = wallFootprint();

    public BattleState getDemoBattle() {
        return new BattleState(buildBoard(), buildOrbs(), buildWalls(), buildUnits(), PlayerSide.LEFT);
    }

    private Board buildBoard() {
        Set<Position> rockPositions = new HashSet<>(rockPositions());
        List<Terrain> terrain = new ArrayList<>();
        for (int x = 0; x < BOARD_WIDTH; x++) {
            for (int y = 0; y < BOARD_HEIGHT; y++) {
                Position position = new Position(x, y);
                TerrainType type = rockPositions.contains(position) ? TerrainType.ROCK : TerrainType.PLAIN;
                terrain.add(new Terrain(position, type));
            }
        }
        return new Board(BOARD_WIDTH, BOARD_HEIGHT, terrain);
    }

    /**
     * Deterministic ROCK layout reserved for M4 movement testing, kept deliberately
     * small: a compact block, a one-cell-wide passage a 1x1 unit can cross but a
     * 2x1/2x2 cannot, and a corner pair for diagonal-blocking tests. Kept clear of
     * columns 5-6 and 14-15, where the demo units sit.
     */
    private List<Position> rockPositions() {
        List<Position> rocks = new ArrayList<>();
        rocks.addAll(rectangle(9, 7, 3, 2));
        rocks.add(new Position(8, 3));
        rocks.add(new Position(8, 4));
        rocks.add(new Position(8, 5));
        rocks.add(new Position(10, 3));
        rocks.add(new Position(10, 4));
        rocks.add(new Position(10, 5));
        rocks.add(new Position(9, 0));
        rocks.add(new Position(10, 1));
        return rocks;
    }

    private static List<Position> rectangle(int x0, int y0, int width, int height) {
        List<Position> positions = new ArrayList<>();
        for (int dx = 0; dx < width; dx++) {
            for (int dy = 0; dy < height; dy++) {
                positions.add(new Position(x0 + dx, y0 + dy));
            }
        }
        return positions;
    }

    private List<Orb> buildOrbs() {
        return List.of(
                new Orb("orb-left", PlayerSide.LEFT, new Position(0, 5), FOOTPRINT_1X1, 75),
                new Orb("orb-right", PlayerSide.RIGHT, new Position(20, 5), FOOTPRINT_1X1, 75)
        );
    }

    private List<Wall> buildWalls() {
        return List.of(
                new Wall("wall-left", PlayerSide.LEFT, new Position(1, 0), WALL_FOOTPRINT, 1500),
                new Wall("wall-right", PlayerSide.RIGHT, new Position(18, 0), WALL_FOOTPRINT, 1500)
        );
    }

    private List<Unit> buildUnits() {
        return List.of(
                unit("unit-left-1", PlayerSide.LEFT, new Position(5, 2), FOOTPRINT_1X1),
                unit("unit-left-2", PlayerSide.LEFT, new Position(5, 4), FOOTPRINT_2X1),
                unit("unit-left-3", PlayerSide.LEFT, new Position(5, 6), FOOTPRINT_2X2),
                unit("unit-left-4", PlayerSide.LEFT, new Position(5, 8), FOOTPRINT_1X3),
                unit("unit-right-1", PlayerSide.RIGHT, new Position(15, 2), FOOTPRINT_1X1),
                unit("unit-right-2", PlayerSide.RIGHT, new Position(14, 4), FOOTPRINT_2X1),
                unit("unit-right-3", PlayerSide.RIGHT, new Position(14, 6), FOOTPRINT_2X2),
                unit("unit-right-4", PlayerSide.RIGHT, new Position(15, 8), FOOTPRINT_1X3)
        );
    }

    private Unit unit(String id, PlayerSide side, Position position, Footprint footprint) {
        return new Unit(id, side, UnitType.SWORDSMAN, position, footprint, 500, 200, 50, 3);
    }

    private static Footprint wallFootprint() {
        List<Position> offsets = new ArrayList<>();
        for (int dx = 0; dx < 2; dx++) {
            for (int dy = 0; dy < BOARD_HEIGHT; dy++) {
                offsets.add(new Position(dx, dy));
            }
        }
        return new Footprint(offsets);
    }
}

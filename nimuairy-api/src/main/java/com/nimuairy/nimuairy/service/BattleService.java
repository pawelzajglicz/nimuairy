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
import java.util.List;

@Service
public class BattleService {

    private static final int BOARD_WIDTH = 21;
    private static final int BOARD_HEIGHT = 11;

    private static final Footprint UNIT_FOOTPRINT = new Footprint(List.of(new Position(0, 0)));
    private static final Footprint WALL_FOOTPRINT = wallFootprint();

    public BattleState getDemoBattle() {
        return new BattleState(buildBoard(), buildOrbs(), buildWalls(), buildUnits());
    }

    private Board buildBoard() {
        List<Terrain> terrain = new ArrayList<>();
        for (int x = 0; x < BOARD_WIDTH; x++) {
            for (int y = 0; y < BOARD_HEIGHT; y++) {
                terrain.add(new Terrain(new Position(x, y), TerrainType.PLAIN));
            }
        }
        return new Board(BOARD_WIDTH, BOARD_HEIGHT, terrain);
    }

    private List<Orb> buildOrbs() {
        return List.of(
                new Orb("orb-left", PlayerSide.LEFT, new Position(0, 5), UNIT_FOOTPRINT, 75),
                new Orb("orb-right", PlayerSide.RIGHT, new Position(20, 5), UNIT_FOOTPRINT, 75)
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
                unit("unit-left-1", PlayerSide.LEFT, new Position(3, 2)),
                unit("unit-left-2", PlayerSide.LEFT, new Position(3, 4)),
                unit("unit-left-3", PlayerSide.LEFT, new Position(3, 6)),
                unit("unit-left-4", PlayerSide.LEFT, new Position(3, 8)),
                unit("unit-right-1", PlayerSide.RIGHT, new Position(17, 2)),
                unit("unit-right-2", PlayerSide.RIGHT, new Position(17, 4)),
                unit("unit-right-3", PlayerSide.RIGHT, new Position(17, 6)),
                unit("unit-right-4", PlayerSide.RIGHT, new Position(17, 8))
        );
    }

    private Unit unit(String id, PlayerSide side, Position position) {
        return new Unit(id, side, UnitType.SWORDSMAN, position, UNIT_FOOTPRINT, 500, 200, 50, 3);
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

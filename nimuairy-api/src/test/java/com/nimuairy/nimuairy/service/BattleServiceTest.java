package com.nimuairy.nimuairy.service;

import com.nimuairy.nimuairy.battle.BattleState;
import com.nimuairy.nimuairy.battle.Board;
import com.nimuairy.nimuairy.battle.Orb;
import com.nimuairy.nimuairy.battle.PlayerSide;
import com.nimuairy.nimuairy.battle.Position;
import com.nimuairy.nimuairy.battle.Terrain;
import com.nimuairy.nimuairy.battle.TerrainType;
import com.nimuairy.nimuairy.battle.Unit;
import com.nimuairy.nimuairy.battle.UnitType;
import com.nimuairy.nimuairy.battle.Wall;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class BattleServiceTest {

    private final BattleService battleService = new BattleService();

    @Test
    void board_is21x11WithAllPlainTerrainCells() {
        Board board = battleService.getDemoBattle().board();

        assertThat(board.width()).isEqualTo(21);
        assertThat(board.height()).isEqualTo(11);
        assertThat(board.terrain()).hasSize(231);
        assertThat(board.terrain()).allMatch(terrain -> terrain.type() == TerrainType.PLAIN);

        Set<Position> positions = new HashSet<>();
        for (Terrain terrain : board.terrain()) {
            positions.add(terrain.position());
        }
        assertThat(positions).hasSize(231);
        for (int x = 0; x < 21; x++) {
            for (int y = 0; y < 11; y++) {
                assertThat(positions).contains(new Position(x, y));
            }
        }
    }

    @Test
    void orbs_matchContract() {
        List<Orb> orbs = battleService.getDemoBattle().orbs();

        assertThat(orbs).hasSize(2);
        assertThat(orbs).anySatisfy(orb -> {
            assertThat(orb.id()).isEqualTo("orb-left");
            assertThat(orb.owner()).isEqualTo(PlayerSide.LEFT);
            assertThat(orb.position()).isEqualTo(new Position(0, 5));
            assertThat(orb.health()).isEqualTo(75);
        });
        assertThat(orbs).anySatisfy(orb -> {
            assertThat(orb.id()).isEqualTo("orb-right");
            assertThat(orb.owner()).isEqualTo(PlayerSide.RIGHT);
            assertThat(orb.position()).isEqualTo(new Position(20, 5));
            assertThat(orb.health()).isEqualTo(75);
        });
    }

    @Test
    void walls_matchContractIncludingFullFootprint() {
        List<Wall> walls = battleService.getDemoBattle().walls();

        assertThat(walls).hasSize(2);
        assertThat(walls).anySatisfy(wall -> {
            assertThat(wall.id()).isEqualTo("wall-left");
            assertThat(wall.owner()).isEqualTo(PlayerSide.LEFT);
            assertThat(wall.position()).isEqualTo(new Position(1, 0));
            assertThat(wall.health()).isEqualTo(1500);
            assertThat(wall.footprint().occupiedCells(wall.position())).hasSize(22);
            for (int y = 0; y <= 10; y++) {
                assertThat(wall.footprint().occupiedCells(wall.position()))
                        .contains(new Position(1, y), new Position(2, y));
            }
        });
        assertThat(walls).anySatisfy(wall -> {
            assertThat(wall.id()).isEqualTo("wall-right");
            assertThat(wall.owner()).isEqualTo(PlayerSide.RIGHT);
            assertThat(wall.position()).isEqualTo(new Position(18, 0));
            assertThat(wall.health()).isEqualTo(1500);
            for (int y = 0; y <= 10; y++) {
                assertThat(wall.footprint().occupiedCells(wall.position()))
                        .contains(new Position(18, y), new Position(19, y));
            }
        });
    }

    @Test
    void units_matchContract() {
        BattleState battleState = battleService.getDemoBattle();
        List<Unit> units = battleState.units();

        assertThat(units).hasSize(8);
        assertThat(units).allSatisfy(unit -> {
            assertThat(unit.unitType()).isEqualTo(UnitType.SWORDSMAN);
            assertThat(unit.health()).isEqualTo(500);
            assertThat(unit.attack()).isEqualTo(200);
            assertThat(unit.defense()).isEqualTo(50);
            assertThat(unit.moveRange()).isEqualTo(3);
            assertThat(unit.footprint().occupiedCells(unit.position())).containsExactly(unit.position());
        });

        assertThat(unitById(units, "unit-left-1").position()).isEqualTo(new Position(3, 2));
        assertThat(unitById(units, "unit-left-2").position()).isEqualTo(new Position(3, 4));
        assertThat(unitById(units, "unit-left-3").position()).isEqualTo(new Position(3, 6));
        assertThat(unitById(units, "unit-left-4").position()).isEqualTo(new Position(3, 8));
        assertThat(unitById(units, "unit-right-1").position()).isEqualTo(new Position(17, 2));
        assertThat(unitById(units, "unit-right-2").position()).isEqualTo(new Position(17, 4));
        assertThat(unitById(units, "unit-right-3").position()).isEqualTo(new Position(17, 6));
        assertThat(unitById(units, "unit-right-4").position()).isEqualTo(new Position(17, 8));

        assertThat(units.stream().filter(u -> u.owner() == PlayerSide.LEFT).map(Unit::id))
                .containsExactlyInAnyOrder("unit-left-1", "unit-left-2", "unit-left-3", "unit-left-4");
        assertThat(units.stream().filter(u -> u.owner() == PlayerSide.RIGHT).map(Unit::id))
                .containsExactlyInAnyOrder("unit-right-1", "unit-right-2", "unit-right-3", "unit-right-4");
    }

    private Unit unitById(List<Unit> units, String id) {
        return units.stream()
                .filter(unit -> unit.id().equals(id))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing unit: " + id));
    }
}

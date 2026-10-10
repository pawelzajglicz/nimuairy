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
    void demoBattle_startsWithLeftAsTheCurrentPlayer() {
        assertThat(battleService.getDemoBattle().currentPlayer()).isEqualTo(PlayerSide.LEFT);
    }

    @Test
    void board_is21x11WithNoDuplicatePositions() {
        Board board = battleService.getDemoBattle().board();

        assertThat(board.width()).isEqualTo(21);
        assertThat(board.height()).isEqualTo(11);
        assertThat(board.terrain()).hasSize(231);

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
    void board_containsRockTerrainThatIsNonTraversable() {
        Board board = battleService.getDemoBattle().board();

        List<Terrain> rockCells = board.terrain().stream()
                .filter(terrain -> terrain.type() == TerrainType.ROCK)
                .toList();

        assertThat(rockCells).isNotEmpty();
        assertThat(rockCells).allMatch(terrain -> !terrain.type().isTraversable());
    }

    @Test
    void board_plainTerrainRemainsTraversableAndIsTheVastMajority() {
        Board board = battleService.getDemoBattle().board();

        List<Terrain> plainCells = board.terrain().stream()
                .filter(terrain -> terrain.type() == TerrainType.PLAIN)
                .toList();

        assertThat(plainCells).allMatch(terrain -> terrain.type().isTraversable());
        // The ROCK fixture is intentionally small and easy to read, not maze-like.
        assertThat(plainCells.size()).isGreaterThan(board.terrain().size() - 20);
    }

    @Test
    void board_isDeterministicAcrossCalls() {
        Board first = battleService.getDemoBattle().board();
        Board second = battleService.getDemoBattle().board();

        assertThat(second.terrain()).isEqualTo(first.terrain());
    }

    @Test
    void board_narrowPassageLetsA1x1UnitThroughButNotA2x1() {
        Board board = battleService.getDemoBattle().board();

        // Gap column between the two flanking rock columns: open for a 1x1 unit.
        assertThat(terrainTypeAt(board, 9, 4)).isEqualTo(TerrainType.PLAIN);
        // Either neighbour is ROCK, so a 2x1 unit spanning the gap cannot fit.
        assertThat(terrainTypeAt(board, 8, 4)).isEqualTo(TerrainType.ROCK);
        assertThat(terrainTypeAt(board, 10, 4)).isEqualTo(TerrainType.ROCK);
    }

    @Test
    void board_hasADiagonalCornerRockPairTouchingOnlyAtTheCorner() {
        Board board = battleService.getDemoBattle().board();

        assertThat(terrainTypeAt(board, 9, 0)).isEqualTo(TerrainType.ROCK);
        assertThat(terrainTypeAt(board, 10, 1)).isEqualTo(TerrainType.ROCK);
        assertThat(terrainTypeAt(board, 9, 1)).isEqualTo(TerrainType.PLAIN);
        assertThat(terrainTypeAt(board, 10, 0)).isEqualTo(TerrainType.PLAIN);
    }

    @Test
    void board_hasACompactRockBlock() {
        Board board = battleService.getDemoBattle().board();

        for (int x = 9; x <= 11; x++) {
            for (int y = 7; y <= 8; y++) {
                assertThat(terrainTypeAt(board, x, y)).isEqualTo(TerrainType.ROCK);
            }
        }
    }

    private TerrainType terrainTypeAt(Board board, int x, int y) {
        return board.terrain().stream()
                .filter(terrain -> terrain.position().equals(new Position(x, y)))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing terrain cell: " + x + "," + y))
                .type();
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
    void units_hasExactlyEightUnitsFourPerSide() {
        BattleState battleState = battleService.getDemoBattle();
        List<Unit> units = battleState.units();

        assertThat(units).hasSize(8);
        assertThat(units).allSatisfy(unit -> {
            assertThat(unit.unitType()).isEqualTo(UnitType.SWORDSMAN);
            assertThat(unit.health()).isEqualTo(500);
            assertThat(unit.attack()).isEqualTo(200);
            assertThat(unit.defense()).isEqualTo(50);
            assertThat(unit.actionPointBudget()).isEqualTo(3);
            assertThat(unit.movementCostFactor()).isEqualTo(1);
        });

        assertThat(units.stream().map(Unit::id)).containsExactlyInAnyOrder(
                "unit-left-1", "unit-left-2", "unit-left-3", "unit-left-4",
                "unit-right-1", "unit-right-2", "unit-right-3", "unit-right-4");

        assertThat(units.stream().filter(u -> u.owner() == PlayerSide.LEFT))
                .as("LEFT units").hasSize(4);
        assertThat(units.stream().filter(u -> u.owner() == PlayerSide.RIGHT))
                .as("RIGHT units").hasSize(4);
    }

    @Test
    void units_eachSideHasExactlyOneUnitOfEachFootprintSize() {
        List<Unit> units = battleService.getDemoBattle().units();

        assertFootprintCellCounts(units, PlayerSide.LEFT);
        assertFootprintCellCounts(units, PlayerSide.RIGHT);
    }

    private void assertFootprintCellCounts(List<Unit> units, PlayerSide side) {
        List<Integer> footprintCellCounts = units.stream()
                .filter(unit -> unit.owner() == side)
                .map(unit -> unit.footprint().occupiedCells(unit.position()).size())
                .toList();

        assertThat(footprintCellCounts)
                .as("%s footprint cell counts (1x1, 2x1, 2x2, 1x3)", side)
                .containsExactlyInAnyOrder(1, 2, 4, 3);
    }

    @Test
    void units_footprintsHaveTheExpectedDimensionsAndOrientation() {
        List<Unit> units = battleService.getDemoBattle().units();

        // 1x1: a single cell.
        assertOccupiedCells(units, "unit-left-1", new Position(5, 2));
        assertOccupiedCells(units, "unit-right-1", new Position(15, 2));

        // 2x1: two cells side by side on the same row (horizontal).
        assertOccupiedCells(units, "unit-left-2", new Position(5, 4), new Position(6, 4));
        assertOccupiedCells(units, "unit-right-2", new Position(14, 4), new Position(15, 4));

        // 2x2: a full two-by-two block.
        assertOccupiedCells(units, "unit-left-3",
                new Position(5, 6), new Position(6, 6), new Position(5, 7), new Position(6, 7));
        assertOccupiedCells(units, "unit-right-3",
                new Position(14, 6), new Position(15, 6), new Position(14, 7), new Position(15, 7));

        // 1x3: three cells stacked in the same column (vertical).
        assertOccupiedCells(units, "unit-left-4",
                new Position(5, 8), new Position(5, 9), new Position(5, 10));
        assertOccupiedCells(units, "unit-right-4",
                new Position(15, 8), new Position(15, 9), new Position(15, 10));
    }

    @Test
    void units_haveValidNonOverlappingStartingPositionsInsideTheBoard() {
        BattleState battleState = battleService.getDemoBattle();
        Board board = battleState.board();
        List<Unit> units = battleState.units();

        Set<Position> occupied = new HashSet<>();
        for (Unit unit : units) {
            List<Position> cells = unit.footprint().occupiedCells(unit.position());

            assertThat(cells).allSatisfy(cell -> {
                assertThat(cell.x()).isBetween(0, board.width() - 1);
                assertThat(cell.y()).isBetween(0, board.height() - 1);
                assertThat(terrainTypeAt(board, cell.x(), cell.y())).isEqualTo(TerrainType.PLAIN);
            });

            for (Position cell : cells) {
                assertThat(occupied).as("cell %s not already occupied by another unit", cell)
                        .doesNotContain(cell);
                occupied.add(cell);
            }
        }
    }

    private void assertOccupiedCells(List<Unit> units, String id, Position... expectedCells) {
        Unit unit = unitById(units, id);
        assertThat(unit.footprint().occupiedCells(unit.position()))
                .as("occupied cells for %s", id)
                .containsExactlyInAnyOrder(expectedCells);
    }

    private Unit unitById(List<Unit> units, String id) {
        return units.stream()
                .filter(unit -> unit.id().equals(id))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing unit: " + id));
    }
}

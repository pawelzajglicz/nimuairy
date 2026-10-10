package com.nimuairy.nimuairy.battle;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class UnitTest {

    @Test
    void constructor_withMinimalPositiveStatistics_createsUnit() {
        Unit unit = unit(1, 1);

        assertThat(unit.actionPointBudget()).isEqualTo(1);
        assertThat(unit.movementCostFactor()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void constructor_withNonPositiveActionPointBudget_isRejected(int actionPointBudget) {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> unit(actionPointBudget, 1))
                .withMessageContaining("actionPointBudget");
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void constructor_withNonPositiveMovementCostFactor_isRejected(int movementCostFactor) {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> unit(3, movementCostFactor))
                .withMessageContaining("movementCostFactor");
    }

    private static Unit unit(int actionPointBudget, int movementCostFactor) {
        return new Unit("unit", PlayerSide.LEFT, UnitType.SWORDSMAN, new Position(0, 0),
                new Footprint(List.of(new Position(0, 0))), 500, 200, 50,
                actionPointBudget, movementCostFactor);
    }
}

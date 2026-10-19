package com.nimuairy.nimuairy.battle;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatNoException;

class HealthTest {

    private static final Footprint ONE_CELL = new Footprint(List.of(new Position(0, 0)));

    @ParameterizedTest
    @ValueSource(ints = {0, 50, 100})
    void validate_withHealthFromZeroToMax_isAccepted(int health) {
        assertThatNoException().isThrownBy(() -> Health.validate(health, 100));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void validate_withNonPositiveMaxHealth_isRejected(int maxHealth) {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> Health.validate(0, maxHealth))
                .withMessageContaining("maxHealth");
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 101})
    void validate_withHealthOutsideZeroToMax_isRejected(int health) {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> Health.validate(health, 100))
                .withMessageContaining("health");
    }

    @Test
    void unit_withHealthAboveMaxHealth_isRejected() {
        assertThatIllegalArgumentException().isThrownBy(() -> new Unit("unit", PlayerSide.LEFT,
                UnitType.SWORDSMAN, new Position(0, 0), ONE_CELL, 501, 500, 200, 50, 3, 1, 2));
    }

    @Test
    void wall_withHealthAboveMaxHealth_isRejected() {
        assertThatIllegalArgumentException().isThrownBy(() -> new Wall("wall", PlayerSide.LEFT,
                new Position(0, 0), ONE_CELL, 1001, 1000, 100));
    }

    @Test
    void orb_withHealthAboveMaxHealth_isRejected() {
        assertThatIllegalArgumentException().isThrownBy(() -> new Orb("orb", PlayerSide.LEFT,
                new Position(0, 0), ONE_CELL, 76, 75, 0));
    }
}

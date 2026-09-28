package com.nimuairy.nimuairy.battle;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TerrainTypeTest {

    @Test
    void plain_isTraversable() {
        assertThat(TerrainType.PLAIN.isTraversable()).isTrue();
    }

    @Test
    void rock_isNotTraversable() {
        assertThat(TerrainType.ROCK.isTraversable()).isFalse();
    }
}

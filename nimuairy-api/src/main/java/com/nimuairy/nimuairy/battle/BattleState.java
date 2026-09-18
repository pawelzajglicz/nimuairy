package com.nimuairy.nimuairy.battle;

import java.util.List;

public record BattleState(Board board, List<Orb> orbs, List<Wall> walls, List<Unit> units) {
}

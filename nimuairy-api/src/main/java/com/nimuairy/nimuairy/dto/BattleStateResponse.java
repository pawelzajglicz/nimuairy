package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.BattleState;
import com.nimuairy.nimuairy.battle.PlayerSide;

import java.util.List;

public record BattleStateResponse(
        BoardDto board,
        List<OrbDto> orbs,
        List<WallDto> walls,
        List<UnitDto> units,
        PlayerSide currentPlayer
) {

    public static BattleStateResponse from(BattleState battleState) {
        return new BattleStateResponse(
                BoardDto.from(battleState.board()),
                battleState.orbs().stream().map(OrbDto::from).toList(),
                battleState.walls().stream().map(WallDto::from).toList(),
                battleState.units().stream().map(UnitDto::from).toList(),
                battleState.currentPlayer()
        );
    }
}

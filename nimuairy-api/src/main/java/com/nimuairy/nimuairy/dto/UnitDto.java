package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.PlayerSide;
import com.nimuairy.nimuairy.battle.Unit;
import com.nimuairy.nimuairy.battle.UnitType;

import java.util.List;

public record UnitDto(
        String id,
        PlayerSide owner,
        UnitType unitType,
        PositionDto position,
        List<PositionDto> footprint,
        int health,
        int attack,
        int defense,
        int moveRange
) {

    public static UnitDto from(Unit unit) {
        return new UnitDto(
                unit.id(),
                unit.owner(),
                unit.unitType(),
                PositionDto.from(unit.position()),
                unit.footprint().offsets().stream().map(PositionDto::from).toList(),
                unit.health(),
                unit.attack(),
                unit.defense(),
                unit.moveRange()
        );
    }
}
